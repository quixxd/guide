import { cached, fetchJson } from "../http.ts";

export type WikiPage = {
  lang: string;
  pageId: number;
  title: string;
  lat: number;
  lon: number;
  wikidata?: string;
  /** Plain-text intro; may be empty when the API did not return one. */
  extract: string;
  /** Article size in bytes: a rough notability signal. */
  length: number;
};

type ApiPage = {
  pageid: number;
  title: string;
  coordinates?: { lat: number; lon: number }[];
  pageprops?: { wikibase_item?: string };
  extract?: string;
  length?: number;
  missing?: boolean;
};

type ApiResponse = { query?: { pages?: ApiPage[] } };

const DAY = 24 * 3600 * 1000;

function apiUrl(lang: string, params: Record<string, string>): string {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", ...params })) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

/** Articles with coordinates within radiusM (max 10 km) of a point. */
export function geosearch(lang: string, lat: number, lon: number, radiusM: number): Promise<WikiPage[]> {
  const radius = Math.min(10000, Math.max(10, Math.round(radiusM)));
  const key = `wiki-geo:${lang}:${lat.toFixed(4)},${lon.toFixed(4)}:${radius}`;
  return cached(key, DAY, async () => {
    const data = await fetchJson<ApiResponse>(
      apiUrl(lang, {
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
    const pages: WikiPage[] = [];
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
export function articleText(lang: string, title: string, maxChars = 7000): Promise<string> {
  return cached(`wiki-article:${lang}:${title}`, DAY, async () => {
    const data = await fetchJson<ApiResponse>(
      apiUrl(lang, { prop: "extracts", explaintext: "1", redirects: "1", titles: title }),
    );
    const text = (data.query?.pages?.[0]?.extract ?? "").replace(CUT_SECTIONS, "").trim();
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  });
}

type SearchResponse = { query?: { search?: { title: string }[] } };

/** Best-matching article for a free-text topic, or null. */
export function searchArticle(lang: string, query: string): Promise<{ title: string; text: string } | null> {
  return cached(`wiki-search:${lang}:${query}`, DAY, async () => {
    const data = await fetchJson<SearchResponse>(
      apiUrl(lang, { list: "search", srsearch: query, srlimit: "1" }),
    );
    const title = data.query?.search?.[0]?.title;
    if (!title) return null;
    return { title, text: await articleText(lang, title, 5000) };
  });
}
