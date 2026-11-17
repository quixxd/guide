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

import { areaPhoto, factChips, placeFacts, placeOutline, placePhoto } from "./details.js";
import { angleDiff, bearingDeg, compassName, distanceM } from "./geo.js";
import { GpsSource, KeySource, SimSource } from "./position.js";
import { RelayError, callsToday, streamNarration } from "./relay.js";
import { walkingRoute } from "./sources.js";
import { SentenceBuffer, Speaker } from "./speech.js";
import { Session, planSummary, prepareSegment } from "./tour.js";
import { WALKS } from "./lenses.js";

/* global L */

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const params = new URLSearchParams(location.search);
if (params.get("key")) store.set("guide.token", params.get("key"));
let token = params.get("key") || store.get("guide.token");
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

// On a desktop browser (mouse, no touch) the walk is simulated by default: arrow keys move you.
// ?gps=1 forces real location; ?start=lat,lon picks where the keyboard walk begins.
const DESKTOP = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !("ontouchstart" in window);
const KEYS = !SIM && DESKTOP && !params.has("gps");
const BREMEN = { lat: 53.0757, lon: 8.8075 };
function keyStart() {
  const fromUrl = (params.get("start") ?? "").split(",").map(Number);
  if (fromUrl.length === 2 && fromUrl.every(Number.isFinite)) return { lat: fromUrl[0], lon: fromUrl[1] };
  try {
    const saved = JSON.parse(store.get("guide.keyPos") || "null");
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) return saved;
  } catch {
    // ignore a bad saved value
  }
  return BREMEN;
}

const GAP_AFTER_SEGMENT_MS = 1500;
const RETRY_AFTER_ERROR_MS = 10000;
const MAX_TOPICS = 5;
/** Before zooming out to the district or town, a pause after the last part. */
const AREA_BREAK_MS = 25000;

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
    this.isBreak = false;
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
  /** @type {GpsSource | SimSource | KeySource | null} */
  source: null,
  /** @type {{lat: number, lon: number, heading: number | null, speed: number | null, accuracy?: number} | null} */
  pos: null,
  /** @type {Segment | null} the segment being spoken */
  current: null,
  /** @type {Segment | null} the segment being prepared while the current one finishes */
  next: null,
  /** @type {import("./planner.js").Poi | null} A place the listener picked: the next segment is about it. */
  pendingFocus: null,
  /** When the last part finished playing. */
  lastEndedAt: 0,
  /** @type {import("./lenses.js").Lens | null} the walk picked on the start screen */
  walk: null,
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
    status(seg.focus ? `Turning to ${seg.focus.name}…` : state.session.segments.length ? "Looking around…" : "Finding where you are…");
  }
  run(seg);
}

/** @param {Segment} seg */
async function run(seg) {
  try {
    // Where the listener faces (compass, or the last walking direction) sets the field of view
    // while standing still.
    const prepared = await prepareSegment(state.session, { ...state.pos, facing: viewHeading() }, seg.focus);
    if (seg.ctl.signal.aborted) return;
    seg.prepared = prepared;
    showPrepared(prepared);
    const target = targetOf(prepared.plan);
    if (target) {
      // Look up the outline and photo now, so they're ready when this segment starts playing.
      placeOutline(target).catch(() => null);
      placePhoto(target).catch(() => null);
    }
    const sinceLast = Date.now() - state.lastEndedAt;
    const prefetching = state.current !== null && state.current !== seg;
    if (prepared.plan.kind === "silence") {
      seg.silence = true;
      seg.retryMs = prepared.plan.retryMs;
    } else if (prepared.plan.kind === "area" && (prefetching || sinceLast < AREA_BREAK_MS)) {
      // Zooming out to the district or town: take a break first, unless something nearby comes up.
      seg.silence = true;
      seg.isBreak = true;
      seg.retryMs = prefetching ? AREA_BREAK_MS : AREA_BREAK_MS - sinceLast;
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
  showSubject(seg.prepared);
  refreshPois();
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
    showQuiet(seg.isBreak);
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
  state.lastEndedAt = Date.now();
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
  loaded("spoken");
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
  stopLoading();
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

/** @param {string} lensId the walk picked on the start screen */
async function start(lensId = "history") {
  if (!token) {
    status("Enter your access key to start.", true);
    $("key-form").hidden = false;
    $("key-input").focus();
    return;
  }
  speaker.unlock(); // inside the tap, so mobile browsers allow speech later
  requestWakeLock();
  if (!SIM && !KEYS) startCompass(); // also inside the tap: iPhone asks for permission here
  state.running = true;
  state.paused = false;
  state.session = new Session([lensId]);
  state.walk = WALKS.find((w) => w.id === lensId) ?? WALKS[0];
  $("pill").textContent = state.walk.walk;
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
  } else if (KEYS) {
    state.source = new KeySource(keyStart(), (p) => {
      onPosition(p);
      store.set("guide.keyPos", JSON.stringify({ lat: p.lat, lon: p.lon }));
    }, SIM_SPEED);
    status("Walk with the arrow keys (Shift to go faster).");
  } else {
    state.source = new GpsSource(onPosition, (msg) => status(`Location: ${msg}`, true));
  }
  state.source.start();
  startNext();
}

function pause() {
  if (!state.running || state.paused) return;
  stopLoading();
  state.paused = true;
  abortSegments();
  if (state.source instanceof SimSource || state.source instanceof KeySource) state.source.setPaused(true);
  status("Paused.");
  renderControls();
}

function resume() {
  if (!state.paused) return;
  state.paused = false;
  if (state.source instanceof SimSource || state.source instanceof KeySource) state.source.setPaused(false);
  status("");
  renderControls();
  // Picks up with what's relevant where you are now, not where you paused.
  startNext();
}

function skip() {
  if (!state.running || state.paused) return;
  startLoading(null);
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
  stopLoading();
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
  setSheetState("peek");
  $("pill").textContent = "Guide";
  status("Pick a walk and go. The guide talks about what's around you.");
  renderControls();
}

/** A picked place (topic button, or its name on the map) is talked about right away. */
function tapTopic(poi) {
  map.closePopup();
  if (!state.running) return;
  if (subjectPoi?.id === poi.id && state.current) return; // already talking about it
  state.pendingFocus = poi;
  renderTopics();
  startLoading(poi.name);
  if (state.paused) {
    resume();
    return;
  }
  abortSegments();
  startNext();
}

// ---------- Waiting for the next part ----------
//
// After picking a place (or skipping), the old narration is cleared and a spinner takes the
// photo's place until the new part has started speaking and its photo is in (or known missing).

const loading = { on: false, spoken: false, photo: false };

/** @param {string | null} title the picked place's name, shown straight away */
function startLoading(title) {
  loading.on = true;
  loading.spoken = false;
  loading.photo = false;
  state.sentenceNow = "";
  state.sentencesStarted = 0;
  $("caption").textContent = "";
  $("progress-bar").style.width = "0";
  setRing(0);
  pointArrow($("dir"), null);
  if (title) $("title").textContent = title;
  $("sub").textContent = "Getting the story…";
  $("photo").hidden = true;
  $("photo-big").hidden = true;
  $("thumb").classList.add("loading");
  $("thumb").setAttribute("aria-busy", "true");
}

/** @param {"spoken" | "photo"} part */
function loaded(part) {
  if (!loading.on) return;
  loading[part] = true;
  if (loading.spoken && loading.photo) stopLoading();
}

function stopLoading() {
  loading.on = false;
  $("thumb").classList.remove("loading");
  $("thumb").removeAttribute("aria-busy");
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

// The walk buttons: one per lens.
for (const [i, w] of WALKS.entries()) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = i === 0 ? "walk first" : "walk";
  const name = document.createElement("b");
  name.textContent = w.walk;
  const line = document.createElement("span");
  line.textContent = w.tagline;
  b.append(name, line);
  b.addEventListener("click", () => start(w.id));
  $("walks").append(b);
}
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
//
// Three positions: "min" (a strip with the title and Play), "peek" (collapsed: photo, name, the
// sentence being spoken, topics) and "open" (everything). The height is set here and follows the
// finger while dragging; letting go snaps to the nearest position, or one step in the direction of
// a quick flick.

const sheet = $("sheet");
const sheetBody = $("body");
const ORDER = ["min", "peek", "open"];
/** @type {{ state: "min" | "peek" | "open", active: boolean, startY: number, startH: number, heights: Record<string, number>, samples: {t: number, y: number}[] }} */
const drag = { state: "peek", active: false, startY: 0, startH: 0, heights: { min: 0, peek: 0, open: 0 }, samples: [] };

function showLive(on) {
  $("idle").style.display = on ? "none" : "";
  $("live").style.display = on ? "contents" : "none";
  $("live-head").hidden = !on;
  refit();
}

const expandedHeight = () => Math.round(window.innerHeight * 0.88);

/** Natural height of the sheet in the given position, with its current content. */
function naturalHeight(position) {
  if (position === "open") return expandedHeight();
  const classes = sheet.className;
  const height = sheet.style.height;
  sheet.classList.remove("open", "min", "settling");
  if (position === "min") sheet.classList.add("min");
  sheet.style.height = "auto";
  const h = sheet.offsetHeight;
  sheet.className = classes;
  sheet.style.height = height;
  return Math.min(h, expandedHeight());
}

function setHeight(px, animate) {
  sheet.classList.toggle("settling", animate);
  sheet.style.height = `${Math.round(px)}px`;
}

/** @param {"min" | "peek" | "open"} position */
function setSheetState(position, animate = true) {
  const target = naturalHeight(position);
  drag.state = position;
  sheet.classList.toggle("open", position === "open");
  sheet.classList.toggle("min", position === "min");
  $("grab").setAttribute("aria-expanded", String(position === "open"));
  $("grab").setAttribute("aria-label", position === "open" ? "Show less" : "Show more");
  if (position !== "open") sheetBody.scrollTop = 0;
  setHeight(target, animate);
  renderCaption();
}

/** Keeps the sheet fitted to its content as that changes (the open sheet has a fixed height). */
function refit() {
  if (drag.state !== "open" && !drag.active) setHeight(naturalHeight(drag.state), true);
}

function beginDrag(y) {
  drag.active = true;
  drag.startY = y;
  drag.startH = sheet.offsetHeight;
  drag.heights = { min: naturalHeight("min"), peek: naturalHeight("peek"), open: expandedHeight() };
  drag.samples = [{ t: performance.now(), y }];
  sheet.classList.remove("settling");
}

function moveDrag(y) {
  const { min, peek, open } = drag.heights;
  const h = Math.max(min * 0.8, Math.min(open, drag.startH - (y - drag.startY)));
  // Show the content that belongs to the height the sheet is being pulled to.
  if (h > min + 8 && sheet.classList.contains("min")) sheet.classList.remove("min");
  if (h > peek + 8 && !sheet.classList.contains("open")) sheet.classList.add("open");
  sheet.style.height = `${h}px`;
  const now = performance.now();
  drag.samples.push({ t: now, y });
  while (drag.samples.length > 2 && now - drag.samples[0].t > 120) drag.samples.shift();
}

function endDrag(y) {
  drag.active = false;
  const first = drag.samples[0];
  const dt = performance.now() - first.t;
  const velocity = dt > 0 ? (y - first.y) / dt : 0; // px per ms, positive = downwards
  const h = sheet.offsetHeight;
  const snaps = ORDER.map((p) => ({ p, h: drag.heights[p] }));
  let target;
  if (velocity > 0.35) {
    // Flicked down: the next position below where it is now.
    target = [...snaps].reverse().find((s) => s.h < h - 4)?.p ?? "min";
  } else if (velocity < -0.35) {
    target = snaps.find((s) => s.h > h + 4)?.p ?? "open";
  } else {
    target = snaps.reduce((best, s) => (Math.abs(s.h - h) < Math.abs(best.h - h) ? s : best)).p;
  }
  setSheetState(/** @type {"min" | "peek" | "open"} */ (target), true);
}

/** Tap on the handle row: strip → collapsed → open → collapsed. */
function tapSheet() {
  setSheetState(drag.state === "peek" ? "open" : "peek");
}

// Handle row: the grab bar and the title row (not its Play button or photo). Mouse and touch.
{
  const zone = $("drag");
  let pointer = null;
  let downY = 0;
  let lastY = 0;
  let moved = false;
  zone.addEventListener("pointerdown", (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest("button, img")) return;
    pointer = e.pointerId;
    downY = lastY = e.clientY;
    moved = false;
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointer) return;
    lastY = e.clientY;
    if (!moved && Math.abs(e.clientY - downY) > 4) {
      moved = true;
      beginDrag(downY);
    }
    if (moved) moveDrag(e.clientY);
  });
  const finish = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (moved) endDrag(lastY);
    else if (e.type === "pointerup") tapSheet();
  };
  zone.addEventListener("pointerup", finish);
  zone.addEventListener("pointercancel", finish);
  $("grab").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tapSheet();
    }
  });
}

// The content area (touch): swipe up on the collapsed sheet to open it, down to shrink it to the
// strip; when open and scrolled to the top, swipe down to collapse it. Otherwise it scrolls.
{
  let start = null;
  let dragging = false;
  sheetBody.addEventListener("touchstart", (e) => {
    start = e.touches.length === 1 ? e.touches[0].clientY : null;
    dragging = false;
  }, { passive: true });
  sheetBody.addEventListener("touchmove", (e) => {
    if (start === null) return;
    const y = e.touches[0].clientY;
    const dy = y - start;
    if (!dragging) {
      const pullDown = (drag.state === "peek" || sheetBody.scrollTop <= 0) && dy > 6;
      const pullUp = drag.state !== "open" && dy < -6;
      if (!pullDown && !pullUp) return;
      dragging = true;
      beginDrag(start);
    }
    e.preventDefault();
    moveDrag(y);
  }, { passive: false });
  sheetBody.addEventListener("touchend", (e) => {
    if (dragging) endDrag(e.changedTouches[0].clientY);
    start = null;
    dragging = false;
  });
}

// Tap the two-line narration to read it all.
$("caption").addEventListener("click", () => {
  if (drag.state !== "open") setSheetState("open");
});

window.addEventListener("resize", () => {
  if (!drag.active) setSheetState(drag.state, false);
});

// Keep the map's attribution and controls above the sheet, whatever its height.
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`);
}).observe(sheet);

// ---------- Photo, full screen ----------

/** @type {{ url: string, link: string, credit: string, name: string } | null} */
let currentPhoto = null;

/** The same Wikimedia image at 1280 px (a standard width it serves), for the full-screen view. */
function largeImage(url) {
  return url.replace(/\/\d+px-/, "/1280px-").replace(/([?&]width=)\d+/, (_, prefix) => `${prefix}1280`);
}

function openLightbox() {
  if (!currentPhoto) return;
  const img = /** @type {HTMLImageElement} */ ($("lightbox-img"));
  img.src = currentPhoto.url; // shown at once, then swapped for the sharper one
  const large = largeImage(currentPhoto.url);
  if (large !== currentPhoto.url) {
    const sharp = new Image();
    sharp.onload = () => { if (!$("lightbox").hidden) img.src = large; };
    sharp.src = large;
  }
  img.alt = currentPhoto.name;
  $("lightbox-name").textContent = currentPhoto.name;
  $("lightbox-credit").textContent = `Photo: ${currentPhoto.credit}`;
  $("lightbox").hidden = false;
  $("lightbox-close").focus();
}

function closeLightbox() {
  $("lightbox").hidden = true;
}

$("photo").addEventListener("click", openLightbox);
$("photo-big").addEventListener("click", openLightbox);
$("lightbox-close").addEventListener("click", closeLightbox);
$("lightbox").addEventListener("click", (e) => {
  if (!(/** @type {HTMLElement} */ (e.target).closest("img"))) closeLightbox();
});
$("lightbox-img").addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("lightbox").hidden) closeLightbox();
});

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
  // No single place: show a photo of the street, quarter or town instead.
  const pl = prepared?.place;
  const town = pl?.town;
  const near = (n) => (n && town && n !== town ? `${n}, ${town}` : n);
  const areaNames = plan?.kind === "area" ? [plan.areaName, near(pl?.neighbourhood), town]
    : plan?.kind === "orientation" ? [near(pl?.road), near(pl?.neighbourhood), town] : [];
  showTarget(subjectPoi, areaNames);
  refit();
}

function showQuiet(isBreak = false) {
  stopLoading();
  subjectPoi = null;
  $("title").textContent = isBreak ? "A short break" : "Quiet stretch";
  $("sub").textContent = isBreak ? "More about the area in a moment." : "I'll speak up when there's something to tell.";
  $("caption").textContent = "";
  showTarget(null);
}

/** "On your right · 60 m", kept up to date as you walk. */
function updateSubtitle() {
  if (loading.on) return; // "Getting the story…" until the new part starts
  const plan = state.current?.prepared?.plan;
  const arrow = $("dir");
  if (subjectPoi && state.pos) {
    const dist = distanceM(state.pos, subjectPoi);
    $("sub").textContent = dist < 25 ? "Right here" : shortDistance(dist);
    pointArrow(arrow, dist < 25 ? null : bearingDeg(state.pos, subjectPoi));
    return;
  }
  pointArrow(arrow, null);
  if (plan?.kind === "area") $("sub").textContent = "The area around you";
  else if (plan?.kind === "orientation") $("sub").textContent = "Getting your bearings";
}

/** "40 m", "1.2 km". */
function shortDistance(m) {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * Turns the arrow to point at a place. When we know where the listener faces, "up" means
 * straight ahead (it turns as they turn); otherwise "up" means north, matching the map.
 * @param {HTMLElement} arrow @param {number | null} bearing compass bearing to the place, null hides it
 */
let arrowTurns = null;
function pointArrow(arrow, bearing) {
  // An <svg>: its hidden attribute has to be toggled directly (.hidden only exists on HTML elements).
  if (bearing === null) {
    arrow.toggleAttribute("hidden", true);
    arrowTurns = null;
    return;
  }
  const facing = viewHeading();
  const angle = facing === null ? bearing : bearing - facing;
  // Keep the rotation continuous so the arrow never spins the long way round.
  arrowTurns = arrowTurns === null ? angle : arrowTurns + angleDiff(angle, arrowTurns);
  arrow.style.transform = `rotate(${arrowTurns}deg)`;
  arrow.toggleAttribute("hidden", false);
  const rel = ((angle % 360) + 360) % 360;
  const words = facing === null ? `to the ${compassName(bearing)}`
    : rel < 30 || rel > 330 ? "straight ahead" : rel < 150 ? "to your right" : rel <= 210 ? "behind you" : "to your left";
  arrow.setAttribute("aria-label", words);
}

/** The ring around Play: how much of this part has been spoken (0..1). */
const RING = 2 * Math.PI * 30;
function setRing(fraction) {
  $("ring").style.strokeDashoffset = String(RING * (1 - fraction));
}

/** Collapsed: the sentence being spoken. Pulled up: the whole part, said / now / still to come. */
function renderCaption() {
  const cur = state.current;
  const text = cur?.text.trim() ?? "";
  const now = state.sentenceNow;
  const box = $("caption");
  const open = $("sheet").classList.contains("open");
  const total = cur?.streamDone ? cur.sentenceCount : Math.max(cur?.sentenceCount ?? 0, state.sentencesStarted + 1);
  const done = total ? Math.min(1, state.sentencesStarted / total) : 0;
  $("progress-bar").style.width = `${done * 100}%`;
  setRing(done);
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
    if (state.pendingFocus?.id === c.poi.id) b.classList.add("queued");
    const label = document.createElement("span");
    label.textContent = c.poi.name;
    b.append(label);
    b.addEventListener("click", () => tapTopic(c.poi));
    box.append(b);
    addChipPhoto(b, c.poi);
  }
  refit();
}

/** A small round preview photo at the start of a topic button, when the place has one. */
function addChipPhoto(button, poi) {
  placePhoto(poi)
    .then((photo) => {
      if (!photo || !button.isConnected) return;
      const img = new Image();
      img.className = "chip-img";
      img.alt = "";
      img.onload = () => {
        if (!button.isConnected) return;
        button.prepend(img);
        button.classList.add("with-img");
      };
      img.src = smallThumb(photo.url);
    })
    .catch(() => {});
}

/** The same Wikimedia image at 120 px, for small previews (Wikimedia only serves standard widths: 60, 120, 250, …). */
function smallThumb(url) {
  return url.replace(/\/\d+px-/, "/120px-").replace(/([?&]width=)\d+/, (_, prefix) => `${prefix}120`);
}

// ---------- Status ----------

function status(text, isError = false) {
  for (const id of ["status", "idle-status"]) {
    $(id).textContent = text;
    $(id).classList.toggle("err", isError);
  }
  refit();
}

function updateMeta() {
  const parts = [state.walk?.walk ?? "Historic walk", SIM ? `${SIM.name}${SIM_SPEED !== 1 ? ` ×${SIM_SPEED}` : ""}` : KEYS ? "Keyboard walk" : "GPS"];
  if (callsToday) parts.push(`${callsToday} requests today`);
  $("meta").textContent = parts.join(" · ");
}

// ---------- Map ----------

const initialView = SIM ? SIM.points[0] : KEYS ? [keyStart().lat, keyStart().lon] : [38.7115, -9.1365];
// keyboard: false, so the arrow keys walk instead of panning the map.
const map = L.map("map", { zoomControl: false, attributionControl: true, keyboard: false }).setView(initialView, 17);
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
  if (state.source instanceof KeySource) return state.source.lastHeading;
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
  updateSubtitle();
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
  $("pill").textContent = [state.walk?.walk ?? "Historic walk", town].filter(Boolean).join(" · ");
  refreshPois();
  renderTopics();
  if (DEBUG) renderDebug();
}

function refreshPois() {
  poiLayer.clearLayers();
  const targetId = subjectPoi?.id ?? null;
  const pois = lastPois.slice(0, 150);
  if (subjectPoi && !pois.some((p) => p.id === targetId)) pois.push(subjectPoi);
  // The subject last, so it sits on top.
  pois.sort((x, y) => Number(x.id === targetId) - Number(y.id === targetId));
  for (const p of pois) {
    const covered = state.session?.covered.has(p.id);
    const isTarget = p.id === targetId;
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: isTarget ? 11 : 7,
      color: "#ffffff",
      weight: isTarget ? 3 : 1.5,
      fillColor: isTarget ? "#c2410c" : covered ? "#8a8f98" : "#ea7a2e",
      fillOpacity: covered && !isTarget ? 0.75 : 1,
    });
    if (isTarget) {
      marker.bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -12], className: "subject-label" });
    }
    marker.bindPopup(() => poiCard(p, isTarget), { closeButton: false, className: "poi-pop", offset: [0, -6], autoPanPaddingBottomRight: [20, 20] });
    marker.addTo(poiLayer);
  }
}

/** The card shown when a place on the map is tapped: photo, and its name to tap to hear about it. */
function poiCard(poi, isTarget) {
  const el = document.createElement("div");
  el.className = "pop";
  const img = document.createElement("img");
  img.alt = "";
  img.hidden = true;
  el.append(img);
  const text = document.createElement("div");
  text.className = "pop-text";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "pop-name";
  name.textContent = poi.name;
  const hint = document.createElement("span");
  hint.className = "pop-hint";
  hint.textContent = isTarget ? "Playing now" : state.running ? "Tap the name to hear about it" : "Start the walk to hear about it";
  name.addEventListener("click", () => tapTopic(poi));
  text.append(name, hint);
  el.append(text);
  placePhoto(poi).then((photo) => {
    if (!photo) return;
    img.onload = () => { img.hidden = false; };
    img.src = smallThumb(photo.url);
  }).catch(() => {});
  return el;
}

// ---------- The place being talked about: outline and photo ----------

let shownTargetId = null;

/** Outlines the place on the map and shows its photo; clears both when there's no place. */
async function showTarget(poi, areaNames = []) {
  const names = poi ? [] : areaNames.filter(Boolean);
  const id = poi?.id ?? (names.length ? `area:${names.join("|")}` : null);
  if (id === shownTargetId) {
    // Same subject as before: its photo is already showing (or known missing).
    if (currentPhoto) {
      $("photo").hidden = false;
      $("photo-big").hidden = false;
    }
    loaded("photo");
    return;
  }
  shownTargetId = id;
  outlineLayer.clearLayers();
  const thumb = /** @type {HTMLImageElement} */ ($("photo"));
  const big = /** @type {HTMLImageElement} */ ($("photo-big"));
  thumb.hidden = true;
  big.hidden = true;
  currentPhoto = null;
  $("facts").hidden = true;
  $("facts").textContent = "";
  if (!id) {
    loaded("photo");
    return;
  }

  // Photo and outline arrive independently: the photo is usually quick, the outline search slower.
  const label = poi?.name ?? names[0];
  const photoJob = poi ? placePhoto(poi) : areaPhoto(names);
  photoJob.catch(() => null).then((photo) => {
    if (shownTargetId !== id) return;
    if (!photo) {
      loaded("photo");
      return;
    }
    thumb.onerror = () => loaded("photo");
    thumb.onload = () => {
      if (shownTargetId !== id) return;
      thumb.hidden = false;
      loaded("photo");
    };
    big.onload = () => { if (shownTargetId === id) big.hidden = false; };
    thumb.src = photo.url;
    big.src = photo.url;
    currentPhoto = { url: photo.url, link: photo.link, credit: photo.credit, name: label };
    thumb.alt = label;
    big.alt = `${label} (photo: ${photo.credit})`;
  });
  if (!poi) return; // areas get no outline or facts
  // Quick facts as chips under the big photo.
  placeFacts(poi).then((facts) => {
    if (shownTargetId !== id) return;
    const box = $("facts");
    for (const text of factChips(facts)) {
      const chip = document.createElement("span");
      chip.className = "fact";
      chip.textContent = text;
      box.append(chip);
    }
    box.hidden = !box.childElementCount;
  }).catch(() => {});
  const shapes = await placeOutline(poi).catch(() => null);
  if (shownTargetId !== id) return; // moved on while looking up
  for (const shape of shapes ?? []) {
    // Dark orange reads well on the light topo map.
    if (shape.kind === "polygon") {
      L.polygon(shape.coords, { color: "#c2410c", weight: 3, fillColor: "#f97316", fillOpacity: 0.2 }).addTo(outlineLayer);
    } else {
      L.polyline(shape.coords, { color: "#c2410c", weight: 6, opacity: 0.8 }).addTo(outlineLayer);
    }
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
    lines.push(`buildings ${lastPrepared.buildingsKnown ? `loaded, ${lastPrepared.hiddenCount} places hidden` : "not loaded (field of view only)"}`);
    lines.push(`plan ${planSummary(lastPrepared.plan)}`);
    for (const c of lastPrepared.ranked.slice(0, 8)) {
      const covered = state.session?.covered.has(c.poi.id) ? " ✓" : "";
      lines.push(`  ${c.score.toFixed(2)} ${c.poi.name} ${c.side} ${Math.round(c.distance)} m${c.eta !== null ? ` eta ${Math.round(c.eta)}s` : ""}${c.visible ? "" : " (hidden)"}${covered}`);
    }
  }
  $("debug").textContent = lines.join("\n");
}

// ---------- Init ----------

$("debug").hidden = !DEBUG;

// ---------- Installed app (PWA) ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// No key yet: an installed app on iPhone has its own storage, separate from Safari, so the key
// remembered from a ?key= link isn't there. Ask for it once.
$("key-form").hidden = !!token;
$("key-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = /** @type {HTMLInputElement} */ ($("key-input")).value.trim();
  if (!value) return;
  token = value;
  store.set("guide.token", value);
  $("key-form").hidden = true;
  status("Pick a walk and go. The guide talks about what's around you.");
});

// Offer to install: Android/desktop Chrome hand us the install prompt; iPhone needs the Share menu.
const STANDALONE = window.matchMedia("(display-mode: standalone)").matches || /** @type {any} */ (navigator).standalone === true;
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!STANDALONE) $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $("install").hidden = true;
});
window.addEventListener("appinstalled", () => ($("install").hidden = true));
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
$("install-ios").hidden = !(IOS && !STANDALONE);
$("idle-keys").hidden = !KEYS;
updateMeta();
setSheetState("peek", false);
renderControls();
status(token ? "Pick a walk and go. The guide talks about what's around you." : "Enter your access key to start.", !token);
