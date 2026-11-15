// Public data sources called straight from the phone: Nominatim (address), Wikipedia (articles),
// Overpass (OpenStreetMap features) and OSRM (walking routes for simulated walks).
// All allow calls from web pages. Results are cached in memory for the session.
// Ported from server/sources/*.ts and server/http.ts.

/** @type {Map<string, { promise: Promise<any>, expires: number }>} */
const cache = new Map();
const MAX_ENTRIES = 2000;
const DAY = 24 * 3600 * 1000;

/**
 * Memoise an async load by key. Concurrent callers share one request; failures aren't cached.
 * @template T @param {string} key @param {() => Promise<T>} load @returns {Promise<T>}
 */
function cached(key, load, ttlMs = DAY) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = load();
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  promise.catch(() => cache.delete(key));
  return promise;
}

async function fetchJson(url, init = {}, timeoutMs = 20000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** Serialises calls so consecutive ones start at least gapMs apart (for rate-limited APIs). */
function throttle(gapMs) {
  let last = Promise.resolve();
  let lastStart = 0;
  return function run(fn) {
    const result = last.then(async () => {
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return fn();
    });
    last = result.then(() => undefined, () => undefined);
    return result;
  };
}

// ---------- Nominatim ----------

/**
 * @typedef {{ road?: string, neighbourhood?: string, town?: string, region?: string, country?: string,
 *   countryCode?: string, label: string }} Place
 */

// Nominatim's usage policy allows at most one request per second.
const nominatim = throttle(1100);

/** @returns {Promise<Place>} */
export function reverseGeocode(lat, lon) {
  // ~100 m rounding keeps the cache useful and request volume low.
  const rl = lat.toFixed(3);
  const ro = lon.toFixed(3);
  return cached(`rev:${rl},${ro}`, () =>
    nominatim(async () => {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&accept-language=en&lat=${rl}&lon=${ro}`;
      const a = (await fetchJson(url)).address ?? {};
      /** @type {Place} */
      const place = {
        road: a.road ?? a.pedestrian ?? a.footway ?? a.square,
        neighbourhood: a.neighbourhood ?? a.quarter ?? a.suburb ?? a.city_district,
        town: a.city ?? a.town ?? a.village ?? a.municipality,
        region: a.county ?? a.state_district ?? a.state,
        country: a.country,
        countryCode: a.country_code,
        label: "",
      };
      place.label = [place.road, place.neighbourhood, place.town, place.region, place.country]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join(", ");
      return place;
    }),
  );
}

// ---------- Wikipedia ----------

/**
 * @typedef {{ lang: string, pageId: number, title: string, lat: number, lon: number, wikidata?: string,
 *   extract: string, length: number }} WikiPage
 */

function wikiUrl(lang, params) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", origin: "*", ...params })) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

/** Articles with coordinates within radiusM of a point. @returns {Promise<WikiPage[]>} */
export function geosearch(lang, lat, lon, radiusM) {
  const radius = Math.min(10000, Math.max(10, Math.round(radiusM)));
  return cached(`wiki-geo:${lang}:${lat.toFixed(4)},${lon.toFixed(4)}:${radius}`, async () => {
    const data = await fetchJson(
      wikiUrl(lang, {
        generator: "geosearch",
        ggscoord: `${lat}|${lon}`,
        ggsradius: String(radius),
        ggslimit: "50",
        prop: "coordinates|pageprops|extracts|info",
        ppprop: "wikibase_item",
        colimit: "50",
        exintro: "1",
        explaintext: "1",
        exlimit: "20",
      }),
    );
    /** @type {WikiPage[]} */
    const pages = [];
    for (const p of data.query?.pages ?? []) {
      const c = p.coordinates?.[0];
      if (!c) continue;
      pages.push({
        lang,
        pageId: p.pageid,
        title: p.title,
        lat: c.lat,
        lon: c.lon,
        wikidata: p.pageprops?.wikibase_item,
        extract: (p.extract ?? "").trim(),
        length: p.length ?? 0,
      });
    }
    return pages;
  });
}

const CUT_SECTIONS =
  /\n==+\s*(See also|References|Notes|Further reading|External links|Bibliography|Sources|Gallery|Ver também|Referências|Notas|Bibliografia|Ligações externas|Galeria)\s*==+[\s\S]*$/i;

/** Full plain-text article, trimmed of reference sections and capped at maxChars. */
export function articleText(lang, title, maxChars = 7000) {
  return cached(`wiki-article:${lang}:${title}`, async () => {
    const data = await fetchJson(wikiUrl(lang, { prop: "extracts", explaintext: "1", redirects: "1", titles: title }));
    const text = (data.query?.pages?.[0]?.extract ?? "").replace(CUT_SECTIONS, "").trim();
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  });
}

/** Best-matching article for a free-text topic, or null. */
export function searchArticle(lang, query) {
  return cached(`wiki-search:${lang}:${query}`, async () => {
    const data = await fetchJson(wikiUrl(lang, { list: "search", srsearch: query, srlimit: "1" }));
    const title = data.query?.search?.[0]?.title;
    if (!title) return null;
    return { title, text: await articleText(lang, title, 5000) };
  });
}

// ---------- Overpass (OpenStreetMap) ----------

/** @typedef {{ id: string, name: string, lat: number, lon: number, tags: Record<string, string> }} OsmElement */

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
/** After every endpoint fails, leave Overpass alone for a while instead of piling on. */
const OVERPASS_BACKOFF_MS = 2 * 60 * 1000;
let overpassFailedAt = 0;

function overpassQuery(lat, lon, radius) {
  const around = `(around:${radius},${lat},${lon})`;
  const filters = [
    `["historic"]`,
    `["tourism"~"^(attraction|museum|viewpoint|artwork|gallery)$"]`,
    `["amenity"="place_of_worship"]`,
    `["heritage"]`,
    `["leisure"~"^(park|garden)$"]`,
    `["man_made"~"^(lighthouse|tower|bridge)$"]`,
  ];
  const lines = filters.map((f) => `  nwr${around}["name"]${f};`);
  lines.push(`  nwr${around}["name"]["amenity"~"^(restaurant|cafe|bar|pub|marketplace)$"]["wikidata"];`);
  return `[out:json][timeout:25];\n(\n${lines.join("\n")}\n);\nout center tags 300;`;
}

/** Named sights, heritage, places of worship and parks around a point. @returns {Promise<OsmElement[]>} */
export function osmAround(lat, lon, radiusM) {
  const radius = Math.round(radiusM);
  return cached(`osm:${lat.toFixed(4)},${lon.toFixed(4)}:${radius}`, async () => {
    if (Date.now() - overpassFailedAt < OVERPASS_BACKOFF_MS) throw new Error("Overpass recently unavailable");
    let raw = null;
    for (const endpoint of OVERPASS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQuery(lat, lon, radius))}`,
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(String(res.status));
        raw = (await res.json()).elements ?? [];
        break;
      } catch {
        // try the next endpoint
      }
    }
    if (raw === null) {
      overpassFailedAt = Date.now();
      throw new Error("All Overpass endpoints failed");
    }
    /** @type {OsmElement[]} */
    const out = [];
    for (const el of raw) {
      const pos = el.center ?? (el.lat !== undefined ? { lat: el.lat, lon: el.lon } : null);
      const name = el.tags?.["name:en"] ?? el.tags?.name;
      if (pos && name) out.push({ id: `osm:${el.type}/${el.id}`, name, lat: pos.lat, lon: pos.lon, tags: el.tags ?? {} });
    }
    return out;
  });
}

// ---------- Routing (for simulated walks) ----------

/**
 * Walking route through the given points from the public FOSSGIS OSRM server.
 * @param {{lat: number, lon: number}[]} points
 * @returns {Promise<{ coords: [number, number][], durations: number[], distance: number }>}
 */
export function walkingRoute(points) {
  const path = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  return cached(`route:${path}`, async () => {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${path}?overview=full&geometries=geojson&annotations=duration`;
    const data = await fetchJson(url);
    const r = data.routes?.[0];
    if (data.code !== "Ok" || !r) throw new Error(`No route found (${data.code})`);
    return {
      coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      durations: r.legs.flatMap((leg) => leg.annotation?.duration ?? []),
      distance: r.distance,
    };
  });
}
