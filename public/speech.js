// Voice output (browser speech synthesis) and push-to-talk input (browser speech recognition).

const ABBREVIATIONS = /\b(St|Sto|Sta|Mr|Mrs|Ms|Dr|Sr|Jr|Av|Ave|No|Nr|c|ca|vs|approx|etc|e\.g|i\.e)\.$/i;

/** Collects streamed text and hands out complete sentences, so speech can start before the stream ends. */
export class SentenceBuffer {
  constructor() {
    this.buffer = "";
  }

  push(text) {
    this.buffer += text;
    const out = [];
    const re = /[.!?…]+["'”’)]*\s+|\n+/g;
    let start = 0;
    let m;
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[0].length;
      const candidate = this.buffer.slice(start, end).trim();
      // Don't split after abbreviations like "St." or "c."
      if (!m[0].startsWith("\n") && ABBREVIATIONS.test(this.buffer.slice(start, m.index + 1).trim())) continue;
      if (candidate) out.push(candidate);
      start = end;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  flush() {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

const VOICE_KEY = "guide.voice";
const RATE_KEY = "guide.rate";

/** Speaks a queue of sentences one at a time (long utterances get cut off in some browsers). */
export class Speaker {
  constructor() {
    this.queue = [];
    this.current = null;
    this.watchdog = null;
    this.voice = null;
    this.rate = Number(safeGet(RATE_KEY)) || 1;
    this.onIdle = null;
    this.onSentence = null;
    this.supported = "speechSynthesis" in window;
    if (this.supported) {
      this.pickVoice();
      speechSynthesis.addEventListener?.("voiceschanged", () => this.pickVoice());
    }
  }

  voices() {
    if (!this.supported) return [];
    return speechSynthesis
      .getVoices()
      .filter((v) => v.lang?.toLowerCase().startsWith("en"))
      .sort((a, b) => voiceRank(b) - voiceRank(a));
  }

  pickVoice() {
    const voices = this.voices();
    const saved = safeGet(VOICE_KEY);
    this.voice = voices.find((v) => v.voiceURI === saved) ?? voices[0] ?? null;
  }

  setVoice(uri) {
    safeSet(VOICE_KEY, uri);
    this.pickVoice();
  }

  setRate(rate) {
    this.rate = rate;
    safeSet(RATE_KEY, String(rate));
  }

  /** Must be called from a user gesture once, so mobile browsers allow speech later. */
  unlock() {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  get busy() {
    return this.current !== null || this.queue.length > 0;
  }

  enqueue(text) {
    if (!this.supported || !text.trim()) return;
    this.queue.push(text);
    if (!this.current) this.next();
  }

  next() {
    clearTimeout(this.watchdog);
    const text = this.queue.shift();
    if (text === undefined) {
      this.current = null;
      this.onIdle?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    } else {
      u.lang = "en-GB";
    }
    u.rate = this.rate;
    const done = () => {
      if (this.current === u) this.next();
    };
    u.onend = done;
    u.onerror = done;
    this.current = u;
    // Some engines occasionally never fire onend; don't let that stall the tour.
    this.watchdog = setTimeout(done, 4000 + (text.length * 110) / this.rate);
    this.onSentence?.(text);
    speechSynthesis.speak(u);
  }

  cancel() {
    clearTimeout(this.watchdog);
    this.queue = [];
    this.current = null;
    if (this.supported) speechSynthesis.cancel();
  }
}

function voiceRank(v) {
  const n = v.name.toLowerCase();
  let r = 0;
  if (/natural|neural|enhanced|premium|siri/.test(n)) r += 4;
  if (/google uk english|google us english/.test(n)) r += 3;
  if (/samantha|daniel|serena|karen|moira/.test(n)) r += 2;
  if (v.lang === "en-GB") r += 1;
  if (v.localService === false) r += 0.5;
  return r;
}

/** Push-to-talk speech recognition. start() on press, stop() on release resolves with the transcript. */
export class Listener {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.SR = SR;
    this.supported = !!SR;
    this.rec = null;
    this.finalText = "";
    this.interimText = "";
    this.onInterim = null;
  }

  start() {
    if (!this.supported) return;
    this.finalText = "";
    this.interimText = "";
    const rec = new this.SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.interimText = interim;
      this.onInterim?.((this.finalText + " " + interim).trim());
    };
    this.ended = new Promise((resolve) => {
      rec.onend = resolve;
      rec.onerror = resolve;
    });
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  async stop() {
    if (!this.rec) return "";
    const rec = this.rec;
    this.rec = null;
    // Give the recogniser a moment to deliver the last words.
    await new Promise((r) => setTimeout(r, 350));
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
    await Promise.race([this.ended, new Promise((r) => setTimeout(r, 2500))]);
    return (this.finalText + " " + this.interimText).trim();
  }
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
