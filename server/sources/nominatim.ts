import { cached, fetchJson, throttle } from "../http.ts";

export type Place = {
  road?: string;
  neighbourhood?: string;
  town?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  /** Short human-readable "where you are", e.g. "Rua Augusta, Baixa, Lisbon, Portugal". */
  label: string;
};

type ReverseResponse = {
  display_name?: string;
  address?: Record<string, string>;
};

// Nominatim's usage policy allows at most one request per second.
const nominatim = throttle(1100);
const DAY = 24 * 3600 * 1000;

export function reverseGeocode(lat: number, lon: number): Promise<Place> {
  // ~100 m rounding keeps the cache useful and request volume low.
  const rl = lat.toFixed(3);
  const ro = lon.toFixed(3);
  return cached(`rev:${rl},${ro}`, DAY, () =>
    nominatim(async () => {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&accept-language=en&lat=${rl}&lon=${ro}`;
      const data = await fetchJson<ReverseResponse>(url);
      const a = data.address ?? {};
      const place: Place = {
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

export type GeocodeHit = { name: string; lat: number; lon: number };

export function geocode(q: string): Promise<GeocodeHit[]> {
  return cached(`geo:${q.toLowerCase()}`, DAY, () =>
    nominatim(async () => {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(q)}`;
      const data = await fetchJson<{ display_name: string; lat: string; lon: string }[]>(url);
      return data.map((d) => ({ name: d.display_name, lat: Number(d.lat), lon: Number(d.lon) }));
    }),
  );
}
