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
