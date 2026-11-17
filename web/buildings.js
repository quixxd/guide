// Building outlines around the listener, for the line-of-sight check (visibility.js).
// Source: OpenFreeMap vector tiles (OpenStreetMap data, no key, served from a CDN), zoom 14, the
// "building" layer. One tile covers about 2.4 km × 1.5 km in central Europe and is cached here and
// by the browser. Decoded with @mapbox/vector-tile and pbf, loaded on first use.

import { cached, fetchJson } from "./sources.js";

/** @typedef {import("./visibility.js").Ring} Ring */

const TILEJSON = "https://tiles.openfreemap.org/planet";
const Z = 14;

let libs = null;
function loadLibs() {
  libs ??= Promise.all([
    import("https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm"),
    import("https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm"),
  ]).then(([vt, pbf]) => ({ VectorTile: vt.VectorTile, Pbf: pbf.default }));
  return libs;
}

/** The current tile address template (it carries the data's build date). */
function tileTemplate() {
  return cached("ofm-tilejson", () => fetchJson(TILEJSON).then((d) => d.tiles[0]), 6 * 3600 * 1000);
}

function tileOf(lat, lon) {
  const n = 2 ** Z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [x, y];
}

/** Outer rings of all buildings in one tile. @returns {Promise<Ring[]>} */
function tileBuildings(x, y) {
  return cached(`buildings:${Z}/${x}/${y}`, async () => {
    const [{ VectorTile, Pbf }, template] = await Promise.all([loadLibs(), tileTemplate()]);
    const url = template.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y));
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`buildings tile ${res.status}`);
    const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
    const layer = tile.layers.building;
    /** @type {Ring[]} */
    const rings = [];
    if (!layer) return rings;
    for (let i = 0; i < layer.length; i++) {
      const geo = layer.feature(i).toGeoJSON(x, y, Z).geometry;
      const polys = geo.type === "Polygon" ? [geo.coordinates] : geo.type === "MultiPolygon" ? geo.coordinates : [];
      for (const poly of polys) {
        if (poly[0]?.length >= 4) rings.push(poly[0].map(([lon, lat]) => [lat, lon]));
      }
    }
    return rings;
  });
}

/**
 * Building outlines within about `radius` metres: the tile you're in plus any neighbour that
 * radius reaches into. @returns {Promise<Ring[]>}
 */
export async function buildingsAround(lat, lon, radius = 400) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const [x0, y1] = tileOf(lat - dLat, lon - dLon);
  const [x1, y0] = tileOf(lat + dLat, lon + dLon);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(tileBuildings(x, y));
  return (await Promise.all(jobs)).flat();
}
