// Times each external data source for one position: node scripts/time-sources.ts [lat lon]
import { reverseGeocode } from "../server/sources/nominatim.ts";
import { osmAround } from "../server/sources/overpass.ts";
import { articleText, geosearch, searchArticle } from "../server/sources/wikipedia.ts";

const [lat = 38.7075, lon = -9.1364] = process.argv.slice(2).map(Number);

async function time<T>(label: string, fn: () => Promise<T>, describe: (v: T) => string): Promise<void> {
  const t = Date.now();
  try {
    const v = await fn();
    console.log(`${label.padEnd(22)} ${String(Date.now() - t).padStart(6)} ms  ${describe(v)}`);
  } catch (err) {
    console.log(`${label.padEnd(22)} ${String(Date.now() - t).padStart(6)} ms  FAILED: ${(err as Error).message}`);
  }
}

await time("nominatim reverse", () => reverseGeocode(lat, lon), (p) => p.label);
await time("wikipedia geo (en)", () => geosearch("en", lat, lon, 800), (p) => `${p.length} pages`);
await time("wikipedia geo (pt)", () => geosearch("pt", lat, lon, 800), (p) => `${p.length} pages`);
await time("wikipedia article", () => articleText("en", "Praça do Comércio"), (t) => `${t.length} chars`);
await time("wikipedia search", () => searchArticle("en", "Baixa Lisbon"), (r) => r?.title ?? "none");
await time("overpass", () => osmAround(lat, lon, 800), (e) => `${e.length} elements`);
