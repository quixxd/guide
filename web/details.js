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
    const fromName = await outlineFromNominatim(poi).catch(() => null);
    if (fromName) return fromName;
    return outlineFromOverpass(poi).catch(() => null);
  });
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
