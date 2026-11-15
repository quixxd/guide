# Audio Tour Guide: Market Areas (Europe)

Status: v0.1, a rough first mapping for discussion. Focus: Europe. The app works anywhere (spec: no fixed launch region). This document decides **where to invest**: content quality (fact cards in B, pre-rendered audio in C, country data packs in `data-sources.md` §7), testing, marketing, and partnerships.

Two angles:
1. **Most visited:** where the volume is. Big demand, but also the most competition.
2. **The sweet spot:** places with solid visitor numbers that existing audio offerings cover poorly. Less competition, and people get value straight away.

## 1. How an area is scored

An **area** is a city, a route (drive, train line, bus loop, boat route, walking route), or a region. Each gets four scores, from 1 to 5:

| Score | Question | Rough proxies (initial mapping) | Measured proxies (ongoing, §4) |
|---|---|---|---|
| **Demand (D)** | How many people come, and how many would use a self-guided audio guide? | Public rankings (Euromonitor, national tourism stats), general knowledge | Eurostat nights spent by non-residents (by region), airport passengers, Wikipedia pageviews of the place or route (English pageviews as a proxy for English-speaking interest), our own usage |
| **Coverage (C)** | How well do existing audio offerings serve it in English? | Judgement: are there obvious GPS audio tours, official audio guides, hop-on hop-off commentary? | Counted listings on VoiceMap, GPSmyCity, SmartGuide, GetYourGuide/Viator "audio tour" results; hop-on hop-off operator city lists; official city audio guides |
| **Fit (F)** | Does the way people move there suit us? | Self-drive popularity, walkable old towns, long scenic stretches, fixed bus, train, or boat routes, English-speaking visitor share | Car-rental and road-trip signals, mode mix in our usage data, season length |
| **Readiness (R)** | Do we have enough grounded material to narrate well? | Density of Wikipedia articles and heritage sites | From our own geo database: articles and register entries per km² or per route km, street-etymology coverage, Wikidata facts per place, mobile coverage |

**Opportunity = D × (6 − C) × F × R.** High demand, low coverage, good fit, enough data. Angle 1 sorts by **D**. Angle 2, the sweet spot, is **D ≥ 3, C ≤ 2, R ≥ 3**.

The fallback ladder (`architecture.md` §16) means sparse areas still get commentary. Readiness measures quality, not whether the app works there.

## 2. Initial mapping, angle 1: most visited

Rough, from public rankings and general knowledge; the scores in §4 will replace it. In the Euromonitor 2025 city index, Paris ranks first for the fifth year running, followed by Madrid, Tokyo, Rome, and Milan; London ranks third worldwide on international arrivals. Most of these places are **already well covered** (C 4–5). They matter for volume, credibility, and fixed-route content, less for differentiation.

| Kind | Areas (Europe) | Notes for us |
|---|---|---|
| **Cities** | London, Paris, Rome, Madrid, Barcelona, Milan, Istanbul, Amsterdam, Prague, Vienna, Berlin, Lisbon, Venice, Florence, Athens, Dublin, Munich, Budapest, Edinburgh, Copenhagen, Porto, Seville | Heavy competition. Our edge is adaptivity: any route, any lens, questions, steering. |
| **Famous streets and walks** | La Rambla, Royal Mile, Champs-Élysées, Unter den Linden, Baixa–Chiado–Alfama, Prague's Royal Route, Grand Canal walks, Via del Corso | Classic walking-tour loops: pre-build fact cards and street cards first |
| **Hop-on hop-off bus routes** | Every top city. Main operators: City Sightseeing (largest presence in the UK, Italy, Spain), Big Bus, plus local operators | Spec UC-11 and S-9. Fixed routes give the highest cache reuse, so these are the first candidates for pre-rendered audio (C). |
| **Walking tour routes** | Free walking tour loops in each top city's old town | Same streets every day: pre-build |
| **Scenic drives** | Amalfi Coast (SS163), Atlantic Ocean Road and Trollstigen (Norway), Transfăgărășan (Romania), Stelvio, Grossglockner High Alpine Road, Ring of Kerry and the Wild Atlantic Way, North Coast 500, Causeway Coastal Route, Route des Grandes Alpes, Romantic Road, Black Forest High Road, Côte d'Azur corniches, Great Dolomites Road, Iceland's Ring Road, Croatia's Adriatic coast road (D8), Portugal's EN2 and Douro N222 | Driving ladder (D0–D5) with terrain visibility. Some have audio coverage already (Ring of Kerry, NC500, Iceland). |
| **Train rides** | Glacier Express, Bernina Express, GoldenPass, Flåm Railway, Bergen Line, West Highland Line, Settle–Carlisle, Douro Line (Porto–Pocinho), Cinque Terre line, Semmering, Rhine Gorge line (Mainz–Koblenz) | Works as fast-vehicle mode. Tunnels and dead zones mean pre-loading the route ahead is essential (`topics-later.md` #3). Few commentaries exist beyond a few premium trains. |
| **Boat routes** | Rhine Gorge, Douro, Danube (Wachau), Lake Como and Lake Garda ferries, Norwegian coastal route, Venice vaporetto line 1, Bosphorus, Seine, Amsterdam canals | Slow-vehicle mode. Fixed routes, so cacheable. |

Excluded for now: Russia and Belarus (sanctions and travel restrictions) and Ukraine (war).

## 3. Initial mapping, angle 2: the sweet spot (hypotheses)

These are areas with good demand and good readiness but, to our knowledge, thin English GPS-audio coverage. **Every entry is a hypothesis** until the coverage count in §4 confirms it. The pattern: second-tier cities, rural and road-trip regions, and countries where existing guides are mostly in the local language.

| Country / region | Candidate areas | Why it may be a sweet spot |
|---|---|---|
| **Portugal** (test country) | Alentejo (Évora, Monsaraz, Marvão), Douro Valley drives, Costa Vicentina, Centro (Coimbra, Tomar, Óbidos, Batalha, Alcobaça, Nazaré), the Sintra–Cascais coast road | Fast-growing tourism, many self-drivers, rich heritage, little English audio beyond Lisbon and Porto |
| **Spain** | Andalusian white villages and Ronda, Extremadura (Cáceres, Mérida, Trujillo), Castile and León (Salamanca, Segovia, Ávila), Asturias, Cantabria, and the Picos de Europa, Galicia | Strong road-trip demand, deep history, coverage concentrated in Madrid, Barcelona, and Seville |
| **Camino de Santiago** (Portugal, Spain, France) | Camino Francés, Camino Português (coastal and central) | Days of walking through small places. A perfect fit for walking mode and the fallback ladder. Large and growing numbers. |
| **Italy** | Puglia (Valle d'Itria, Salento), Sicily (Val di Noto, interior), Matera and Basilicata, Umbria, Le Marche, the Dolomite valleys | Huge demand outside the big four cities, many self-drivers, very rich heritage |
| **France** | Dordogne and Périgord, Provence villages, the Alsace and Burgundy wine routes, Brittany, the Loire by car | Tourism by car, with plenty of French-language content but less in English |
| **Central and Eastern Europe** | Slovenia, Transylvania, Poland beyond Kraków (Gdańsk, Wrocław), Czechia beyond Prague (Český Krumlov, Bohemian Switzerland), Slovakia, Lake Balaton, the Baltic capitals | Rising visitor numbers, good value, thin English audio |
| **Balkans** | Istria and the Croatian islands, Montenegro's coast (Kotor), Mostar, the Albanian Riviera | Fast-growing tourism, road trips |
| **Greece beyond the islands** | Peloponnese, Meteora, Pelion | Self-drive heritage regions |
| **Germany, Austria, Switzerland** | Moselle valley, Saxon Switzerland, Swiss alpine passes, Salzkammergut | Strong drive and rail tourism; some coverage, mostly in German |
| **Nordics** | Norwegian national tourist routes beyond the famous few, Swedish and Finnish lake districts | Long scenic drives with sparse content (some official route material exists) |

**Suggested first clusters** (to confirm with scores):
1. **Portugal:** Lisbon (bus routes and walking loops), Sintra–Cascais, Porto and the Douro (drive, train, and boat), Alentejo, Costa Vicentina, the Camino Português. We're testing here anyway.
2. **Spain:** Andalusia interior, Extremadura, Castile and León, Galicia and the Camino.
3. **Southern Italy:** Puglia, Sicily, Matera.
4. **Road-trip belt:** Slovenia and Croatia, Transylvania, the Alpine passes.

## 4. Ongoing research and crawling

How the mapping becomes a living ranking once we operate.

### Area registry

A table in the app database (`architecture.md` §15) with one row per area: type (city / route / region), geometry, the four scores with their inputs, sources, last refresh, and status (watch / building content / launched / pre-rendered). Routes are stored as lines, so the planner and content pipeline can use them directly.

### Signal pipelines (scheduled batch jobs)

| Signal | Source | Cadence | Notes |
|---|---|---|---|
| Visitor nights by region and month | Eurostat (non-resident nights at regional level; open API) | Quarterly | Also gives the season curve per region |
| Air arrivals | Eurostat aviation statistics | Quarterly | |
| Interest by language | Wikimedia pageviews API, per place and route article, English vs local language | Monthly | Free, fine-grained, and a good proxy for English-speaking interest |
| Travel content presence | Wikivoyage article existence and size | Monthly | |
| Competitor coverage | Public catalogue pages of VoiceMap, GPSmyCity, SmartGuide; "audio tour" result counts on GetYourGuide and Viator; hop-on hop-off operators' city lists; official city audio guides | Quarterly | **Count listings only.** Respect robots.txt and terms, rate-limit, never copy content. Prefer official APIs or partner data where available. |
| Readiness | Our own geo database: articles, register entries, and Wikidata facts per km² / route km; street-etymology coverage | After each data import | |
| Mobile coverage along routes | National regulator coverage maps, OpenCelliD (*verify licence*) | Yearly | Flags routes that need pre-loading or offline packs |

### Our own usage: the strongest signal once live

Aggregated and anonymised, with no raw traces (`architecture.md` §15, D8):
- Tours started, listening time, skips, and questions per area and per mode.
- **The fallback ladder rate:** how often the guide climbs to town, region, or country level, or falls silent. A high rate in a busy area marks a **content gap** to fill with registers, street data, or fact cards.
- Simulated-tour picks and "add my town" requests: demand we don't serve yet.

### Scoring, review, and what it drives

- Scores are recomputed after each refresh. Every quarter, a person checks the ranking and writes a short review of what moved and why.
- The ranking drives:
  - the **content priority list**: which areas get fact cards (B), then pre-rendered audio (C)
  - which **country data packs** to load next (`data-sources.md` §7)
  - **testing** destinations
  - **marketing and partnerships** (`topics-later.md` #10)
- Season curves time marketing pushes and cache warming before each region's peak.

### Guardrails

- Crawl politely and legally: robots.txt, terms of service, rate limits, counts rather than content.
- Usage data stays aggregated. No individual traces in research datasets.
- Keep sources and dates for every score, so a ranking can be explained and reproduced.

## 5. Open questions

1. A reliable way to estimate the **English-speaking share** of visitors per area (Eurostat breaks down by country of residence for some regions only).
2. How to weight **drives vs walks** in the opportunity score until we have our own usage data.
3. Whether to count non-English competitor content as coverage. It matters if more languages are added (spec roadmap).

Sources for the figures quoted: [Euromonitor Top 100 City Destinations 2025](https://www.euromonitor.com/newsroom/press-releases/december-2025/euromonitor-international-unveils-worlds-top-100-city-destinations-for-2025), [Hospitality Net on the 2025 index](https://www.hospitalitynet.org/news/4130066.html), [CNN-sourced arrivals list](https://abc17news.com/?p=1577015), [City Sightseeing (Wikipedia mirror)](https://ipfs.aleph.im/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco/wiki/City_Sightseeing.html), [VoiceMap App Store listing](https://apps.apple.com/app/id852027939), [SmartGuide blog](https://blog.smart-guide.org/en/best-tour-guide-apps-for-travelers-in-2026), [DiscoverCars cross-border routes](https://www.discovercars.com/blog/europe-cross-border-travel-routes).
