// Extra detail for the place being talked about: its outline on the map (from OpenStreetMap)
// and a photo (from Wikipedia or Wikidata/Commons). Both are looked up in the background and
// never hold up the narration.

import { cached, fetchJson, nominatim, overpass } from "./sources.js";

/** @typedef {import("./planner.js").Poi} Poi */
/** @typedef {[number, number][]} Ring lat/lon pairs */
/** @typedef {{ kind: "polygon" | "line", coords: Ring }} Shape */

// ---------- Outline ----------

/** Joins way pieces that share end points into closed rings (multipolygon outers come in pieces). */
function joinRings(pieces) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const rings = [];
  const open = pieces.map((p) => [...p]);
  while (open.length) {
    let ring = open.shift();
    let grew = true;
    while (key(ring[0]) !== key(ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const piece = open[i];
        if (key(piece[0]) === key(ring.at(-1))) ring = ring.concat(piece.slice(1));
        else if (key(piece.at(-1)) === key(ring.at(-1))) ring = ring.concat([...piece].reverse().slice(1));
        else if (key(piece.at(-1)) === key(ring[0])) ring = piece.concat(ring.slice(1));
        else if (key(piece[0]) === key(ring[0])) ring = [...piece].reverse().concat(ring.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** @returns {Ring[]} the outer rings of a way or multipolygon relation returned with `out geom` */
function ringsOf(el) {
  const toRing = (geom) => geom.map((g) => [g.lat, g.lon]);
  if (el.type === "way" && el.geometry?.length >= 4) return [toRing(el.geometry)];
  if (el.type === "relation") {
    const outers = (el.members ?? []).filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length >= 2);
    return joinRings(outers.map((m) => toRing(m.geometry)));
  }
  return [];
}

function contains(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function centroidDistance(ring, lat, lon) {
  const cLat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLon = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const dy = (cLat - lat) * 111320;
  const dx = (cLon - lon) * 111320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Nominatim GeoJSON geometry → shapes (outer rings of polygons, or lines for streets). @returns {Shape[]} */
function shapesOfGeoJson(g) {
  const ring = (coords) => coords.map(([lon, lat]) => [lat, lon]);
  if (g?.type === "Polygon") return [{ kind: "polygon", coords: ring(g.coordinates[0]) }];
  if (g?.type === "MultiPolygon") return g.coordinates.map((p) => ({ kind: "polygon", coords: ring(p[0]) }));
  if (g?.type === "LineString") return [{ kind: "line", coords: ring(g.coordinates) }];
  if (g?.type === "MultiLineString") return g.coordinates.map((l) => ({ kind: "line", coords: ring(l) }));
  return [];
}

/**
 * Searches Nominatim for the place by name within ~400 m of it and returns the closest result
 * that has a shape. Tries the English name, then local-language and OSM names.
 * @param {Poi} poi @returns {Promise<Shape[] | null>}
 */
async function outlineFromNominatim(poi) {
  const d = 0.004;
  const viewbox = [poi.lon - d, poi.lat + d, poi.lon + d, poi.lat - d].join(",");
  const names = [...new Set([poi.name, ...(poi.altNames ?? [])].map((n) => n.replace(/,.*$/, "").trim()).filter(Boolean))].slice(0, 3);
  for (const name of names) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&polygon_geojson=1&polygon_threshold=0.00001&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(name)}`;
    const hits = await nominatim(() => fetchJson(url));
    const withShape = hits
      .map((h) => ({ shapes: shapesOfGeoJson(h.geojson), dist: centroidDistance([[Number(h.lat), Number(h.lon)]], poi.lat, poi.lon) }))
      .filter((h) => h.shapes.length && h.dist <= 300)
      .sort((a, b) => a.dist - b.dist);
    if (withShape.length) return withShape[0].shapes;
  }
  return null;
}

/**
 * Overpass: the place's own OSM shape when we know it (OSM id or Wikidata link), otherwise the
 * building it stands in or next to. @param {Poi} poi @returns {Promise<Shape[] | null>}
 */
async function outlineFromOverpass(poi) {
  const { lat, lon } = poi;
  const toShapes = (rings) => rings.map((coords) => ({ kind: /** @type {const} */ ("polygon"), coords }));
  const osm = poi.id.match(/^osm:(way|relation)\/(\d+)$/);
  let query = null;
  if (osm) query = `[out:json][timeout:10];${osm[1]}(${osm[2]});out geom;`;
  else if (poi.wikidata) {
    query = `[out:json][timeout:10];(way["wikidata"="${poi.wikidata}"](around:400,${lat},${lon});relation["wikidata"="${poi.wikidata}"](around:400,${lat},${lon}););out geom;`;
  }
  if (query) {
    const rings = (await overpass(query, 10000)).flatMap(ringsOf);
    if (rings.length) return toShapes(rings);
  }
  const nearby = (await overpass(`[out:json][timeout:10];(way["building"](around:30,${lat},${lon});relation["building"](around:30,${lat},${lon}););out geom;`, 10000))
    .flatMap((el) => ringsOf(el));
  const inside = nearby.find((ring) => contains(ring, lat, lon));
  if (inside) return toShapes([inside]);
  const nearest = nearby.sort((a, b) => centroidDistance(a, lat, lon) - centroidDistance(b, lat, lon))[0];
  return nearest && centroidDistance(nearest, lat, lon) <= 30 ? toShapes([nearest]) : null;
}

/**
 * The place's shape on the map: a building or square outline, or a street line. Nominatim first
 * (reliable, found by name), Overpass as the fallback (often overloaded). Null when nothing fits.
 * @param {Poi} poi @returns {Promise<Shape[] | null>}
 */
export function placeOutline(poi) {
  return cached(`outline:${poi.id}`, async () => {
    const fromName = keepSmall(await outlineFromNominatim(poi).catch(() => null));
    if (fromName) return fromName;
    return keepSmall(await outlineFromOverpass(poi).catch(() => null));
  });
}

/** Widest extent of a shape, in metres. */
function extentM(coords) {
  const lats = coords.map((c) => c[0]);
  const lons = coords.map((c) => c[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const h = (Math.max(...lats) - Math.min(...lats)) * 111320;
  const w = (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos((midLat * Math.PI) / 180);
  return Math.max(h, w);
}

/**
 * A building, square or street is outlined; a district, town or region boundary never is.
 * Shapes wider than this are dropped (streets may be longer, so lines get more room).
 * @param {Shape[] | null} shapes
 */
function keepSmall(shapes) {
  const kept = (shapes ?? []).filter((s) => extentM(s.coords) <= (s.kind === "line" ? 1500 : 400));
  return kept.length ? kept : null;
}

// ---------- Quick facts ----------

/**
 * @typedef {{ built?: string, destroyed?: string, architects: string[], styles: string[], unesco: boolean,
 *   heritage: string[], height?: number, floors?: number, namedAfter: string[], commissionedBy: string[],
 *   dedicatedTo: string[], religion: string[], usedBy: string[], partOf: string[],
 *   hours?: string, fee?: boolean, wheelchair?: boolean }} Facts
 */

const WD_PROPS = {
  P84: "architects", P149: "styles", P138: "namedAfter", P88: "commissionedBy", P112: "commissionedBy",
  P417: "dedicatedTo", P140: "religion", P466: "usedBy", P361: "partOf", P1435: "heritage",
};

/** "1405", "the 1400s", "the 15th century" from a Wikidata time and its precision. */
export function formatWikidataTime(iso, precision) {
  const m = iso.match(/^([+-]?)(\d+)-/);
  if (!m) return undefined;
  let year = Number(m[2]);
  const bc = m[1] === "-";
  if (precision <= 7) {
    const c = Math.floor((year - 1) / 100) + 1;
    const suffix = c % 10 === 1 && c !== 11 ? "st" : c % 10 === 2 && c !== 12 ? "nd" : c % 10 === 3 && c !== 13 ? "rd" : "th";
    return `the ${c}${suffix} century${bc ? " BC" : ""}`;
  }
  if (precision === 8) year = Math.floor(year / 10) * 10;
  return precision === 8 ? `the ${year}s${bc ? " BC" : ""}` : `${year}${bc ? " BC" : ""}`;
}

/**
 * Structured facts about a place: Wikidata (one query, names resolved) plus OpenStreetMap tags.
 * Empty fields when nothing is known. @param {Poi} poi @returns {Promise<Facts>}
 */
export function placeFacts(poi) {
  return cached(`facts:${poi.id}`, async () => {
    /** @type {Facts} */
    const f = { architects: [], styles: [], unesco: false, heritage: [], namedAfter: [], commissionedBy: [], dedicatedTo: [], religion: [], usedBy: [], partOf: [] };
    if (poi.wikidata && /^Q\d+$/.test(poi.wikidata)) {
      const query = `SELECT ?prop ?val ?valLabel ?prec WHERE {
  VALUES ?item { wd:${poi.wikidata} }
  { VALUES ?prop { ${Object.keys(WD_PROPS).map((p) => `wdt:${p}`).join(" ")} wdt:P757 wdt:P2048 wdt:P1101 } ?item ?prop ?val . }
  UNION {
    VALUES (?dp ?prop) { (p:P571 wdt:P571) (p:P576 wdt:P576) }
    ?item ?dp ?st . ?st ?psv ?tv . ?tv wikibase:timeValue ?val ; wikibase:timePrecision ?prec .
    FILTER(STRSTARTS(STR(?psv), "http://www.wikidata.org/prop/statement/value/P5"))
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es,it,pt,nl". }
}`;
      const data = await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, { headers: { accept: "application/sparql-results+json" } }, 8000);
      let builtRaw = "";
      let destroyedRaw = "";
      for (const b of data.results?.bindings ?? []) {
        const prop = b.prop.value.split("/").pop();
        const label = b.valLabel?.value ?? b.val.value;
        if (prop === "P571" || prop === "P576") {
          const when = formatWikidataTime(b.val.value, Number(b.prec?.value ?? 9));
          // Keep the earliest date if there are several.
          if (when && prop === "P571" && (!builtRaw || b.val.value < builtRaw)) {
            f.built = when;
            builtRaw = b.val.value;
          }
          if (when && prop === "P576" && (!destroyedRaw || b.val.value < destroyedRaw)) {
            f.destroyed = when;
            destroyedRaw = b.val.value;
          }
        } else if (prop === "P757") {
          f.unesco = true;
        } else if (prop === "P2048") {
          const h = Number(b.val.value);
          if (h > 0 && h < 1000) f.height = Math.round(h * 10) / 10;
        } else if (prop === "P1101") {
          const n = Number(b.val.value);
          if (n > 0 && n < 200) f.floors = n;
        } else if (WD_PROPS[prop] && !/^Q\d+$/.test(label) && !f[WD_PROPS[prop]].includes(label)) {
          f[WD_PROPS[prop]].push(label); // unlabelled items come back as bare IDs: skipped
        }
      }
      if (f.heritage.some((h) => /world heritage/i.test(h))) f.unesco = true;
    }
    // OpenStreetMap tags fill the gaps.
    const t = poi.tags ?? {};
    if (!f.built && /^\d{3,4}$/.test(t.start_date ?? "")) f.built = t.start_date;
    if (!f.architects.length && t.architect) f.architects.push(t.architect);
    if (!f.styles.length && t["building:architecture"]) f.styles.push(t["building:architecture"].replace(/_/g, " "));
    if (!f.height && Number(t.height) > 0) f.height = Number(t.height);
    if (!f.floors && Number(t["building:levels"]) > 0) f.floors = Number(t["building:levels"]);
    if (t.opening_hours && t.opening_hours.length <= 40) f.hours = t.opening_hours;
    if (t.fee === "yes" || t.fee === "no") f.fee = t.fee === "yes";
    if (t.wheelchair === "yes") f.wheelchair = true;
    return f;
  });
}

/** The few most telling facts as short chips, e.g. ["Built 1405", "Weser Renaissance", "UNESCO World Heritage"]. */
export function factChips(f, max = 4) {
  const chips = [];
  const when = (v) => (v.startsWith("the ") ? `in ${v}` : v); // "Built in the 1400s", "Built 1405"
  if (f.built) chips.push(`Built ${when(f.built)}`);
  if (f.unesco) chips.push("UNESCO World Heritage");
  if (f.styles.length) chips.push(f.styles.slice(0, 2).join(" · "));
  if (f.architects.length) chips.push(`Architect: ${f.architects.slice(0, 2).join(", ")}`);
  if (f.dedicatedTo.length) chips.push(`Dedicated to ${f.dedicatedTo[0]}`);
  if (f.height) chips.push(`${f.height} m tall`);
  if (f.destroyed) chips.push(`Destroyed ${when(f.destroyed)}`);
  if (f.namedAfter.length) chips.push(`Named after ${f.namedAfter[0]}`);
  if (f.usedBy.length) chips.push(`Today: ${f.usedBy[0]}`);
  if (!f.unesco && f.heritage.length) chips.push("Listed monument");
  if (f.hours) chips.push(`Open ${f.hours}`);
  if (f.fee !== undefined) chips.push(f.fee ? "Entry fee" : "Free entry");
  return chips.slice(0, max);
}

/** The facts as a plain list for the narration prompt (empty string when nothing is known). */
export function factsText(f) {
  const lines = [];
  if (f.built) lines.push(`Built: ${f.built}`);
  if (f.destroyed) lines.push(`Destroyed: ${f.destroyed}`);
  if (f.architects.length) lines.push(`Architect: ${f.architects.join(", ")}`);
  if (f.styles.length) lines.push(`Style: ${f.styles.join(", ")}`);
  if (f.commissionedBy.length) lines.push(`Commissioned or founded by: ${f.commissionedBy.join(", ")}`);
  if (f.dedicatedTo.length) lines.push(`Dedicated to: ${f.dedicatedTo.join(", ")}`);
  if (f.religion.length) lines.push(`Religion: ${f.religion.join(", ")}`);
  if (f.namedAfter.length) lines.push(`Named after: ${f.namedAfter.join(", ")}`);
  if (f.usedBy.length) lines.push(`Used by today: ${f.usedBy.join(", ")}`);
  if (f.heritage.length) lines.push(`Heritage status: ${f.heritage.join("; ")}`);
  if (f.partOf.length) lines.push(`Part of: ${f.partOf.join("; ")}`);
  if (f.height) lines.push(`Height: ${f.height} m`);
  if (f.floors) lines.push(`Floors: ${f.floors}`);
  return lines.join("\n");
}

// ---------- Photo of an area ----------

/**
 * A photo for a segment about an area rather than one place: the lead image of the first
 * Wikipedia article found for one of the names (street, quarter, town), tried in order. A result
 * only counts if its title contains the name's first word, so "Am Dom, Bremen" can't come back
 * as some unrelated article.
 * @param {string[]} names e.g. ["Am Dom, Bremen", "Altstadt, Bremen", "Bremen"]
 * @returns {Promise<{ url: string, link: string, credit: string } | null>}
 */
export function areaPhoto(names) {
  const list = names.filter(Boolean);
  return cached(`area-photo:${list.join("|")}`, async () => {
    for (const name of list) {
      const url = new URL("https://en.wikipedia.org/w/api.php");
      for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", origin: "*", generator: "search", gsrsearch: name, gsrlimit: "1", prop: "pageimages", piprop: "thumbnail", pithumbsize: "480" })) {
        url.searchParams.set(k, v);
      }
      const page = (await fetchJson(url.toString())).query?.pages?.[0];
      const key = name.split(/[ ,]/)[0].toLowerCase();
      if (page?.thumbnail?.source && page.title.toLowerCase().includes(key)) {
        return { url: page.thumbnail.source, link: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, credit: "Wikipedia" };
      }
    }
    return null;
  });
}

// ---------- Photo ----------

/**
 * A photo of the place: the Wikipedia article's lead image, or the Wikidata image (P18).
 * @param {Poi} poi @returns {Promise<{ url: string, link: string, credit: string } | null>}
 */
export function placePhoto(poi) {
  return cached(`photo:${poi.id}`, async () => {
    if (poi.wiki) {
      const url = new URL(`https://${poi.wiki.lang}.wikipedia.org/w/api.php`);
      for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", origin: "*", prop: "pageimages", piprop: "thumbnail", pithumbsize: "480", titles: poi.wiki.title })) {
        url.searchParams.set(k, v);
      }
      const thumb = (await fetchJson(url.toString())).query?.pages?.[0]?.thumbnail?.source;
      if (thumb) {
        return { url: thumb, link: `https://${poi.wiki.lang}.wikipedia.org/wiki/${encodeURIComponent(poi.wiki.title.replace(/ /g, "_"))}`, credit: "Wikipedia" };
      }
    }
    if (poi.wikidata) {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&origin=*&property=P18&entity=${poi.wikidata}`;
      const file = (await fetchJson(url)).claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file) {
        const name = encodeURIComponent(file.replace(/ /g, "_"));
        return { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${name}?width=480`, link: `https://commons.wikimedia.org/wiki/File:${name}`, credit: "Wikimedia Commons" };
      }
    }
    return null;
  });
}
