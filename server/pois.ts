import { distanceM } from "./geo.ts";
import { osmAround, type OsmElement } from "./sources/overpass.ts";
import { geosearch, type WikiPage } from "./sources/wikipedia.ts";

export type Poi = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  categories: string[];
  /** Higher = more worth talking about. Roughly 0..4. */
  notability: number;
  wiki?: { lang: string; title: string; extract: string; length: number };
  wikidata?: string;
  tags?: Record<string, string>;
};

/** Local-language Wikipedia to search alongside English, by ISO country code. */
const LOCAL_WIKI: Record<string, string> = {
  pt: "pt", br: "pt", es: "es", fr: "fr", de: "de", at: "de", it: "it", nl: "nl", no: "no",
  se: "sv", dk: "da", fi: "fi", pl: "pl", cz: "cs", gr: "el", hr: "hr", hu: "hu", ro: "ro",
};

export function localWikiLang(countryCode: string | undefined): string | null {
  const lang = countryCode ? LOCAL_WIKI[countryCode.toLowerCase()] : undefined;
  return lang && lang !== "en" ? lang : null;
}

/** How long to wait for OpenStreetMap before narrating from Wikipedia alone. */
const OSM_WAIT_MS = 4000;

const AREA_RE = /\b(is a (civil )?parish|freguesia|is a (neighbourhood|neighborhood|district|quarter|municipality|city|town|village))\b/i;
const LOW_VALUE_RE = /\b(metro station|railway station|bus station|school|hospital|hotel|office building|stadium)\b/i;

function categoriesFromTags(tags: Record<string, string>): string[] {
  const c: string[] = [];
  if (tags.historic) c.push("historic", `historic:${tags.historic}`);
  if (tags.tourism) c.push(tags.tourism);
  if (tags.amenity === "place_of_worship") c.push("religion");
  if (/^(restaurant|cafe|bar|pub|marketplace)$/.test(tags.amenity ?? "")) c.push("food");
  if (tags.leisure || tags.natural) c.push("nature");
  if (tags.heritage) c.push("heritage");
  if (tags.man_made) c.push(tags.man_made);
  return c;
}

function categoriesFromText(text: string): string[] {
  const c: string[] = [];
  if (AREA_RE.test(text)) c.push("area");
  if (LOW_VALUE_RE.test(text.slice(0, 300))) c.push("low-value");
  if (/\b(church|cathedral|chapel|convent|monastery|basilica|mosque|synagogue)\b/i.test(text)) c.push("religion");
  if (/\b(museum)\b/i.test(text)) c.push("museum");
  if (/\b(palace|castle|fortress|tower|monument)\b/i.test(text)) c.push("monument");
  return c;
}

function notability(poi: Poi): number {
  let n = 0;
  if (poi.wiki) {
    n += 1.5 + Math.min(1.5, Math.max(0, Math.log10(Math.max(poi.wiki.length, 1000)) - 3));
  } else {
    n += 0.5;
  }
  const cats = new Set(poi.categories);
  if (cats.has("museum") || cats.has("attraction") || cats.has("monument") || cats.has("religion")) n += 0.8;
  if (cats.has("historic") || cats.has("heritage") || cats.has("viewpoint")) n += 0.5;
  if (cats.has("food") && !poi.wikidata) n -= 0.3;
  if (cats.has("low-value")) n -= 1.2;
  if (cats.has("area")) n -= 0.5; // areas feed area stories rather than pass-by commentary
  return Math.max(0, n);
}

function fromWiki(p: WikiPage): Poi {
  return {
    id: p.wikidata ? `wd:${p.wikidata}` : `wiki:${p.lang}:${p.pageId}`,
    name: p.title.replace(/\s*\([^)]*\)$/, ""),
    lat: p.lat,
    lon: p.lon,
    categories: categoriesFromText(p.extract),
    notability: 0,
    wiki: { lang: p.lang, title: p.title, extract: p.extract, length: p.length },
    wikidata: p.wikidata,
  };
}

function fromOsm(e: OsmElement): Poi {
  return {
    id: e.tags.wikidata ? `wd:${e.tags.wikidata}` : e.id,
    name: e.name,
    lat: e.lat,
    lon: e.lon,
    categories: categoriesFromTags(e.tags),
    notability: 0,
    wikidata: e.tags.wikidata,
    tags: e.tags,
  };
}

/** Merge Wikipedia articles (en + local) and OSM features into one deduplicated list. */
export function mergePois(wikiPages: WikiPage[], osm: OsmElement[]): Poi[] {
  const byId = new Map<string, Poi>();

  // English first, so it wins when the same Wikidata item exists in both languages.
  const sorted = [...wikiPages].sort((a, b) => (a.lang === "en" ? -1 : 0) - (b.lang === "en" ? -1 : 0));
  for (const page of sorted) {
    const poi = fromWiki(page);
    const existing = byId.get(poi.id);
    if (!existing) byId.set(poi.id, poi);
    else if (existing.wiki && existing.wiki.extract.length < 80 && page.extract.length > existing.wiki.extract.length) {
      existing.wiki = poi.wiki; // English stub, richer local article
    }
  }

  const wikiPois = [...byId.values()];
  for (const el of osm) {
    const osmPoi = fromOsm(el);
    const sameName = (p: Poi) => p.name.toLowerCase() === osmPoi.name.toLowerCase() && distanceM(p, osmPoi) < 150;
    const match = byId.get(osmPoi.id) ?? wikiPois.find(sameName);
    if (match) {
      match.tags = { ...osmPoi.tags, ...match.tags };
      match.categories = [...new Set([...match.categories, ...osmPoi.categories])];
      if (!match.wiki) match.name = osmPoi.name;
    } else if (![...byId.values()].some(sameName)) {
      byId.set(osmPoi.id, osmPoi);
    }
  }

  const all = [...byId.values()];
  for (const p of all) p.notability = notability(p);
  return all;
}

/**
 * Points of interest within ~radiusM. Queries are snapped to a grid so that a moving
 * listener keeps hitting the same cached tiles.
 */
export async function poisAround(lat: number, lon: number, radiusM: number, localLang: string | null): Promise<Poi[]> {
  const cellDeg = Math.max(0.002, radiusM / 111320 / 2);
  const cLat = Math.round(lat / cellDeg) * cellDeg;
  const cLon = Math.round(lon / cellDeg) * cellDeg;
  const queryRadius = Math.round(radiusM + cellDeg * 111320);

  const langs = ["en", ...(localLang ? [localLang] : [])];
  // Public Overpass servers are often slow or overloaded. Don't hold the narration for
  // them: wait briefly, and let a slow query finish in the background to fill the cache.
  const osmQuery = osmAround(cLat, cLon, queryRadius);
  osmQuery.catch((err) => console.warn("Overpass:", (err as Error).message));
  const osmOrEmpty = Promise.race([
    osmQuery.catch(() => [] as OsmElement[]),
    new Promise<OsmElement[]>((r) => setTimeout(() => r([]), OSM_WAIT_MS)),
  ]);
  const [wikiResults, osm] = await Promise.all([
    Promise.allSettled(langs.map((l) => geosearch(l, cLat, cLon, queryRadius))),
    osmOrEmpty,
  ]);
  const pages = wikiResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return mergePois(pages, osm).filter((p) => distanceM({ lat, lon }, p) <= radiusM * 1.5);
}
