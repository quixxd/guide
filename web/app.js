// Walk mode: press Start and the guide keeps talking about what's around you as you walk.
//
// Loop: prepare a segment (position → places → plan → sources → prompt), stream it from the
// relay, speak it sentence by sentence. While the last sentence plays, the next segment is
// prepared, so there's no long silence between segments.
//
// Address options: ?key=TOKEN (remembered), ?sim=baixa or ?sim=lat,lon;lat,lon (simulated walk),
// &speed=2 (simulation speed), &debug=1 (planner details).

import { GpsSource, SimSource } from "./position.js";
import { RelayError, callsToday, streamNarration } from "./relay.js";
import { walkingRoute } from "./sources.js";
import { SentenceBuffer, Speaker } from "./speech.js";
import { Session, planSummary, prepareSegment } from "./tour.js";

/* global L */

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const params = new URLSearchParams(location.search);
if (params.get("key")) store.set("guide.token", params.get("key"));
const token = params.get("key") || store.get("guide.token");
const DEBUG = params.has("debug");

/** Simulated walks: ?sim=<name>, or ?sim=lat,lon;lat,lon[;…] */
const SIM_PRESETS = {
  baixa: { name: "Lisbon: Alfama to Baixa", points: [[38.7116, -9.1305], [38.7075, -9.1364]] },
  chiado: { name: "Lisbon: Bairro Alto to Chiado", points: [[38.7155, -9.1443], [38.7106, -9.1426]] },
  porto: { name: "Porto: Ribeira to Clérigos", points: [[41.1406, -8.6131], [41.1457, -8.6146]] },
  evora: { name: "Évora: Roman Temple to Praça do Giraldo", points: [[38.5728, -7.9073], [38.5711, -7.9093]] },
};

function simSpec() {
  const raw = params.get("sim");
  if (!raw) return null;
  if (SIM_PRESETS[raw]) return SIM_PRESETS[raw];
  const points = raw.split(";").map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  return points.length >= 2 ? { name: "Simulated walk", points } : null;
}
const SIM = simSpec();
const SIM_SPEED = Math.max(0.5, Math.min(10, Number(params.get("speed")) || 1));

const GAP_AFTER_SEGMENT_MS = 1500;
const RETRY_AFTER_ERROR_MS = 10000;

const speaker = new Speaker();

class Segment {
  constructor() {
    this.ctl = new AbortController();
    this.sentences = new SentenceBuffer();
    /** Sentences waiting until this segment becomes the one being spoken. */
    this.pending = [];
    this.text = "";
    this.active = false;
    this.streamDone = false;
    this.recorded = false;
    this.remembered = false;
    /** @type {import("./tour.js").Prepared | null} */
    this.prepared = null;
    this.silence = false;
    this.retryMs = 0;
    /** @type {Error | null} */
    this.error = null;
  }

  push(sentence) {
    if (this.active) speaker.enqueue(sentence);
    else this.pending.push(sentence);
  }
}

const state = {
  running: false,
  paused: false,
  /** @type {Session | null} */
  session: null,
  /** @type {GpsSource | SimSource | null} */
  source: null,
  /** @type {{lat: number, lon: number, heading: number | null, speed: number | null, accuracy?: number} | null} */
  pos: null,
  /** @type {Segment | null} the segment being spoken */
  current: null,
  /** @type {Segment | null} the segment being prepared while the current one finishes */
  next: null,
  timer: 0,
  wakeLock: null,
  simRoute: null,
};

// ---------- Segments ----------

function schedule(ms) {
  clearTimeout(state.timer);
  state.timer = setTimeout(startNext, ms);
}

/** Starts preparing the next segment: as the current one if nothing is playing, else as a prefetch. */
function startNext() {
  clearTimeout(state.timer);
  if (!state.running || state.paused || state.next) return;
  if (!state.pos) {
    status("Waiting for your location…");
    schedule(2000);
    return;
  }
  const seg = new Segment();
  if (state.current) {
    state.next = seg;
  } else {
    state.current = seg;
    seg.active = true;
    status(state.session.segments.length ? "Looking around…" : "Finding where you are…");
  }
  run(seg);
}

/** @param {Segment} seg */
async function run(seg) {
  try {
    const prepared = await prepareSegment(state.session, { ...state.pos }, null);
    if (seg.ctl.signal.aborted) return;
    seg.prepared = prepared;
    showPrepared(prepared);
    if (prepared.plan.kind === "silence") {
      seg.silence = true;
      seg.retryMs = prepared.plan.retryMs;
    } else {
      if (seg.active) record(seg);
      await streamNarration(token, prepared.system, prepared.prompt, (t) => {
        seg.text += t;
        for (const s of seg.sentences.push(t)) seg.push(s);
      }, seg.ctl.signal);
      for (const s of seg.sentences.flush()) seg.push(s);
    }
  } catch (error) {
    if (seg.ctl.signal.aborted) return;
    seg.error = error;
  }
  seg.streamDone = true;
  updateMeta();
  settle(seg);
}

/** Marks the segment's place as covered once it starts playing. @param {Segment} seg */
function record(seg) {
  if (seg.recorded || !seg.prepared || seg.silence) return;
  seg.recorded = true;
  state.session.record(seg.prepared);
  const plan = seg.prepared.plan;
  const target = "target" in plan && plan.target ? plan.target.poi.name : plan.kind === "area" ? plan.areaName : "";
  status(target ? `Talking about ${target}` : "Speaking");
  refreshPois();
}

/** Makes a prefetched segment the one being spoken. @param {Segment} seg */
function activate(seg) {
  state.current = seg;
  seg.active = true;
  record(seg);
  for (const s of seg.pending) speaker.enqueue(s);
  seg.pending = [];
  settle(seg);
}

/** Called whenever the active segment might be finished. @param {Segment} seg */
function settle(seg) {
  if (!seg.active || !seg.streamDone || state.current !== seg) return;
  if (!seg.remembered) {
    seg.remembered = true;
    state.session.remember(seg.text);
  }
  if (seg.error) {
    state.current = null;
    handleError(seg.error);
    return;
  }
  if (seg.silence) {
    state.current = null;
    status("Quiet stretch: I'll speak up when there's something to tell.");
    schedule(seg.retryMs);
    return;
  }
  if (!speaker.busy) segmentEnded();
  // Speech is already on the last sentence: prepare the next segment now.
  else if (speaker.queue.length === 0 && !state.next) startNext();
}

function segmentEnded() {
  state.current = null;
  if (state.next) {
    const next = state.next;
    state.next = null;
    activate(next);
  } else if (state.running && !state.paused) {
    schedule(GAP_AFTER_SEGMENT_MS);
  }
}

speaker.onSentence = (text) => {
  $("caption").textContent = text;
  // The last sentence of a complete segment has started: prepare the next one now.
  const cur = state.current;
  if (cur && cur.streamDone && speaker.queue.length === 0 && !state.next) startNext();
};

speaker.onIdle = () => {
  if (state.current?.streamDone) segmentEnded();
};

/** @param {Error} error */
function handleError(error) {
  const statusCode = error instanceof RelayError ? error.status : 0;
  if (statusCode === 429) {
    pause();
    status("The free daily quota is used up (or the relay's limit is reached). Try again later, or tap Continue.", true);
  } else if (statusCode === 401) {
    pause();
    status("Wrong or missing key: open the page as …/guide/?key=YOUR_KEY", true);
  } else {
    status(`Connection problem (${error.message}). Retrying in 10 seconds…`, true);
    schedule(RETRY_AFTER_ERROR_MS);
  }
}

function abortSegments() {
  state.current?.ctl.abort();
  state.next?.ctl.abort();
  state.current = null;
  state.next = null;
  clearTimeout(state.timer);
  speaker.cancel();
}

// ---------- Controls ----------

async function start() {
  if (!token) {
    status("Add your key to the address: …/guide/?key=YOUR_KEY", true);
    return;
  }
  speaker.unlock(); // inside the tap, so mobile browsers allow speech later
  requestWakeLock();
  state.running = true;
  state.paused = false;
  state.session = new Session(["history"]);
  state.pos = null;
  renderControls();

  const onPosition = (p) => {
    state.pos = p;
    showPosition(p);
  };
  if (SIM) {
    try {
      status("Planning the simulated walk…");
      const route = await walkingRoute(SIM.points.map(([lat, lon]) => ({ lat, lon })));
      showRoute(route.coords);
      state.source = new SimSource(route, "walk", onPosition, () => status("End of the simulated walk."));
      state.source.setMultiplier(SIM_SPEED);
    } catch (error) {
      stop();
      status(`Couldn't plan the simulated walk: ${error.message}`, true);
      return;
    }
  } else {
    state.source = new GpsSource(onPosition, (msg) => status(`Location: ${msg}`, true));
  }
  state.source.start();
  startNext();
}

function pause() {
  if (!state.running || state.paused) return;
  state.paused = true;
  abortSegments();
  if (state.source instanceof SimSource) state.source.setPaused(true);
  status("Paused.");
  renderControls();
}

function resume() {
  if (!state.paused) return;
  state.paused = false;
  if (state.source instanceof SimSource) state.source.setPaused(false);
  renderControls();
  // Picks up with what's relevant where you are now, not where you paused.
  startNext();
}

function skip() {
  if (!state.running || state.paused) return;
  abortSegments();
  startNext();
}

function stop() {
  state.running = false;
  state.paused = false;
  abortSegments();
  state.source?.stop();
  state.source = null;
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
  $("caption").textContent = "";
  status("Tap Start and walk. The guide talks about what's around you.");
  renderControls();
}

function renderControls() {
  $("main").textContent = !state.running ? "Start" : state.paused ? "Continue" : "Pause";
  /** @type {HTMLButtonElement} */ ($("skip")).disabled = !state.running || state.paused;
  /** @type {HTMLButtonElement} */ ($("stop")).disabled = !state.running;
}

$("main").addEventListener("click", () => (!state.running ? start() : state.paused ? resume() : pause()));
$("skip").addEventListener("click", skip);
$("stop").addEventListener("click", stop);

async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    // not supported or refused
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.running) requestWakeLock();
});
window.addEventListener("online", () => {
  if (state.running && !state.paused && !state.current) startNext();
});

// ---------- Status ----------

function status(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("err", isError);
}

function updateMeta() {
  const parts = ["History", SIM ? `${SIM.name}${SIM_SPEED !== 1 ? ` ×${SIM_SPEED}` : ""}` : "GPS"];
  if (callsToday) parts.push(`${callsToday} requests today`);
  $("meta").textContent = parts.join(" · ");
}

// ---------- Map ----------

const map = L.map("map", { zoomControl: false, attributionControl: true }).setView(SIM ? SIM.points[0] : [38.7115, -9.1365], 17);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);
const poiLayer = L.layerGroup().addTo(map);
let meMarker = null;
let headingLine = null;
let routeLine = null;
let followUntil = 0;
let lastPois = [];
map.on("dragstart", () => (followUntil = Date.now() + 20000));

function showPosition(p) {
  const ll = [p.lat, p.lon];
  if (!meMarker) {
    meMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#1f6fd1", fillOpacity: 1 }).addTo(map);
    map.setView(ll, 17);
  } else {
    meMarker.setLatLng(ll);
  }
  headingLine?.remove();
  headingLine = null;
  if (p.heading !== null) {
    const d = 0.0005;
    const rad = (p.heading * Math.PI) / 180;
    const end = [p.lat + d * Math.cos(rad), p.lon + (d * Math.sin(rad)) / Math.cos((p.lat * Math.PI) / 180)];
    headingLine = L.polyline([ll, end], { color: "#1f6fd1", weight: 3 }).addTo(map);
  }
  if (Date.now() > followUntil) map.panTo(ll, { animate: false });
  if (DEBUG) renderDebug();
}

function showRoute(coords) {
  routeLine?.remove();
  routeLine = L.polyline(coords, { color: "#1f6fd1", weight: 4, opacity: 0.35 }).addTo(map);
}

let lastPrepared = null;

/** @param {import("./tour.js").Prepared} prepared */
function showPrepared(prepared) {
  lastPrepared = prepared;
  lastPois = prepared.pois;
  if (prepared.place?.label) $("place").textContent = prepared.place.label.split(", ").slice(0, 3).join(", ");
  refreshPois();
  if (DEBUG) renderDebug();
}

function refreshPois() {
  poiLayer.clearLayers();
  const plan = state.current?.prepared?.plan;
  const targetId = plan && "target" in plan && plan.target ? plan.target.poi.id : null;
  for (const p of lastPois.slice(0, 150)) {
    const covered = state.session?.covered.has(p.id);
    const isTarget = p.id === targetId;
    L.circleMarker([p.lat, p.lon], {
      radius: isTarget ? 9 : 5,
      color: isTarget ? "#fff" : covered ? "#8a8f98" : "#c2621f",
      weight: isTarget ? 2 : 1,
      fillColor: isTarget ? "#e0731f" : covered ? "#8a8f98" : "#c2621f",
      fillOpacity: covered && !isTarget ? 0.5 : 0.9,
    })
      .bindTooltip(p.name)
      .addTo(poiLayer);
  }
}

// ---------- Debug ----------

function renderDebug() {
  const p = state.pos;
  const lines = [];
  if (p) {
    lines.push(`pos ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} ±${Math.round(p.accuracy ?? 0)} m`);
    lines.push(`speed ${p.speed === null ? "?" : (p.speed * 3.6).toFixed(1)} km/h, heading ${p.heading === null ? "?" : Math.round(p.heading)}°`);
  }
  lines.push(`current ${state.current ? (state.current.streamDone ? "done" : "streaming") : "-"}, next ${state.next ? (state.next.streamDone ? "ready" : "preparing") : "-"}`);
  if (lastPrepared) {
    lines.push(`mode ${lastPrepared.mode}, place ${lastPrepared.place?.label ?? "?"}`);
    lines.push(`plan ${planSummary(lastPrepared.plan)}`);
    for (const c of lastPrepared.ranked.slice(0, 8)) {
      const covered = state.session?.covered.has(c.poi.id) ? " ✓" : "";
      lines.push(`  ${c.score.toFixed(2)} ${c.poi.name} ${c.side} ${Math.round(c.distance)} m${c.eta !== null ? ` eta ${Math.round(c.eta)}s` : ""}${covered}`);
    }
  }
  $("debug").textContent = lines.join("\n");
}

// ---------- Init ----------

$("debug").hidden = !DEBUG;
updateMeta();
renderControls();
status(token ? "Tap Start and walk. The guide talks about what's around you." : "Add your key to the address: …/guide/?key=YOUR_KEY", !token);
