import { randomUUID } from "node:crypto";
import type { Lens } from "./lenses.ts";

export type Segment = {
  kind: string;
  text: string;
  poiId: string | null;
  cards: string[];
  at: number;
};

export type Session = {
  id: string;
  lenses: Lens[];
  /** Free-text steering from the listener ("less kings, more everyday life"). */
  steering: string[];
  covered: Map<string, number>;
  announced: Set<string>;
  areasCovered: Set<string>;
  segments: Segment[];
  createdAt: number;
  lastSeen: number;
};

const sessions = new Map<string, Session>();
const MAX_IDLE_MS = 6 * 3600 * 1000;

export function createSession(lenses: Lens[]): Session {
  const s: Session = {
    id: randomUUID(),
    lenses,
    steering: [],
    covered: new Map(),
    announced: new Set(),
    areasCovered: new Set(),
    segments: [],
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: unknown): Session | null {
  const s = typeof id === "string" ? sessions.get(id) : undefined;
  if (!s) return null;
  s.lastSeen = Date.now();
  return s;
}

export function endSession(id: string): void {
  sessions.delete(id);
}

export function addSteering(s: Session, note: string): void {
  s.steering.push(note);
  if (s.steering.length > 6) s.steering.shift();
}

setInterval(() => {
  const cutoff = Date.now() - MAX_IDLE_MS;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(id);
}, 600000).unref();
