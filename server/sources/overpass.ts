import { config } from "../config.ts";
import { cached } from "../http.ts";

export type OsmElement = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

type RawElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const DAY = 24 * 3600 * 1000;
/** After every endpoint fails, leave Overpass alone for a while instead of piling on. */
const BACKOFF_MS = 2 * 60 * 1000;
let failedAt = 0;

function buildQuery(lat: number, lon: number, radius: number): string {
  const around = `(around:${radius},${lat},${lon})`;
  // Over large radii (driving), only keep things notable enough to have a Wikidata entry.
  const wd = radius > 1500 ? `["wikidata"]` : "";
  const filters = [
    `["historic"]`,
    `["tourism"~"^(attraction|museum|viewpoint|artwork|gallery|zoo|theme_park)$"]`,
    `["amenity"="place_of_worship"]`,
    `["heritage"]`,
    `["leisure"~"^(park|garden)$"]`,
    `["natural"~"^(peak|beach|cliff|cape|bay)$"]`,
    `["man_made"~"^(lighthouse|tower|bridge)$"]`,
  ];
  const lines = filters.map((f) => `  nwr${around}["name"]${f}${wd};`);
  // Restaurants, cafés and markets only when they are notable themselves.
  lines.push(`  nwr${around}["name"]["amenity"~"^(restaurant|cafe|bar|pub|marketplace)$"]["wikidata"];`);
  return `[out:json][timeout:25];\n(\n${lines.join("\n")}\n);\nout center tags 300;`;
}

async function query(q: string): Promise<RawElement[]> {
  if (Date.now() - failedAt < BACKOFF_MS) throw new Error("Overpass recently unavailable; backing off");
  const errors: string[] = [];
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": config.userAgent, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { elements?: RawElement[] };
      return data.elements ?? [];
    } catch (err) {
      errors.push(`${new URL(endpoint).host}: ${(err as Error).message}`);
    }
  }
  failedAt = Date.now();
  throw new Error(`All Overpass endpoints failed (${errors.join("; ")})`);
}

/** Named sights, heritage, places of worship, parks and notable food places around a point. */
export function osmAround(lat: number, lon: number, radiusM: number): Promise<OsmElement[]> {
  const radius = Math.round(radiusM);
  return cached(`osm:${lat.toFixed(4)},${lon.toFixed(4)}:${radius}`, DAY, async () => {
    const raw = await query(buildQuery(lat, lon, radius));
    const out: OsmElement[] = [];
    for (const el of raw) {
      const pos = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
      const name = el.tags?.["name:en"] ?? el.tags?.name;
      if (!pos || !name) continue;
      out.push({ id: `osm:${el.type}/${el.id}`, name, lat: pos.lat, lon: pos.lon, tags: el.tags ?? {} });
    }
    return out;
  });
}
