// Walk mode: press Start and the guide keeps talking about what's around you as you walk.
//
// Loop: prepare a segment (position → places → plan → sources → prompt), stream it from the
// relay, speak it sentence by sentence. While the last sentence plays, the next segment is
// prepared, so there's no long silence between segments.
//
// Screen (layout C1/C2): a full-screen map with a bottom sheet. Collapsed while walking: photo,
// name, where it is, the current sentence, topic buttons and Play/Pause. Pulled up: big photo,
// the whole narration, all topics, and replay / skip / stop.
//
// Address options: ?key=TOKEN (remembered), ?sim=bremen or ?sim=lat,lon;lat,lon (simulated walk),
// &speed=2 (simulation speed), &debug=1 (planner details).

import { placeOutline, placePhoto } from "./details.js";
import { describeDistance, describeSide, relativePosition } from "./geo.js";
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
  // Domshof → Marktplatz (town hall, Roland) → Böttcherstraße → Schlachte on the Weser → Schnoor.
  bremen: {
    name: "Bremen: Marktplatz to the Schnoor",
    points: [[53.0767, 8.8093], [53.0757, 8.807], [53.0746, 8.8058], [53.0737, 8.8043], [53.0727, 8.8117]],
  },
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
const MAX_TOPICS = 5;

const speaker = new Speaker();

class Segment {
  constructor(focus) {
    this.ctl = new AbortController();
    this.focus = focus;
    this.sentences = new SentenceBuffer();
    /** Sentences waiting until this segment becomes the one being spoken. */
    this.pending = [];
    this.text = "";
    this.sentenceCount = 0;
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
    this.sentenceCount++;
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
  /** A place the listener tapped: the next segment is about it. */
  pendingFocus: null,
  /** The sentence being spoken now, and how many of the current segment's have started. */
  sentenceNow: "",
  sentencesStarted: 0,
  timer: 0,
  wakeLock: null,
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
  const seg = new Segment(state.pendingFocus);
  state.pendingFocus = null;
  if (state.current) {
    state.next = seg;
  } else {
    state.current = seg;
    seg.active = true;
    status(seg.focus ? `Turning to ${seg.focus}…` : state.session.segments.length ? "Looking around…" : "Finding where you are…");
  }
  run(seg);
}

/** @param {Segment} seg */
async function run(seg) {
  try {
    const prepared = await prepareSegment(state.session, { ...state.pos }, seg.focus);
    if (seg.ctl.signal.aborted) return;
    seg.prepared = prepared;
    showPrepared(prepared);
    const target = targetOf(prepared.plan);
    if (target) {
      // Look up the outline and photo now, so they're ready when this segment starts playing.
      placeOutline(target).catch(() => null);
      placePhoto(target).catch(() => null);
    }
    if (prepared.plan.kind === "silence") {
      seg.silence = true;
      seg.retryMs = prepared.plan.retryMs;
    } else {
      if (seg.active) record(seg);
      await streamNarration(token, prepared.system, prepared.prompt, (t) => {
        seg.text += t;
        for (const s of seg.sentences.push(t)) seg.push(s);
        if (seg.active) renderCaption();
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

/** Marks the segment's place as covered once it starts playing, and shows it. @param {Segment} seg */
function record(seg) {
  if (seg.recorded || !seg.prepared || seg.silence) return;
  seg.recorded = true;
  state.session.record(seg.prepared);
  state.sentenceNow = "";
  state.sentencesStarted = 0;
  status("");
  refreshPois();
  showSubject(seg.prepared);
  renderTopics();
  renderCaption();
}

/** The place a plan is about, if any. @param {import("./planner.js").Plan} plan */
function targetOf(plan) {
  return "target" in plan && plan.target ? plan.target.poi : null;
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
    showQuiet();
    schedule(seg.retryMs);
    return;
  }
  renderCaption();
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
  state.sentenceNow = text;
  state.sentencesStarted++;
  renderCaption();
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
    status("The free daily quota is used up (or the relay's limit is reached). Try again later, or tap Play.", true);
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
  if (!SIM) startCompass(); // also inside the tap: iPhone asks for permission here
  state.running = true;
  state.paused = false;
  state.session = new Session(["history"]);
  state.pos = null;
  state.pendingFocus = null;
  showLive(true);
  showSubject(null);
  renderControls();

  const onPosition = (p) => {
    state.pos = p;
    showPosition(p);
    updateSubtitle();
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
  status("");
  renderControls();
  // Picks up with what's relevant where you are now, not where you paused.
  startNext();
}

function skip() {
  if (!state.running || state.paused) return;
  abortSegments();
  startNext();
}

/** Plays the current part again from its first sentence. */
function replay() {
  const cur = state.current;
  if (!cur || !cur.streamDone || !cur.text.trim()) return;
  speaker.cancel();
  state.sentenceNow = "";
  state.sentencesStarted = 0;
  const buf = new SentenceBuffer();
  for (const s of [...buf.push(cur.text), ...buf.flush()]) speaker.enqueue(s);
}

function stop() {
  state.running = false;
  state.paused = false;
  abortSegments();
  state.source?.stop();
  state.source = null;
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
  stopCompass();
  showTarget(null);
  showLive(false);
  setSheetOpen(false);
  status("Tap Start and walk. The guide talks about what's around you.");
  renderControls();
}

/** A tapped topic becomes the next segment, after the current one finishes. */
function tapTopic(poi) {
  if (!state.running) return;
  state.pendingFocus = poi.name;
  renderTopics();
  status(`Next: ${poi.name}`);
  if (state.next) {
    state.next.ctl.abort();
    state.next = null;
  }
  if (state.paused) resume();
  else if (!state.current) startNext();
  else if (state.current.streamDone && speaker.queue.length === 0) startNext();
}

const ICON_PAUSE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';
const ICON_PLAY = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"></path></svg>';

function renderControls() {
  const playing = state.running && !state.paused;
  $("play").innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  /** @type {HTMLButtonElement} */ ($("skip")).disabled = !playing;
  /** @type {HTMLButtonElement} */ ($("replay")).disabled = !playing;
}

$("start").addEventListener("click", start);
$("play").addEventListener("click", () => (state.paused ? resume() : pause()));
$("skip").addEventListener("click", skip);
$("replay").addEventListener("click", replay);
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

// ---------- Sheet ----------

function showLive(on) {
  $("idle").style.display = on ? "none" : "";
  $("live").style.display = on ? "contents" : "none";
}

function setSheetOpen(open) {
  $("sheet").classList.toggle("open", open);
  $("grab").setAttribute("aria-expanded", String(open));
  $("grab").setAttribute("aria-label", open ? "Show less" : "Show more");
  if (!open) $("sheet").scrollTop = 0;
  renderCaption();
}

// Keep the map's attribution and controls above the sheet, whatever its height.
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--sheet-h", `${$("sheet").offsetHeight}px`);
}).observe($("sheet"));

// Drag the handle (or tap it) to pull the sheet up or push it down.
{
  let startY = null;
  const grab = $("grab");
  grab.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener("pointerup", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    const open = $("sheet").classList.contains("open");
    if (Math.abs(dy) < 10) setSheetOpen(!open);
    else if (dy < -30) setSheetOpen(true);
    else if (dy > 30) setSheetOpen(false);
  });
  grab.addEventListener("pointercancel", () => (startY = null));
}

// ---------- What the guide is talking about ----------

/** @type {import("./planner.js").Poi | null} */
let subjectPoi = null;

/** Title, subtitle, photo and outline for the segment that just started. @param {import("./tour.js").Prepared | null} prepared */
function showSubject(prepared) {
  const plan = prepared?.plan;
  subjectPoi = plan ? targetOf(plan) : null;
  if (subjectPoi) {
    $("title").textContent = subjectPoi.name;
  } else if (plan?.kind === "area") {
    $("title").textContent = plan.areaName;
  } else if (plan?.kind === "orientation") {
    $("title").textContent = prepared.place?.road ?? prepared.place?.town ?? "Where you are";
  } else {
    $("title").textContent = "Finding where you are…";
  }
  updateSubtitle();
  showTarget(subjectPoi);
}

function showQuiet() {
  subjectPoi = null;
  $("title").textContent = "Quiet stretch";
  $("sub").textContent = "I'll speak up when there's something to tell.";
  $("caption").textContent = "";
  showTarget(null);
}

/** "On your right · 60 m", kept up to date as you walk. */
function updateSubtitle() {
  const plan = state.current?.prepared?.plan;
  if (subjectPoi && state.pos) {
    const rel = relativePosition(state.pos, state.pos.heading, subjectPoi);
    const side = describeSide(rel);
    $("sub").textContent = `${side.charAt(0).toUpperCase()}${side.slice(1)} · ${describeDistance(rel.distance)}`;
  } else if (plan?.kind === "area") {
    $("sub").textContent = "The area around you";
  } else if (plan?.kind === "orientation") {
    $("sub").textContent = "Getting your bearings";
  }
}

/** Collapsed: the sentence being spoken. Pulled up: the whole part, said / now / still to come. */
function renderCaption() {
  const cur = state.current;
  const text = cur?.text.trim() ?? "";
  const now = state.sentenceNow;
  const box = $("caption");
  const open = $("sheet").classList.contains("open");
  const total = cur?.streamDone ? cur.sentenceCount : Math.max(cur?.sentenceCount ?? 0, state.sentencesStarted + 1);
  $("progress-bar").style.width = `${total ? Math.min(100, (state.sentencesStarted / total) * 100) : 0}%`;
  if (!open) {
    box.textContent = now || "";
    return;
  }
  const at = now ? text.indexOf(now) : -1;
  box.textContent = "";
  if (at < 0) {
    box.textContent = text;
    return;
  }
  const said = document.createElement("span");
  said.className = "said";
  said.textContent = text.slice(0, at);
  const current = document.createElement("span");
  current.className = "now";
  current.textContent = now;
  const rest = document.createElement("span");
  rest.className = "said";
  rest.textContent = text.slice(at + now.length);
  box.append(said, current, rest);
}

/** Topic buttons: notable places around you that haven't been covered yet. */
function renderTopics() {
  const box = $("chips");
  box.textContent = "";
  const ranked = lastPrepared?.ranked ?? [];
  const seen = new Set();
  const picks = ranked.filter((c) => {
    if (c.poi.id === subjectPoi?.id || state.session?.covered.has(c.poi.id) || c.poi.notability < 0.8) return false;
    if (c.poi.categories.includes("area") || seen.has(c.poi.name)) return false;
    seen.add(c.poi.name);
    return true;
  }).slice(0, MAX_TOPICS);
  for (const c of picks) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    if (state.pendingFocus === c.poi.name) b.classList.add("queued");
    b.textContent = c.poi.name;
    b.addEventListener("click", () => tapTopic(c.poi));
    box.append(b);
  }
}

// ---------- Status ----------

function status(text, isError = false) {
  for (const id of ["status", "idle-status"]) {
    $(id).textContent = text;
    $(id).classList.toggle("err", isError);
  }
}

function updateMeta() {
  const parts = ["History", SIM ? `${SIM.name}${SIM_SPEED !== 1 ? ` ×${SIM_SPEED}` : ""}` : "GPS"];
  if (callsToday) parts.push(`${callsToday} requests today`);
  $("meta").textContent = parts.join(" · ");
}

// ---------- Map ----------

const map = L.map("map", { zoomControl: false, attributionControl: true }).setView(SIM ? SIM.points[0] : [38.7115, -9.1365], 17);
// Esri World Topo. Esri's terms expect an ArcGIS account beyond development use; fine for the prototype.
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Tiles &copy; Esri and contributors | Places &copy; OpenStreetMap contributors, Wikipedia",
}).addTo(map);
const outlineLayer = L.layerGroup().addTo(map);
const poiLayer = L.layerGroup().addTo(map);
let routeLine = null;
let followUntil = 0;
let lastPois = [];
map.on("dragstart", () => (followUntil = Date.now() + 20000));
$("recentre").addEventListener("click", () => {
  followUntil = 0;
  if (state.pos) map.setView([state.pos.lat, state.pos.lon], Math.max(map.getZoom(), 17));
});

// "You are here": a blue dot with a fading view cone (Google Maps style) and an accuracy circle.
const ME_ICON = L.divIcon({
  className: "me-icon",
  iconSize: [120, 120],
  iconAnchor: [60, 60],
  html: `<svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
    <defs><radialGradient id="me-cone" cx="60" cy="60" r="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4285f4" stop-opacity="0.6"></stop>
      <stop offset="1" stop-color="#4285f4" stop-opacity="0"></stop>
    </radialGradient></defs>
    <g class="cone" style="display:none"><path d="M60 60 L27.88 14.13 A56 56 0 0 1 92.12 14.13 Z" fill="url(#me-cone)"></path></g>
    <circle cx="60" cy="60" r="11" fill="#ffffff"></circle>
    <circle cx="60" cy="60" r="8" fill="#4285f4"></circle>
  </svg>`,
});
let meMarker = null;
let accuracyCircle = null;

function showPosition(p) {
  const ll = [p.lat, p.lon];
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: ME_ICON, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    map.setView(ll, 17);
  } else {
    meMarker.setLatLng(ll);
  }
  const acc = p.accuracy ?? 0;
  if (acc > 15) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle(ll, { radius: acc, stroke: false, fillColor: "#4285f4", fillOpacity: 0.12, interactive: false }).addTo(map);
    } else {
      accuracyCircle.setLatLng(ll).setRadius(acc);
    }
  } else {
    accuracyCircle?.remove();
    accuracyCircle = null;
  }
  updateCone();
  if (Date.now() > followUntil) map.panTo(ll, { animate: false });
  if (DEBUG) renderDebug();
}

/** Which way the cone points: the phone's compass on a real walk, else the walking direction. */
function viewHeading() {
  if (!SIM && compass.heading !== null && Date.now() - compass.at < 3000) return compass.heading;
  return state.pos?.heading ?? null;
}

let coneTurns = 0;
let coneLast = null;
function updateCone() {
  const cone = meMarker?.getElement()?.querySelector(".cone");
  if (!cone) return;
  const h = viewHeading();
  if (h === null) {
    cone.style.display = "none";
    return;
  }
  // Keep rotation continuous across north, so the cone doesn't spin the long way round.
  if (coneLast !== null) {
    const d = ((h - coneLast + 540) % 360) - 180;
    coneTurns += d;
  } else {
    coneTurns = h;
  }
  coneLast = h;
  cone.style.display = "";
  cone.style.transform = `rotate(${coneTurns}deg)`;
}

// Compass (device orientation). Smoothed; iPhone needs permission from a tap.
const compass = { heading: null, at: 0, listening: false };
/** @param {any} e DeviceOrientationEvent (webkitCompassHeading on iPhone) */
function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha !== null) h = (360 - e.alpha) % 360;
  if (h === null || Number.isNaN(h)) return;
  h = (h + (screen.orientation?.angle ?? 0) + 360) % 360;
  if (compass.heading === null) compass.heading = h;
  else compass.heading = (compass.heading + (((h - compass.heading + 540) % 360) - 180) * 0.25 + 360) % 360;
  compass.at = Date.now();
  requestAnimationFrame(updateCone);
}
const ORIENTATION_EVENT = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
function startCompass() {
  const listen = () => {
    window.addEventListener(ORIENTATION_EVENT, onOrientation);
    compass.listening = true;
  };
  const DOE = /** @type {any} */ (window).DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    DOE.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
  } else {
    listen();
  }
}
function stopCompass() {
  if (compass.listening) window.removeEventListener(ORIENTATION_EVENT, onOrientation);
  compass.listening = false;
  compass.heading = null;
}

function showRoute(coords) {
  routeLine?.remove();
  routeLine = L.polyline(coords, { color: "#2563eb", weight: 5, opacity: 0.35 }).addTo(map);
}

let lastPrepared = null;

/** @param {import("./tour.js").Prepared} prepared */
function showPrepared(prepared) {
  lastPrepared = prepared;
  lastPois = prepared.pois;
  const town = prepared.place?.town ?? prepared.place?.neighbourhood;
  $("pill").textContent = ["History walk", town].filter(Boolean).join(" · ");
  refreshPois();
  renderTopics();
  if (DEBUG) renderDebug();
}

function refreshPois() {
  poiLayer.clearLayers();
  const targetId = subjectPoi?.id ?? null;
  for (const p of lastPois.slice(0, 150)) {
    const covered = state.session?.covered.has(p.id);
    const isTarget = p.id === targetId;
    L.circleMarker([p.lat, p.lon], {
      radius: isTarget ? 9 : 6,
      color: "#ffffff",
      weight: 1.5,
      fillColor: isTarget ? "#c2410c" : covered ? "#8a8f98" : "#ea7a2e",
      fillOpacity: covered && !isTarget ? 0.7 : 1,
    })
      .bindTooltip(p.name)
      .on("click", () => tapTopic(p))
      .addTo(poiLayer);
  }
}

// ---------- The place being talked about: outline and photo ----------

let shownTargetId = null;

/** Outlines the place on the map and shows its photo; clears both when there's no place. */
async function showTarget(poi) {
  const id = poi?.id ?? null;
  if (id === shownTargetId) return;
  shownTargetId = id;
  outlineLayer.clearLayers();
  const thumb = /** @type {HTMLImageElement} */ ($("photo"));
  const big = /** @type {HTMLImageElement} */ ($("photo-big"));
  thumb.hidden = true;
  big.classList.remove("has");
  if (!poi) return;

  const [shapes, photo] = await Promise.all([placeOutline(poi).catch(() => null), placePhoto(poi).catch(() => null)]);
  if (shownTargetId !== id) return; // moved on while looking up
  for (const shape of shapes ?? []) {
    // Dark orange reads well on the light topo map.
    if (shape.kind === "polygon") {
      L.polygon(shape.coords, { color: "#c2410c", weight: 3, fillColor: "#f97316", fillOpacity: 0.2 }).addTo(outlineLayer);
    } else {
      L.polyline(shape.coords, { color: "#c2410c", weight: 6, opacity: 0.8 }).addTo(outlineLayer);
    }
  }
  if (photo) {
    thumb.onload = () => { if (shownTargetId === id) thumb.hidden = false; };
    big.onload = () => { if (shownTargetId === id) big.classList.add("has"); };
    thumb.src = photo.url;
    big.src = photo.url;
    thumb.alt = poi.name;
    big.alt = `${poi.name} (photo: ${photo.credit})`;
  }
}

// ---------- Debug ----------

function renderDebug() {
  const p = state.pos;
  const lines = [];
  if (p) {
    lines.push(`pos ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} ±${Math.round(p.accuracy ?? 0)} m`);
    lines.push(`speed ${p.speed === null ? "?" : (p.speed * 3.6).toFixed(1)} km/h, heading ${p.heading === null ? "?" : Math.round(p.heading)}°, compass ${compass.heading === null ? "-" : Math.round(compass.heading)}°`);
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
