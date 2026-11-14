import { describeDistance, describeSide } from "./geo.ts";
import { askPrompt, narrationPrompt, streamClaude, type Context } from "./narrator.ts";
import { CardsSplitter, FirstLineSplitter, parseIntent } from "./parsers.ts";
import { PROFILES, detectMode, planSegment, rankCandidates, type Candidate, type Mode, type Plan, type Position } from "./planner.ts";
import { localWikiLang, poisAround, type Poi } from "./pois.ts";
import { addSteering, type Session } from "./session.ts";
import { reverseGeocode, type Place } from "./sources/nominatim.ts";
import { articleText, searchArticle } from "./sources/wikipedia.ts";

export type Emit = (event: Record<string, unknown>) => void;

export function parsePosition(raw: unknown): Position | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  return { lat, lon, heading: num(r.heading), speed: num(r.speed) };
}

type Surroundings = { place: Place | null; pois: Poi[]; localLang: string | null };

async function surroundings(pos: Position, mode: Mode): Promise<Surroundings> {
  const place = await reverseGeocode(pos.lat, pos.lon).catch((err) => {
    console.warn("Reverse geocoding failed:", (err as Error).message);
    return null;
  });
  const localLang = localWikiLang(place?.countryCode);
  const pois = await poisAround(pos.lat, pos.lon, PROFILES[mode].horizon, localLang).catch((err) => {
    console.warn("POI lookup failed:", (err as Error).message);
    return [] as Poi[];
  });
  return { place, pois, localLang };
}

function areaNameFor(mode: Mode, place: Place | null): string | null {
  if (!place) return null;
  const parts =
    mode === "vehicle_fast"
      ? [place.town ?? place.region, place.region]
      : [place.neighbourhood ?? place.town, place.town];
  return [...new Set(parts.filter(Boolean))].join(", ") || null;
}

/** Describes an OSM-only place from its tags, for when there's no Wikipedia article. */
function tagSummary(poi: Poi): string {
  const t = poi.tags ?? {};
  const facts = [
    t.historic && `Type: ${t.historic.replace(/_/g, " ")}`,
    t.tourism && `Tourism: ${t.tourism}`,
    t.amenity && `Amenity: ${t.amenity.replace(/_/g, " ")}`,
    t.religion && `Religion: ${t.religion}${t.denomination ? ` (${t.denomination})` : ""}`,
    t.start_date && `Built: ${t.start_date}`,
    t.architect && `Architect: ${t.architect}`,
    t["building:architecture"] && `Style: ${t["building:architecture"]}`,
    t.heritage && "Listed heritage site",
    t.cuisine && `Cuisine: ${t.cuisine}`,
    t.description && `Description: ${t.description}`,
    t["description:en"] && `Description: ${t["description:en"]}`,
  ].filter(Boolean);
  return `${poi.name}. ${facts.join(". ")}`;
}

async function poiSource(poi: Poi, full: boolean): Promise<{ title: string; text: string }> {
  if (!poi.wiki) return { title: `${poi.name} (OpenStreetMap)`, text: tagSummary(poi) };
  const text = full ? await articleText(poi.wiki.lang, poi.wiki.title).catch(() => poi.wiki!.extract) : poi.wiki.extract;
  return { title: `${poi.wiki.title} (Wikipedia, ${poi.wiki.lang})`, text: text || poi.wiki.extract };
}

async function sourcesFor(
  plan: Exclude<Plan, { kind: "silence" }>,
  place: Place | null,
): Promise<{ title: string; text: string }[]> {
  const sources: { title: string; text: string }[] = [];
  const add = async (p: Promise<{ title: string; text: string } | null>) => {
    const s = await p.catch(() => null);
    if (s?.text) sources.push(s);
  };
  const searchSource = (q: string) =>
    searchArticle("en", q).then((r) => (r ? { title: `${r.title} (Wikipedia, en)`, text: r.text } : null));

  switch (plan.kind) {
    case "poi":
      await add(poiSource(plan.target.poi, true));
      break;
    case "lookahead":
      await add(poiSource(plan.target.poi, false));
      break;
    case "focus":
      if (plan.target) await add(poiSource(plan.target.poi, true));
      else await add(searchSource([plan.focus, place?.town].filter(Boolean).join(" ")));
      break;
    case "area":
      await add(searchSource(plan.areaName));
      break;
    case "orientation":
      await Promise.all([
        add(searchSource([place?.neighbourhood, place?.town].filter(Boolean).join(" ") || "")),
        ...plan.upcoming.slice(0, 2).map((c) => add(poiSource(c.poi, false))),
      ]);
      break;
  }
  return sources;
}

function planSummary(plan: Plan): Record<string, unknown> {
  const target = "target" in plan && plan.target ? plan.target : null;
  return {
    kind: plan.kind,
    phase: "phase" in plan ? plan.phase : undefined,
    budgetSec: "budgetSec" in plan ? Math.round(plan.budgetSec) : undefined,
    target: target ? `${target.poi.name} (${describeSide(target)}, ${describeDistance(target.distance)})` : undefined,
    reason: plan.kind === "silence" ? plan.reason : undefined,
  };
}

function debugCandidates(ranked: Candidate[], session: Session) {
  return ranked.slice(0, 10).map((c) => ({
    name: c.poi.name,
    side: c.side,
    distance: Math.round(c.distance),
    eta: c.eta === null ? null : Math.round(c.eta),
    score: Number(c.score.toFixed(2)),
    covered: session.covered.get(c.poi.id) ?? 0,
  }));
}

async function runStream(
  kind: "narration" | "ask",
  prompt: string,
  onText: (t: string) => void,
  emit: Emit,
  signal: AbortSignal,
  label: string,
): Promise<void> {
  const started = Date.now();
  let firstAt = 0;
  try {
    const result = await streamClaude(
      kind,
      prompt,
      (t) => {
        if (!firstAt) firstAt = Date.now();
        onText(t);
      },
      signal,
    );
    const u = result.usage;
    console.log(
      `[${label}] first text ${firstAt ? firstAt - started : "-"} ms, total ${Date.now() - started} ms, tokens in ${u?.input_tokens ?? "?"} / out ${u?.output_tokens ?? "?"}${result.refused ? ", REFUSED" : ""}`,
    );
  } catch (err) {
    if (signal.aborted) return;
    console.error(`[${label}] Claude error:`, err);
    emit({ type: "error", message: "The guide couldn't generate commentary just now." });
  }
}

export async function nextSegment(
  session: Session,
  pos: Position,
  focus: string | null,
  localTime: string | null,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const mode = detectMode(pos.speed);
  const { place, pois } = await surroundings(pos, mode);
  if (signal.aborted) return;

  const areaName = areaNameFor(mode, place);
  const input = {
    pos,
    mode,
    pois,
    lenses: session.lenses,
    covered: session.covered,
    announced: session.announced,
    areasCovered: session.areasCovered,
    areaName,
    isFirst: session.segments.length === 0,
    focus,
  };
  const ranked = rankCandidates(input);
  const plan = planSegment(input);

  emit({
    type: "debug",
    mode,
    place: place?.label ?? null,
    plan: planSummary(plan),
    candidates: debugCandidates(ranked, session),
  });
  emit({
    type: "pois",
    pois: pois.slice(0, 120).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, covered: session.covered.has(p.id) })),
  });

  if (plan.kind === "silence") {
    emit({ type: "silence", retryMs: plan.retryMs });
    return;
  }

  const target = "target" in plan ? plan.target : null;
  if (target) emit({ type: "card", label: target.poi.name, poiId: target.poi.id });
  else if (plan.kind === "focus") emit({ type: "card", label: plan.focus });

  const sources = await sourcesFor(plan, place);
  if (signal.aborted) return;

  const ctx: Context = {
    mode,
    localTime,
    speed: pos.speed,
    place,
    lenses: session.lenses,
    steering: session.steering,
    nearby: ranked,
    covered: session.covered,
    recent: session.segments.slice(-5),
    sources,
  };

  const splitter = new CardsSplitter();
  let spoken = "";
  await runStream(
    "narration",
    narrationPrompt(plan, ctx),
    (delta) => {
      const out = splitter.push(delta);
      if (out) {
        spoken += out;
        emit({ type: "text", text: out });
      }
    },
    emit,
    signal,
    `${plan.kind}${target ? `: ${target.poi.name}` : ""}`,
  );
  const { text: rest, cards } = splitter.finish();
  if (rest && !signal.aborted) {
    spoken += rest;
    emit({ type: "text", text: rest });
  }
  if (cards.length && !signal.aborted) emit({ type: "cards", labels: cards });

  // Record what was said, even if the listener skipped part-way, so we don't loop on it.
  if (spoken.trim()) {
    session.segments.push({ kind: plan.kind, text: spoken.trim(), poiId: target?.poi.id ?? null, cards, at: Date.now() });
    if (target) session.covered.set(target.poi.id, (session.covered.get(target.poi.id) ?? 0) + 1);
    if (plan.kind === "lookahead") session.announced.add(plan.target.poi.id);
    if (plan.kind === "area") session.areasCovered.add(plan.areaName);
    if (plan.kind === "orientation" && areaName) session.areasCovered.add(areaName);
    if (plan.kind === "focus") addSteering(session, `The listener showed interest in "${plan.focus}"; lean that way when it fits.`);
  }
}

export async function answerListener(
  session: Session,
  pos: Position | null,
  question: string,
  localTime: string | null,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const mode = detectMode(pos?.speed ?? null);
  const { place, pois } = pos ? await surroundings(pos, mode) : { place: null, pois: [] as Poi[] };
  if (signal.aborted) return;

  const ranked = pos
    ? rankCandidates({
        pos,
        mode,
        pois,
        lenses: session.lenses,
        covered: session.covered,
        announced: session.announced,
        areasCovered: session.areasCovered,
        areaName: null,
        isFirst: false,
        focus: null,
      })
    : [];

  // Ground the answer: the place we last talked about, plus the closest notable places.
  const lastPoiId = session.segments.at(-1)?.poiId;
  const lastPoi = lastPoiId ? pois.find((p) => p.id === lastPoiId) : undefined;
  const closest = [...ranked].sort((a, b) => a.distance - b.distance).slice(0, 4).map((c) => c.poi);
  const toSource = [...new Map([lastPoi, ...closest].filter((p): p is Poi => !!p).map((p) => [p.id, p])).values()];
  const sources = (
    await Promise.all(toSource.map((p, i) => poiSource(p, i === 0).catch(() => null)))
  ).filter((s): s is { title: string; text: string } => !!s?.text);
  if (signal.aborted) return;

  const ctx: Context = {
    mode,
    localTime,
    speed: pos?.speed ?? null,
    place,
    lenses: session.lenses,
    steering: session.steering,
    nearby: ranked,
    covered: session.covered,
    recent: session.segments.slice(-4),
    sources,
  };

  const firstLine = new FirstLineSplitter();
  const cards = new CardsSplitter();
  let spoken = "";
  let intentSent = false;
  const speak = (t: string) => {
    const out = cards.push(t);
    if (out) {
      spoken += out;
      emit({ type: "text", text: out });
    }
  };
  const handleFirstLine = (line: string) => {
    intentSent = true;
    if (!/^\s*INTENT:/i.test(line)) {
      // The model skipped the intent line: treat everything as a spoken answer.
      emit({ type: "intent", intent: "question" });
      speak(`${line}\n`);
      return;
    }
    const intent = parseIntent(line);
    if (intent.type === "steer") addSteering(session, intent.note);
    emit({ type: "intent", intent: intent.type, action: intent.type === "control" ? intent.action : undefined });
  };

  await runStream(
    "ask",
    askPrompt(question, ctx),
    (delta) => {
      const rest = firstLine.push(delta);
      if (!intentSent && firstLine.firstLine !== null) handleFirstLine(firstLine.firstLine);
      if (rest) speak(rest);
    },
    emit,
    signal,
    `ask: ${question.slice(0, 40)}`,
  );
  firstLine.finish();
  if (!intentSent && firstLine.firstLine) handleFirstLine(firstLine.firstLine);
  const { text: rest, cards: labels } = cards.finish();
  if (rest && !signal.aborted) {
    spoken += rest;
    emit({ type: "text", text: rest });
  }
  if (labels.length && !signal.aborted) emit({ type: "cards", labels });
  if (spoken.trim()) {
    session.segments.push({ kind: "answer", text: `(Listener asked: "${question}") ${spoken.trim()}`, poiId: null, cards: labels, at: Date.now() });
  }
}
