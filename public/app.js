import { accessKey, getJson, postJson, postStream } from "./api.js";
import { GpsSource, SimSource } from "./position.js";
import { Listener, SentenceBuffer, Speaker } from "./speech.js";

const $ = (id) => document.getElementById(id);

const PRESETS = [
  { name: "Lisbon: Alfama to Baixa (walk)", mode: "walk", from: [38.7116, -9.1305], to: [38.7075, -9.1364] },
  { name: "Lisbon: Bairro Alto to Chiado (walk)", mode: "walk", from: [38.7155, -9.1443], to: [38.7106, -9.1426] },
  { name: "Lisbon: Cais do Sodré to Belém (bus)", mode: "bus", from: [38.706, -9.1446], to: [38.6979, -9.2068] },
  { name: "Lisbon: Belém to Cascais coast road (drive)", mode: "drive", from: [38.6916, -9.216], to: [38.6979, -9.4215] },
  { name: "Sintra to Cabo da Roca (drive)", mode: "drive", from: [38.7979, -9.3904], to: [38.7804, -9.4989] },
  { name: "Porto: Ribeira to Clérigos (walk)", mode: "walk", from: [41.1406, -8.6131], to: [41.1457, -8.6146] },
  { name: "Évora: Roman Temple to Praça do Giraldo (walk)", mode: "walk", from: [38.5728, -7.9073], to: [38.5711, -7.9093] },
];

const GAP_AFTER_SEGMENT_MS = 1500;
const MAX_CARDS = 6; // current + 5 recent

const speaker = new Speaker();
const listener = new Listener();

const state = {
  lenses: new Set(["surprise"]),
  lensList: [],
  sessionId: null,
  source: null,
  sim: null,
  pos: null,
  // idle | fetching | speaking | waiting | paused | listening | answering | stopped
  phase: "stopped",
  ctl: null,
  timer: null,
  streamDone: false,
  answerDone: false,
  pendingControl: null,
  wasPaused: false,
  pendingFocus: null,
  currentText: "",
  lastSegmentText: "",
  cards: [],
  wakeLock: null,
  mediaAudio: null,
  offlineAnnounced: false,
};

// ---------- Start screen ----------

async function loadLenses() {
  try {
    state.lensList = await getJson("/api/lenses");
  } catch (err) {
    $("start-status").textContent = accessKey()
      ? `Couldn't reach the server: ${err.message}`
      : "Open this page with the link that includes ?key=… to use the guide.";
    return;
  }
  const box = $("lens-chips");
  box.innerHTML = "";
  for (const lens of state.lensList) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = lens.label;
    b.title = lens.covers;
    b.dataset.id = lens.id;
    b.addEventListener("click", () => toggleLens(lens.id));
    box.append(b);
  }
  renderLensChips();
}

function toggleLens(id) {
  if (id === "surprise") state.lenses = new Set(["surprise"]);
  else {
    state.lenses.delete("surprise");
    state.lenses.has(id) ? state.lenses.delete(id) : state.lenses.add(id);
    if (!state.lenses.size) state.lenses.add("surprise");
  }
  renderLensChips();
}

function renderLensChips() {
  for (const b of $("lens-chips").children) b.setAttribute("aria-pressed", String(state.lenses.has(b.dataset.id)));
}

function lensLabels() {
  return [...state.lenses].map((id) => state.lensList.find((l) => l.id === id)?.label ?? id).join(" · ");
}

function setupVoiceSettings() {
  const select = $("voice-select");
  const fill = () => {
    const voices = speaker.voices();
    select.innerHTML = "";
    if (!voices.length) {
      select.append(new Option("Default voice", ""));
      return;
    }
    for (const v of voices) select.append(new Option(`${v.name} (${v.lang})`, v.voiceURI, false, v === speaker.voice));
  };
  fill();
  if (speaker.supported) speechSynthesis.addEventListener?.("voiceschanged", fill);
  select.addEventListener("change", () => speaker.setVoice(select.value));
  $("rate").value = String(speaker.rate);
  $("rate").addEventListener("input", (e) => speaker.setRate(Number(e.target.value)));
  $("test-voice").addEventListener("click", () => {
    speaker.cancel();
    speaker.enqueue("Hello! This is how your tour guide will sound. On your left, a rather fine old church.");
  });
}

// Simulation setup map
const simSetup = { map: null, start: null, end: null, startMarker: null, endMarker: null, line: null, route: null };

function setupSimulation() {
  const preset = $("sim-preset");
  preset.append(new Option("Choose a preset route…", ""));
  PRESETS.forEach((p, i) => preset.append(new Option(p.name, String(i))));

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener("change", () => {
      const sim = sourceKind() === "sim";
      $("sim-setup").hidden = !sim;
      if (sim) initSimMap();
    });
  }

  preset.addEventListener("change", () => {
    const p = PRESETS[Number(preset.value)];
    if (!p) return;
    $("sim-mode").value = p.mode;
    setSimPoint("start", p.from);
    setSimPoint("end", p.to);
    simSetup.map.fitBounds([p.from, p.to], { padding: [30, 30] });
  });
  $("sim-mode").addEventListener("change", () => previewRoute());

  $("sim-search").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    try {
      const hits = await getJson(`/api/geocode?q=${encodeURIComponent(e.target.value)}`);
      if (hits[0]) simSetup.map.setView([hits[0].lat, hits[0].lon], 15);
      else $("sim-hint").textContent = "No place found.";
    } catch (err) {
      $("sim-hint").textContent = `Search failed: ${err.message}`;
    }
  });
}

function initSimMap() {
  if (simSetup.map) {
    simSetup.map.invalidateSize();
    return;
  }
  simSetup.map = L.map("sim-map").setView([38.7115, -9.1365], 14);
  tiles().addTo(simSetup.map);
  simSetup.map.on("click", (e) => {
    const p = [e.latlng.lat, e.latlng.lng];
    if (!simSetup.start || simSetup.end) {
      setSimPoint("end", null);
      setSimPoint("start", p);
    } else {
      setSimPoint("end", p);
    }
  });
}

function setSimPoint(which, p) {
  const markerKey = `${which}Marker`;
  simSetup[which] = p;
  simSetup[markerKey]?.remove();
  simSetup[markerKey] = null;
  if (p) {
    simSetup[markerKey] = L.circleMarker(p, {
      radius: 8,
      color: which === "start" ? "#2e8b57" : "#b3412f",
      fillOpacity: 0.9,
    })
      .bindTooltip(which === "start" ? "Start" : "End")
      .addTo(simSetup.map);
  }
  previewRoute();
}

async function previewRoute() {
  simSetup.route = null;
  simSetup.line?.remove();
  if (!simSetup.start || !simSetup.end) {
    $("sim-hint").textContent = simSetup.start ? "Now tap the end point." : "Pick a preset, or tap the map to set a start point.";
    return;
  }
  $("sim-hint").textContent = "Finding a route…";
  try {
    const mode = $("sim-mode").value;
    const r = await getJson(`/api/route?from=${simSetup.start.join(",")}&to=${simSetup.end.join(",")}&mode=${mode}`);
    simSetup.route = r;
    simSetup.line = L.polyline(r.coords, { color: "#1f6f8b", weight: 4 }).addTo(simSetup.map);
    const km = (r.distance / 1000).toFixed(1);
    $("sim-hint").textContent = `Route: ${km} km. Ready to start.`;
  } catch (err) {
    $("sim-hint").textContent = `Couldn't find a route: ${err.message}`;
  }
}

function sourceKind() {
  return document.querySelector('input[name="source"]:checked').value;
}

function tiles() {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  });
}

// ---------- Tour map ----------

const tourMap = { map: null, me: null, heading: null, pois: L.layerGroup(), route: null, followUntil: 0 };

function initTourMap() {
  if (!tourMap.map) {
    tourMap.map = L.map("tour-map", { zoomControl: false }).setView([38.7115, -9.1365], 16);
    tiles().addTo(tourMap.map);
    tourMap.pois.addTo(tourMap.map);
    tourMap.map.on("dragstart", () => (tourMap.followUntil = Date.now() + 20000));
  }
  setTimeout(() => tourMap.map.invalidateSize(), 50);
}

function updateMapPosition(pos) {
  if (!tourMap.map) return;
  const ll = [pos.lat, pos.lon];
  if (!tourMap.me) {
    tourMap.me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#1f6f8b", fillOpacity: 1 }).addTo(tourMap.map);
    tourMap.map.setView(ll, 16);
  } else {
    tourMap.me.setLatLng(ll);
  }
  tourMap.heading?.remove();
  if (pos.heading !== null) {
    const d = 0.0006;
    const end = [pos.lat + d * Math.cos((pos.heading * Math.PI) / 180), pos.lon + (d * Math.sin((pos.heading * Math.PI) / 180)) / Math.cos((pos.lat * Math.PI) / 180)];
    tourMap.heading = L.polyline([ll, end], { color: "#1f6f8b", weight: 3 }).addTo(tourMap.map);
  }
  if (Date.now() > tourMap.followUntil) tourMap.map.panTo(ll, { animate: false });
}

function updateMapPois(pois) {
  tourMap.pois.clearLayers();
  for (const p of pois) {
    L.circleMarker([p.lat, p.lon], {
      radius: 5,
      color: p.covered ? "#8a8f98" : "#c2621f",
      fillOpacity: 0.8,
      weight: 1,
    })
      .bindTooltip(p.name)
      .addTo(tourMap.pois);
  }
}

// ---------- Tour lifecycle ----------

async function startTour() {
  // Everything that needs a user gesture happens first.
  speaker.unlock();
  startMediaSession();
  requestWakeLock();

  const kind = sourceKind();
  if (kind === "sim" && !simSetup.route) {
    $("start-status").textContent = "Set a start and end point for the simulated route first.";
    return;
  }

  $("start-btn").disabled = true;
  $("start-status").textContent = "Starting…";
  try {
    const res = await postJson("/api/session", { lenses: [...state.lenses] });
    state.sessionId = res.sessionId;
  } catch (err) {
    $("start-btn").disabled = false;
    $("start-status").textContent = `Couldn't start: ${err.message}`;
    return;
  }

  $("start").hidden = true;
  $("tour").hidden = false;
  $("start-btn").disabled = false;
  $("start-status").textContent = "";
  $("active-lenses").textContent = lensLabels();
  $("debug").hidden = !$("show-debug").checked;
  $("ask-fallback").hidden = listener.supported;
  state.cards = [];
  renderCards();
  initTourMap();

  state.pos = null;
  const onPosition = (p) => {
    state.pos = p;
    updateMapPosition(p);
    renderDebugPosition();
  };
  if (kind === "sim") {
    tourMap.route?.remove();
    tourMap.route = L.polyline(simSetup.route.coords, { color: "#1f6f8b", weight: 3, opacity: 0.5 }).addTo(tourMap.map);
    state.sim = new SimSource(simSetup.route, $("sim-mode").value, onPosition, () => setStatus("End of the simulated route"));
    state.sim.setMultiplier(Number($("sim-speed").value));
    state.source = state.sim;
    $("sim-controls").hidden = false;
    $("sim-play").textContent = $("sim-mode").value === "walk" ? "Pause walk" : "Pause ride";
  } else {
    state.sim = null;
    state.source = new GpsSource(onPosition, (msg) => setStatus(`Location: ${msg}`));
    $("sim-controls").hidden = true;
  }
  state.source.start();

  state.phase = "waiting";
  setStatus("Finding where you are…");
  renderPauseButton();
  requestNext();
}

async function stopTour() {
  state.phase = "stopped";
  abortStream();
  speaker.cancel();
  clearTimeout(state.timer);
  state.source?.stop();
  state.source = null;
  stopMediaSession();
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
  if (state.sessionId) postJson("/api/stop", { sessionId: state.sessionId }).catch(() => {});
  state.sessionId = null;
  $("tour").hidden = true;
  $("start").hidden = false;
}

function abortStream() {
  state.ctl?.abort();
  state.ctl = null;
}

function schedule(ms) {
  clearTimeout(state.timer);
  state.timer = setTimeout(requestNext, ms);
}

function localTime() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function requestNext() {
  if (!["waiting", "idle"].includes(state.phase)) return;
  clearTimeout(state.timer);
  if (!state.pos) {
    setStatus("Waiting for your location…");
    schedule(2000);
    return;
  }

  state.phase = "fetching";
  state.streamDone = false;
  state.currentText = "";
  let gotText = false;
  const buf = new SentenceBuffer();
  const ctl = new AbortController();
  state.ctl = ctl;
  const focus = state.pendingFocus;
  state.pendingFocus = null;
  setStatus(focus ? `Going deeper on ${focus}…` : "Thinking…");

  try {
    await postStream(
      "/api/next",
      { sessionId: state.sessionId, pos: state.pos, focus, localTime: localTime() },
      (ev) => {
        if (state.ctl !== ctl) return;
        switch (ev.type) {
          case "debug":
            state.lastDebug = ev;
            renderDebugPosition();
            break;
          case "pois":
            updateMapPois(ev.pois);
            break;
          case "card":
            addCards([ev.label], true);
            break;
          case "cards":
            addCards(ev.labels, false);
            break;
          case "text":
            if (!gotText) {
              gotText = true;
              state.phase = "speaking";
              setStatus("Speaking");
            }
            state.currentText += ev.text;
            for (const s of buf.push(ev.text)) speaker.enqueue(s);
            break;
          case "silence":
            state.phase = "waiting";
            setStatus("Quiet stretch: I'll speak up when there's something to tell");
            schedule(ev.retryMs);
            break;
          case "error":
            setStatus(ev.message);
            break;
          case "done":
            state.streamDone = true;
            for (const s of buf.flush()) speaker.enqueue(s);
            if (state.phase === "fetching") {
              // Nothing was said (error or empty reply): try again shortly.
              state.phase = "waiting";
              schedule(8000);
            } else if (state.phase === "speaking" && !speaker.busy) {
              segmentEnded();
            }
            break;
        }
      },
      ctl.signal,
    );
    state.offlineAnnounced = false;
  } catch (err) {
    if (ctl.signal.aborted || state.ctl !== ctl) return;
    if (state.phase === "fetching" || state.phase === "speaking") {
      state.phase = "waiting";
      handleConnectionError(err);
    }
  }
}

function handleConnectionError(err) {
  if (!navigator.onLine && !state.offlineAnnounced) {
    state.offlineAnnounced = true;
    speaker.enqueue("I've lost connection. I'll pick up again once we're back online.");
  }
  setStatus(`Connection problem (${err.message}). Retrying…`);
  schedule(10000);
}

function segmentEnded() {
  if (state.currentText) state.lastSegmentText = state.currentText;
  state.phase = "waiting";
  setStatus("…");
  schedule(GAP_AFTER_SEGMENT_MS);
}

speaker.onIdle = () => {
  if (state.phase === "speaking" && state.streamDone) segmentEnded();
  else if (state.phase === "answering" && state.answerDone) answerEnded();
};
speaker.onSentence = (text) => {
  $("caption").textContent = text;
};

// ---------- Controls ----------

function pause() {
  if (state.phase === "stopped" || state.phase === "paused") return;
  abortStream();
  speaker.cancel();
  clearTimeout(state.timer);
  if (state.currentText) state.lastSegmentText = state.currentText;
  state.phase = "paused";
  setStatus("Paused");
  renderPauseButton();
}

function resume() {
  if (state.phase !== "paused") return;
  state.phase = "waiting";
  renderPauseButton();
  // Picks up with what's relevant where you are now, not where you paused.
  requestNext();
}

function skip() {
  if (state.phase === "stopped") return;
  abortStream();
  speaker.cancel();
  if (state.currentText) state.lastSegmentText = state.currentText;
  state.phase = "waiting";
  renderPauseButton();
  requestNext();
}

function replay() {
  const text = state.phase === "speaking" ? state.currentText : state.lastSegmentText;
  if (!text || state.phase === "stopped") return;
  abortStream();
  speaker.cancel();
  clearTimeout(state.timer);
  state.wasPaused = false;
  state.phase = "answering";
  state.answerDone = true;
  state.pendingControl = null;
  renderPauseButton();
  setStatus("Replaying");
  const buf = new SentenceBuffer();
  for (const s of [...buf.push(text), ...buf.flush()]) speaker.enqueue(s);
}

function renderPauseButton() {
  $("pause-btn").textContent = state.phase === "paused" ? "Continue" : "Pause";
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state.phase === "paused" ? "paused" : "playing";
}

function setStatus(text) {
  $("status").textContent = text;
}

// ---------- Push to talk ----------

function pttDown(e) {
  e.preventDefault();
  if (state.phase === "stopped" || state.phase === "listening") return;
  // Keep receiving pointerup even if the finger slides off the button.
  e.currentTarget.setPointerCapture?.(e.pointerId);
  state.wasPaused = state.phase === "paused";
  abortStream();
  speaker.cancel();
  clearTimeout(state.timer);
  if (state.currentText) state.lastSegmentText = state.currentText;
  state.phase = "listening";
  $("ptt-btn").classList.add("listening");
  $("ptt-btn").textContent = "Listening…";
  setStatus("Listening…");
  if (!listener.supported) {
    $("ask-input").focus();
    return;
  }
  listener.onInterim = (t) => ($("caption").textContent = `“${t}”`);
  listener.start();
}

async function pttUp(e) {
  e?.preventDefault();
  if (state.phase !== "listening") return;
  $("ptt-btn").classList.remove("listening");
  $("ptt-btn").textContent = "Hold to talk";
  if (!listener.supported) return; // typed question path
  const text = await listener.stop();
  if (state.phase !== "listening") return;
  if (!text) {
    $("caption").textContent = "I didn't catch that.";
    finishInteraction();
    return;
  }
  ask(text);
}

function finishInteraction() {
  if (state.wasPaused) {
    state.phase = "paused";
    setStatus("Paused");
  } else {
    state.phase = "waiting";
    schedule(800);
  }
  renderPauseButton();
}

async function ask(text) {
  state.phase = "answering";
  state.answerDone = false;
  state.pendingControl = null;
  state.currentText = "";
  $("caption").textContent = `You: “${text}”`;
  setStatus("Thinking about your question…");
  const buf = new SentenceBuffer();
  const ctl = new AbortController();
  state.ctl = ctl;
  try {
    await postStream(
      "/api/ask",
      { sessionId: state.sessionId, pos: state.pos, text, localTime: localTime() },
      (ev) => {
        if (state.ctl !== ctl) return;
        if (ev.type === "intent" && ev.intent === "control") state.pendingControl = ev.action;
        if (ev.type === "intent" && ev.intent === "steer") setStatus("Got it, adjusting the tour");
        if (ev.type === "text") {
          setStatus("Answering");
          for (const s of buf.push(ev.text)) speaker.enqueue(s);
        }
        if (ev.type === "cards") addCards(ev.labels, false);
        if (ev.type === "error") setStatus(ev.message);
        if (ev.type === "done") {
          for (const s of buf.flush()) speaker.enqueue(s);
          state.answerDone = true;
          if (!speaker.busy) answerEnded();
        }
      },
      ctl.signal,
    );
  } catch (err) {
    if (ctl.signal.aborted || state.ctl !== ctl) return;
    speaker.enqueue(navigator.onLine ? "Sorry, I couldn't answer that just now." : "I can't answer right now, there's no connection.");
    state.answerDone = true;
  }
}

function answerEnded() {
  const control = state.pendingControl;
  state.pendingControl = null;
  if (control === "pause") {
    state.phase = "waiting";
    return pause();
  }
  if (control === "stop") return stopTour();
  if (control === "repeat") return replay();
  if (control === "resume" || control === "skip") state.wasPaused = false;
  finishInteraction();
}

// ---------- Topic cards ----------

function addCards(labels, current) {
  for (const label of labels) {
    const i = state.cards.findIndex((c) => c.label.toLowerCase() === label.toLowerCase());
    const card = i >= 0 ? state.cards.splice(i, 1)[0] : { label };
    state.cards.unshift(card);
  }
  if (current && labels[0]) state.currentCard = labels[0];
  state.cards = state.cards.slice(0, MAX_CARDS);
  renderCards();
}

function renderCards() {
  const box = $("cards");
  box.innerHTML = "";
  for (const c of state.cards) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "card";
    if (c.label === state.currentCard) b.classList.add("current");
    if (c.label === state.pendingFocus) b.classList.add("queued");
    b.textContent = c.label;
    b.addEventListener("click", () => tapCard(c.label));
    box.append(b);
  }
}

function tapCard(label) {
  state.pendingFocus = label;
  renderCards();
  // Shifts at the next natural break: now, if the guide is between segments.
  if (state.phase === "waiting") requestNext();
}

// ---------- Headset buttons, wake lock ----------

function silentWavUrl() {
  const sampleRate = 8000;
  const samples = sampleRate; // 1 second
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** A looping silent track makes this page the active media session, so headset buttons reach it. */
function startMediaSession() {
  if (!$("media-keys").checked || !("mediaSession" in navigator)) return;
  if (!state.mediaAudio) {
    state.mediaAudio = new Audio(silentWavUrl());
    state.mediaAudio.loop = true;
  }
  state.mediaAudio.play().catch(() => {});
  navigator.mediaSession.metadata = new MediaMetadata({ title: "Tour Guide", artist: "Audio tour" });
  // A headset press arrives as "play" or "pause" depending on what the OS thinks is
  // happening; treat either as a toggle, and keep the silent track running.
  const toggle = () => {
    state.mediaAudio.play().catch(() => {});
    if (state.phase === "paused") resume();
    else pause();
  };
  navigator.mediaSession.setActionHandler("play", toggle);
  navigator.mediaSession.setActionHandler("pause", toggle);
}

function stopMediaSession() {
  state.mediaAudio?.pause();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", null);
    navigator.mediaSession.setActionHandler("pause", null);
  }
}

async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    /* not supported or denied */
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.phase !== "stopped") requestWakeLock();
});

window.addEventListener("online", () => {
  if (state.phase === "waiting") requestNext();
});

// ---------- Debug ----------

function renderDebugPosition() {
  if ($("debug").hidden) return;
  const p = state.pos;
  const d = state.lastDebug;
  const lines = [];
  if (p) {
    lines.push(
      `pos ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}  ±${Math.round(p.accuracy ?? 0)} m`,
      `speed ${p.speed === null ? "?" : (p.speed * 3.6).toFixed(1)} km/h  heading ${p.heading === null ? "?" : Math.round(p.heading)}°`,
    );
  }
  lines.push(`phase ${state.phase}`);
  if (d) {
    lines.push(`mode ${d.mode}`, `place ${d.place ?? "?"}`, `plan ${JSON.stringify(d.plan)}`, "candidates:");
    for (const c of d.candidates) {
      lines.push(`  ${c.score.toFixed(2)}  ${c.name}  ${c.side} ${c.distance} m${c.eta !== null ? ` eta ${c.eta}s` : ""}${c.covered ? " ✓" : ""}`);
    }
  }
  $("debug-text").textContent = lines.join("\n");
}

// ---------- Wire up ----------

function init() {
  accessKey();
  loadLenses();
  setupVoiceSettings();
  setupSimulation();

  $("start-btn").addEventListener("click", startTour);
  $("pause-btn").addEventListener("click", () => (state.phase === "paused" ? resume() : pause()));
  $("stop-btn").addEventListener("click", stopTour);
  $("skip-btn").addEventListener("click", skip);
  $("replay-btn").addEventListener("click", replay);

  const ptt = $("ptt-btn");
  ptt.addEventListener("pointerdown", pttDown);
  ptt.addEventListener("pointerup", pttUp);
  ptt.addEventListener("pointercancel", pttUp);
  ptt.addEventListener("contextmenu", (e) => e.preventDefault());
  $("ask-send").addEventListener("click", () => {
    const text = $("ask-input").value.trim();
    $("ask-input").value = "";
    if (!text) return;
    if (state.phase !== "listening") {
      state.wasPaused = state.phase === "paused";
      abortStream();
      speaker.cancel();
      clearTimeout(state.timer);
    }
    ask(text);
  });

  $("sim-play").addEventListener("click", () => {
    if (!state.sim) return;
    state.sim.setPaused(!state.sim.paused);
    const noun = $("sim-mode").value === "walk" ? "walk" : "ride";
    $("sim-play").textContent = state.sim.paused ? `Resume ${noun}` : `Pause ${noun}`;
  });
  $("sim-speed").addEventListener("change", (e) => state.sim?.setMultiplier(Number(e.target.value)));
  $("sim-turn").addEventListener("click", () => state.sim?.turnAround());
}

init();
