// Position sources. Each source calls onPosition({lat, lon, heading, speed, accuracy}).
// The rest of the app doesn't know whether the position is real or simulated.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Real GPS, smoothed over the last ~20 seconds so heading and speed are stable while walking. */
export class GpsSource {
  constructor(onPosition, onError) {
    this.onPosition = onPosition;
    this.onError = onError;
    this.samples = [];
    this.watchId = null;
  }

  start() {
    if (!("geolocation" in navigator)) {
      this.onError?.("This browser has no GPS access.");
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.add(p),
      (err) => this.onError?.(err.message || "Location unavailable"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  add(p) {
    const now = Date.now();
    const s = { t: now, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? 50 };
    if (s.acc > 80 && this.samples.length) return; // ignore very poor fixes once we have something
    this.samples.push(s);
    this.samples = this.samples.filter((x) => now - x.t <= 45000);

    // Speed: distance covered over ~20 s (GPS jitter makes instant speed useless on foot).
    const old = this.samples.find((x) => now - x.t <= 25000 && now - x.t >= 12000) ?? this.samples[0];
    let speed = null;
    if (old && old !== s && now - old.t >= 5000) speed = distance(old, s) / ((now - old.t) / 1000);
    if (speed === null && Number.isFinite(p.coords.speed)) speed = p.coords.speed;

    // Heading: bearing from the most recent sample at least 12 m away.
    let heading = null;
    if (speed !== null && speed >= 0.6) {
      for (let i = this.samples.length - 2; i >= 0; i--) {
        if (distance(this.samples[i], s) >= 12) {
          heading = bearing(this.samples[i], s);
          break;
        }
      }
      if (heading === null && Number.isFinite(p.coords.heading)) heading = p.coords.heading;
    }
    this.onPosition({ lat: s.lat, lon: s.lon, heading, speed, accuracy: s.acc });
  }
}

/**
 * Walk around with the arrow keys (desktop testing). Up = north, right = east, and so on;
 * two keys walk diagonally. Shift runs (3×). The walking direction follows the keys.
 */
export class KeySource {
  /**
   * @param {{lat: number, lon: number}} start
   * @param {(p: {lat: number, lon: number, heading: number | null, speed: number | null, accuracy: number}) => void} onPosition
   * @param {number} multiplier speed factor (?speed=)
   */
  constructor(start, onPosition, multiplier = 1) {
    this.lat = start.lat;
    this.lon = start.lon;
    this.onPosition = onPosition;
    this.multiplier = multiplier;
    this.keys = new Set();
    /** @type {Map<string, number>} */
    this.pressedAt = new Map();
    this.timer = null;
    this.paused = false;
    /** Direction of the last movement: kept while standing, for the view cone. */
    this.lastHeading = null;
    this.history = [];
    this.down = (e) => this.key(e, true);
    this.up = (e) => this.key(e, false);
    this.blur = () => {
      this.keys.clear();
      this.pressedAt.clear();
    };
  }

  key(e, pressed) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift"].includes(e.key)) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
    e.preventDefault();
    if (pressed) {
      this.keys.add(e.key);
      this.pressedAt.set(e.key, Date.now());
    } else {
      this.keys.delete(e.key);
    }
  }

  /** Held, or tapped within the last tick: a quick tap still moves you a step. */
  isDown(key) {
    return this.keys.has(key) || Date.now() - (this.pressedAt.get(key) ?? 0) < 150;
  }

  start() {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(0.1), 100);
    this.emit(0);
  }

  stop() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur);
    clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(p) {
    this.paused = p;
  }

  tick(dt) {
    let north = 0;
    let east = 0;
    if (this.isDown("ArrowUp")) north += 1;
    if (this.isDown("ArrowDown")) north -= 1;
    if (this.isDown("ArrowRight")) east += 1;
    if (this.isDown("ArrowLeft")) east -= 1;
    let speed = 0;
    if (!this.paused && (north || east)) {
      const len = Math.hypot(north, east);
      speed = 1.4 * this.multiplier * (this.isDown("Shift") ? 3 : 1); // ~5 km/h walking
      const step = speed * dt;
      this.lat += ((north / len) * step) / 111320;
      this.lon += ((east / len) * step) / (111320 * Math.cos(rad(this.lat)));
      this.lastHeading = (deg(Math.atan2(east, north)) + 360) % 360;
    }
    // Ten updates a second while walking; once a second while standing.
    const now = Date.now();
    if (speed || now - (this.emittedAt ?? 0) >= 1000 || this.history.some((h) => h.v > 0)) {
      this.emittedAt = now;
      this.emit(speed);
    }
  }

  emit(instant) {
    // Like real GPS, report speed averaged over the last few seconds, so a short pause between
    // key presses doesn't flip the guide into "standing still".
    const now = Date.now();
    this.history = this.history.filter((h) => now - h.t <= 3000);
    this.history.push({ t: now, v: instant });
    const speed = this.history.reduce((s, h) => s + h.v, 0) / this.history.length;
    this.onPosition({
      lat: this.lat,
      lon: this.lon,
      heading: speed >= 0.6 ? this.lastHeading : null,
      speed,
      accuracy: 5,
    });
  }
}

/**
 * Moves along a route at realistic speed. Bus mode is slower and stops every ~400 m.
 * route = { coords: [[lat, lon], ...], durations: [sec per segment] }
 */
export class SimSource {
  constructor(route, mode, onPosition, onFinish) {
    this.mode = mode;
    this.onPosition = onPosition;
    this.onFinish = onFinish;
    this.multiplier = 1;
    this.paused = false;
    this.timer = null;
    this.load(route);
  }

  load(route) {
    this.coords = route.coords.map(([lat, lon]) => ({ lat, lon }));
    const n = this.coords.length;
    this.arrive = new Array(n).fill(0);
    this.depart = new Array(n).fill(0);
    let t = 0;
    let sinceStop = 0;
    for (let i = 1; i < n; i++) {
      const d = distance(this.coords[i - 1], this.coords[i]);
      let dur = route.durations?.[i - 1];
      if (!Number.isFinite(dur) || dur <= 0) dur = d / (this.mode === "walk" ? 1.35 : 10);
      if (this.mode === "walk") dur = d / 1.35; // steady walking pace, ~5 km/h
      if (this.mode === "bus") dur *= 1.6;
      t += dur;
      this.arrive[i] = t;
      sinceStop += d;
      if (this.mode === "bus" && sinceStop >= 400 && i < n - 1) {
        t += 25; // bus stop
        sinceStop = 0;
      }
      this.depart[i] = t;
    }
    this.total = t;
    this.time = 0;
    this.seg = 0;
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(0.5), 500);
    this.emit();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(p) {
    this.paused = p;
    this.emit();
  }

  setMultiplier(m) {
    this.multiplier = m;
  }

  tick(dt) {
    if (this.paused) return;
    this.time = Math.min(this.total, this.time + dt * this.multiplier);
    this.emit();
    if (this.time >= this.total) {
      this.stop();
      this.onFinish?.();
    }
  }

  /** Current position, heading and speed at this.time. */
  state() {
    const n = this.coords.length;
    while (this.seg < n - 1 && this.time >= this.arrive[this.seg + 1]) this.seg++;
    while (this.seg > 0 && this.time < this.arrive[this.seg]) this.seg--;
    const i = this.seg;
    if (i >= n - 1) return { ...this.coords[n - 1], heading: null, speed: 0 };
    const a = this.coords[i];
    const b = this.coords[i + 1];
    const h = bearing(a, b);
    if (this.time < this.depart[i]) return { ...a, heading: h, speed: 0 }; // waiting at a stop
    const span = this.arrive[i + 1] - this.depart[i];
    const f = span > 0 ? (this.time - this.depart[i]) / span : 1;
    const speed = span > 0 ? distance(a, b) / span : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, heading: h, speed };
  }

  emit() {
    const s = this.state();
    // Report speed averaged over the last 30 s, so a bus waiting at a stop doesn't look
    // like someone standing still (real GPS is smoothed the same way).
    this.history = (this.history ?? []).filter((h) => this.time - h.t <= 30 && h.t <= this.time);
    this.history.push({ t: this.time, speed: s.speed });
    const avg = this.history.reduce((sum, h) => sum + h.speed, 0) / this.history.length;
    const speed = this.paused ? 0 : avg;
    if (s.heading !== null) this.lastHeading = s.heading;
    this.onPosition({
      lat: s.lat,
      lon: s.lon,
      heading: speed >= 0.6 ? this.lastHeading ?? null : null,
      speed,
      accuracy: 5,
    });
  }

  /** Walk/drive back the way we came. */
  turnAround() {
    const here = this.state();
    const travelled = this.coords.slice(0, this.seg + 1).map((c) => [c.lat, c.lon]);
    travelled.push([here.lat, here.lon]);
    const coords = travelled.reverse();
    this.load({ coords, durations: [] });
    this.start();
  }

  get progress() {
    return this.total ? this.time / this.total : 1;
  }
}
