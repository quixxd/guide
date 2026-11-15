// Points of interest: Wikipedia articles (English + local language) merged with OpenStreetMap
// features into one deduplicated list with a notability score. Ported from server/pois.ts.

import { distanceM } from "./geo.js";
import { geosearch, osmAround } from "./sources.js";

/** @typedef {import("./planner.js").Poi} Poi */

/** Local-language Wikipedia to search alongside English, by ISO country code. */
const LOCAL_WIKI = {
  pt: "pt", br: "pt", es: "es", fr: "fr", de: "de", at: "de", it: "it", nl: "nl", no: "no",
  se: "sv", dk: "da", fi: "fi", pl: "pl", cz: "cs", gr: "el", hr: "hr", hu: "hu", ro: "ro",
};

/** @param {string | undefined} countryCode @returns {string | null} */
export function localWikiLang(countryCode) {
  const lang = countryCode ? LOCAL_WIKI[countryCode.toLowerCase()] : undefined;
  return lang && lang !== "en" ? lang : null;
}

/** How long to wait for OpenStreetMap before narrating from Wikipedia alone. */
const OSM_WAIT_MS = 4000;

const AREA_RE = /\b(is a (civil )?parish|freguesia|is a (neighbourhood|neighborhood|district|quarter|municipality|city|town|village))\b/i;
const LOW_VALUE_RE = /\b(metro station|railway station|bus station|school|hospital|hotel|office building|stadium)\b/i;

function categoriesFromTags(tags) {
  const c = [];
  if (tags.historic) c.push("historic", `historic:${tags.historic}`);
  if (tags.tourism) c.push(tags.tourism);
  if (tags.amenity === "place_of_worship") c.push("religion");
  if (/^(restaurant|cafe|bar|pub|marketplace)$/.test(tags.amenity ?? "")) c.push("food");
  if (tags.leisure || tags.natural) c.push("nature");
  if (tags.heritage) c.push("heritage");
  if (tags.man_made) c.push(tags.man_made);
  return c;
}

function categoriesFromText(text) {
  const c = [];
  if (AREA_RE.test(text)) c.push("area");
  if (LOW_VALUE_RE.test(text.slice(0, 300))) c.push("low-value");
  if (/\b(church|cathedral|chapel|convent|monastery|basilica|mosque|synagogue)\b/i.test(text)) c.push("religion");
  if (/\b(museum)\b/i.test(text)) c.push("museum");
  if (/\b(palace|castle|fortress|tower|monument)\b/i.test(text)) c.push("monument");
  return c;
}

/** @param {Poi} poi */
function notability(poi) {
  let n = 0;
  if (poi.wiki) n += 1.5 + Math.min(1.5, Math.max(0, Math.log10(Math.max(poi.wiki.length, 1000)) - 3));
  else n += 0.5;
  const cats = new Set(poi.categories);
  if (cats.has("museum") || cats.has("attraction") || cats.has("monument") || cats.has("religion")) n += 0.8;
  if (cats.has("historic") || cats.has("heritage") || cats.has("viewpoint")) n += 0.5;
  if (cats.has("food") && !poi.wikidata) n -= 0.3;
  if (cats.has("low-value")) n -= 1.2;
  if (cats.has("area")) n -= 0.5; // areas feed area stories rather than pass-by commentary
  return Math.max(0, n);
}

/** @returns {Poi} */
function fromWiki(p) {
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

/** @returns {Poi} */
function fromOsm(e) {
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

/** Merge Wikipedia articles (en + local) and OSM features into one deduplicated list. @returns {Poi[]} */
export function mergePois(wikiPages, osm) {
  /** @type {Map<string, Poi>} */
  const byId = new Map();

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
    const sameName = (p) => p.name.toLowerCase() === osmPoi.name.toLowerCase() && distanceM(p, osmPoi) < 150;
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
 * Points of interest within ~radiusM. Queries snap to a grid so a moving listener keeps
 * hitting the same cached tiles.
 * @returns {Promise<Poi[]>}
 */
export async function poisAround(lat, lon, radiusM, localLang) {
  const cellDeg = Math.max(0.002, radiusM / 111320 / 2);
  const cLat = Math.round(lat / cellDeg) * cellDeg;
  const cLon = Math.round(lon / cellDeg) * cellDeg;
  const queryRadius = Math.round(radiusM + cellDeg * 111320);

  const langs = ["en", ...(localLang ? [localLang] : [])];
  // Public Overpass servers are often slow. Don't hold the narration for them: wait briefly,
  // and let a slow query finish in the background to fill the cache for next time.
  const osmQuery = osmAround(cLat, cLon, queryRadius);
  osmQuery.catch(() => {});
  const osmOrEmpty = Promise.race([
    osmQuery.catch(() => []),
    new Promise((r) => setTimeout(() => r([]), OSM_WAIT_MS)),
  ]);
  const [wikiResults, osm] = await Promise.all([
    Promise.allSettled(langs.map((l) => geosearch(l, cLat, cLon, queryRadius))),
    osmOrEmpty,
  ]);
  const pages = wikiResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return mergePois(pages, osm).filter((p) => distanceM({ lat, lon }, p) <= radiusM * 1.5);
}
