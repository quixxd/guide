# Audio Tour Guide: Data Sources

Status: v0.1, for discussion. Builds on `architecture.md` §3 (the backbone sources) and §15 (where the data is stored). Licences were checked in Nov 2026 where marked; entries marked *verify* need checking against the source's own terms before we use them commercially.

## 1. Summary

- **Is Wikipedia the best source?** It's the best *single* source: free to reuse, multilingual, and it covers almost every notable place. But it's not the best source for most of what a listener actually passes:
  - Ordinary buildings: heritage registers and national building registries cover far more of them, with authoritative descriptions.
  - Streets: Wikipedia rarely explains a street's name. Wikidata, OpenStreetMap etymology tags, and city street-name databases do.
  - Scenery and drives: geodata does this better. Terrain, land cover, peaks, rivers, and protected areas let us say what's around and what you can see.
  - Depth and local colour: the local-language Wikipedia, Wikivoyage, archives, and public-domain old guidebooks add it.
- **The backbone stays Wikipedia + Wikidata + OpenStreetMap**, joined by Wikidata IDs. Other sources hang off that join: many national heritage registers are already linked from Wikidata.
- **Licences shape what we can use more than coverage does.** Several rich sources forbid commercial use (Portugal's SIPA, HMdb, WDPA). Share-alike licences (Wikipedia, OSM) need a legal check on how they apply to generated narration.
- **Country sources follow a pattern:** heritage register, city street-name database, national mapping agency (terrain, land cover), national library and newspaper archive, open data portal. Portugal is detailed first because that's where we're testing.

## 2. What we need to narrate

| Content | What the guide says | Needs |
|---|---|---|
| **Landmarks** | What it is, its story, why it matters | Identity, facts, narrative text |
| **Individual buildings** | "The pink building on your left was a merchant's palace, built 1760" | Building-level location, date, style, architect, former use, heritage status |
| **Streets** | Why the street has its name, what used to be here | Name origin, namesake, history of the street |
| **Areas** | Neighbourhood, town, region: character, history, today | Area boundaries plus narrative text |
| **Drive roads** | The road's own history (Roman road, old national road, pilgrimage route) | Route geometry plus history |
| **Scenery** | "The ridge ahead is the Serra de Sintra"; "these are cork oaks, Portugal produces half the world's cork" | Terrain, visibility, land cover, named natural features, protected areas, geology |
| **Today** | What's happening, what the place is like now | Current information |
| **Food and drink** | Local specialities, notable places | Places plus regional food knowledge |

## 3. Global sources by kind

### Encyclopedic and narrative text

| Source | Gives us | Coverage | Licence | Notes |
|---|---|---|---|---|
| **Wikipedia (English)** | Narrative text for notable places, areas, people | Very broad; deep for famous places, thin for ordinary ones | CC BY-SA 4.0 | Used in the prototype. Share-alike needs legal review (`architecture.md` §3). Wikimedia Enterprise for high-volume API use. |
| **Wikipedia (local language)** | Far more local detail: pt.wikipedia has many Portuguese churches, streets, and parishes that en.wikipedia lacks | Strong in its own country | CC BY-SA | Used in the prototype alongside English. The model translates while it narrates. |
| **Wikivoyage** | Travel tone: neighbourhood feel, local food, what to see | Cities and regions | CC BY-SA | Good for *Today* and *Food & Drink* |
| **Wikimedia Commons** | Geotagged photos with descriptions, categories per building | Huge, uneven | Per file (mostly CC BY / BY-SA / PD) | Photos for topic cards; descriptions sometimes name buildings Wikipedia doesn't cover |
| **Public-domain guidebooks** (Baedeker, Murray's Handbooks, 19th–early 20th c.; Internet Archive, Project Gutenberg, Wikisource) | Charming historical colour: "a traveller in 1900 would have seen…" | Major European cities and routes | Public domain in many jurisdictions (*verify per edition*) | Outdated facts and attitudes: use as quoted period colour, never as current fact |

### Structured facts

| Source | Gives us | Licence | Notes |
|---|---|---|---|
| **Wikidata** | Architect (P84), style (P149), built/founded (P571), heritage status (P1435), named after (P138), plus IDs linking to other databases (national registers, OSM, Commons) | CC0 | The join key for everything. Prototype only uses it for de-duplication. Pulling these facts is a cheap, big quality win. |
| **GeoNames** | Place names, alternative names, populated places, natural features | CC BY 4.0 | Backup gazetteer; weaker than OSM in Europe |

### Map features

| Source | Gives us | Licence | Notes |
|---|---|---|---|
| **OpenStreetMap** | Every named feature. Useful tags: `historic`, `heritage`, `building`, `architect`, `start_date`, `name:etymology:wikidata`, `tourism=viewpoint`, `natural=peak` (with `ele`), `route` relations, `wikidata` | ODbL (share-alike for databases we publish) | Used in the prototype via Overpass. Building-level tags are rich in some cities, absent in others. |
| **Overture Maps** (places, buildings) | Commercial places (~72M); building footprints, often with height | CDLA Permissive 2.0 / ODbL (buildings layer derives from OSM) | Better shop and restaurant coverage than OSM |
| **Foursquare Open Source Places** | ~100M places | Apache 2.0 | Alternative to Overture places |
| **OpenHistoricalMap** | Historic map features with dates: old city walls, demolished buildings, former borders | CC0 | Coverage patchy, but fits "what used to be here" |

### Heritage registers

National registers describe individual protected buildings and sites with authoritative dates, styles, and history. Coverage is far deeper than Wikipedia. Licences vary country by country (§5).

- **Wikidata links many of them:** e.g. Mérimée ID (France, P380), National Heritage List for England (P1216), Rijksmonument ID (Netherlands, P359), NRHP reference (US, P649). For Portugal it holds SIPA and DGPC IDs. *Verify property numbers when building the loader.*
- **Wiki Loves Monuments lists** on Wikipedia and Commons tie register IDs to coordinates and articles, country by country. They're a ready-made bridge.
- **UNESCO World Heritage List:** a short list, but the headline sites (*verify reuse terms for descriptions*).

### Streets

| Source | Gives us | Licence | Notes |
|---|---|---|---|
| **OSM `name:etymology:wikidata`** (+ `name:etymology` as plain text) | The person or thing a street is named after, as a Wikidata item | ODbL + CC0 | Coverage varies hugely by city: dense where local mappers did it (Brussels, Danish cities, parts of Italy and Spain), sparse elsewhere. Tools: EqualStreetNames, Open Etymology Map. |
| **Wikidata "named after" (P138)** on street items | Same, from the Wikidata side | CC0 | Many streets have Wikidata items via Wiki Loves Monuments or local projects |
| **City street-name databases** | Official name, date named, sometimes the origin story | Varies (§5) | Lisbon publishes its street names as CC0 open data; the origin stories live on the city's Toponymy unit blog (copyrighted). |

### Roads, routes, and drives

| Source | Gives us | Licence | Notes |
|---|---|---|---|
| **OSM route relations** | Named routes: historic routes, pilgrimage ways (Camino de Santiago), scenic routes, long-distance trails, tourist roads | ODbL | Lets the guide say "you're now on the Camino Português" |
| **Itiner-e** | Roads of the Roman Empire (~300,000 km), high resolution | **CC BY 4.0** (confirmed) | Download from itiner-e.org or the 2024 snapshot on Zenodo. Great for drives in Portugal, Spain, France, Italy, the UK. |
| **OpenRailwayMap** (OSM data) | Railways including abandoned and historic lines | ODbL | "This road follows the old Sintra tram line" |
| **National scenic road programmes** | Designated scenic routes with descriptions | Varies | US National Scenic Byways (public domain), Norway's National Tourist Routes, Germany's holiday roads (*verify each*) |
| **Wikipedia articles on famous roads** | The road's own story (e.g. Portugal's EN2) | CC BY-SA | Matched by Wikidata ID on OSM route relations |

### Scenery and landscape

| Source | Gives us | Licence | Notes |
|---|---|---|---|
| **Copernicus DEM (GLO-30)** | Global terrain at 30 m | Free, commercial use allowed (*verify attribution wording*) | Visibility: work out which named peaks, ridges, and valleys the listener can actually see, and which side they're on. A big quality step for drives. |
| **OSM natural features** | Named peaks, ridges, rivers, lakes, bays, capes, forests, viewpoints | ODbL | Combined with the DEM for "the ridge ahead is…" |
| **CORINE Land Cover** (Europe) / **ESA WorldCover** (global, 10 m) | What the land is: forest type, vineyards, olive groves, wetlands, urban | Copernicus free / CC BY 4.0 | "You're driving through cork oak country" (CORINE has agro-forestry classes; national maps are finer, §5) |
| **Natura 2000** (EU protected sites) | Protected areas with species and habitat descriptions | EEA re-use policy, with attribution (*verify*) | Good *Nature & Landscape* material |
| **WDPA / Protected Planet** (global) | All protected areas worldwide | **Non-commercial; commercial use needs a licence** (*verify*) | Use Natura 2000 and national sources instead in Europe |
| **Geological maps** (OneGeology, EGDI, national surveys) | Rock types and landforms | Varies; many national surveys are open | "These cliffs are limestone from the Jurassic" |

### Archives and depth (later)

| Source | Gives us | Licence | Notes |
|---|---|---|---|
| **Europeana** | Aggregated European cultural heritage: photos, documents, objects, with an API | Metadata CC0; items vary | Old photos of a street, objects from a building |
| **Digitised newspapers** | Local events, "on this street in 1911…" | Varies: US Chronicling America public domain; Australia's Trove has an API; others restricted | Rich but noisy; needs careful grounding |
| **Historical maps** (David Rumsey, OldMapsOnline, national map libraries) | What was here before | Varies per map | Later: comparing old and new maps |
| **Arquivo.pt and other web archives** | Past versions of local websites | Varies | Niche |

### Current information (*Today*)

- **LLM web search tools** (`architecture.md` §14): news, events, what a place is like now. Cache per city per day.
- **City open data portals:** events, works, closures, where published.
- **Wikivoyage:** slower-changing "today" material.
- **Local news (later, as a filler chapter, `architecture.md` §16):** LLM web search scoped to the town; local outlets' RSS feeds; municipal press releases and event calendars; GDELT (open global news-event index) for discovery. News text is copyrighted: summarise briefly in our own words, name the outlet, never read articles out. Filter out crime, accidents, tragedy, and named private individuals.

### Commercial and restricted sources

| Source | Why not (yet) |
|---|---|
| **Google Places** | $32–40 per 1,000 requests, and its terms forbid caching (`architecture.md` §3) |
| **HMdb** (Historical Marker Database) | No commercial use without written permission from the copyright holder; any compensation counts as commercial |
| **Atlas Obscura** | No public API; content is copyrighted. A licensing deal is possible later. |
| **Tripadvisor content API** | Strict display rules (their branding, no storing or rewriting) |
| **Guidebook publishers** (Lonely Planet, Michelin, Rough Guides) | Licensing deals only. Possible later for premium quality in hot spots. |

### A later idea: describing what you see

None of the sources say what a building *looks like* from the street. Street-level imagery (Mapillary, CC BY-SA; Commons photos) plus a vision model could produce facade descriptions ("the one with blue-and-white tiles"). Costly and licence-sensitive, so it's for later, if testing shows listeners struggle to identify buildings.

## 4. Best sources per content type

| Content | Primary | Add | Later |
|---|---|---|---|
| Landmarks | Wikipedia (en + local), Wikidata | Heritage register text, Wikivoyage | Archives, licensed guidebooks |
| Individual buildings | Heritage registers, OSM building tags, Wikidata | National building registries (construction year), Commons | Street-level imagery + vision |
| Streets | OSM `name:etymology:wikidata` + Wikidata (namesake's article) | City street-name databases | Old maps, newspapers |
| Areas | Wikipedia (local language), Wikivoyage | Municipal history pages, old guidebooks as period colour | |
| Drive roads | OSM route relations, Wikipedia (road articles) | Itiner-e, OpenRailwayMap, scenic road programmes | |
| Scenery | OSM natural features + Copernicus DEM (visibility) | CORINE / WorldCover / national land cover, Natura 2000, geology | |
| Today | Web search, city open data | Wikivoyage | |
| Food and drink | Overture/Foursquare places, Wikivoyage, Wikipedia (regional cuisine) | | |

## 5. Country-specific sources

The same five kinds of source exist in most countries: **heritage register**, **city street-name database**, **national mapping or land agency** (terrain, land cover, buildings), **national library and newspaper archive**, **open data portal**. The tables list the main ones. Licences vary even within a country, so each needs checking before commercial use.

### Portugal (test country)

| Source | Gives us | Licence | Use |
|---|---|---|---|
| **SIPA / monumentos.gov.pt** (Património Cultural, I.P., formerly DGPC) | The national architectural heritage inventory: detailed records of tens of thousands of buildings | **CC BY-NC-ND 3.0** (records), CC BY-NC-SA 4.0 (spatial data). **Not usable commercially without permission.** | Ask Património Cultural for permission. Meanwhile use SIPA/DGPC IDs on Wikidata to link to Wikipedia articles, without copying SIPA text. |
| **Classified monuments lists** (via Wikidata and Wiki Loves Monuments Portugal) | Which buildings are protected and at what level | CC0 / CC BY-SA | Heritage status per building |
| **Lisbon street names** (dados.cm-lisboa.pt "Toponímia de Lisboa", also on dados.gov.pt) | Official street names and geometry, updated every two months | **CC0** (confirmed) | Street identity. Origin stories are on the City's Toponymy unit blog (copyrighted; *ask*). |
| **Municipal open data** (e.g. Cascais "Património Cultural Imóvel") | Local heritage, public art, archaeological sites | Cascais: **CC0** (confirmed); other municipalities vary | Check each municipality on our routes (Lisbon, Porto, Sintra, Évora) |
| **dados.gov.pt** | National open data portal (e.g. a CC BY 4.0 dataset of heritage counts by region) | Per dataset | Discovery point |
| **DGT (Direção-Geral do Território)** | Admin boundaries (CAOP), land use and land cover map (COS), terrain | Open (*verify per dataset*) | COS is far finer than CORINE: eucalyptus vs cork oak vs pine, vineyards |
| **Portal do Arqueólogo** (Endovélico database) | Archaeological sites | *Verify* | Roman villas, megaliths (Évora region) |
| **Biblioteca Nacional Digital** | Digitised books, maps, prints | Public-domain items free | Old guidebooks, historical maps |
| **Arquivo Municipal de Lisboa** | Historical photos of Lisbon streets | *Verify* | Later: "then and now" |
| **pt.wikipedia** | Far deeper Portuguese coverage than English | CC BY-SA | Already used |

### Other countries (selection)

| Country | Heritage register | Streets and buildings | Land, terrain, maps | Archives | Licence notes |
|---|---|---|---|---|---|
| **Spain** | Bienes de Interés Cultural (Ministry of Culture) + regional catalogues | Municipal open data (Madrid, Barcelona) | IGN / CNIG | Biblioteca Virtual de Prensa Histórica | IGN open (CC BY 4.0); regional catalogues vary |
| **France** | Mérimée (buildings), Palissy (objects), on the POP platform | Paris street names with history (opendata.paris.fr); national address base | IGN (Géoplateforme) | Gallica (BnF) | Mérimée: Licence Ouverte (Etalab). Gallica: free for non-commercial use, fees for commercial. |
| **UK** | Historic England (NHLE), Historic Environment Scotland, Cadw (Wales) | Open Plaques (blue plaques) | Ordnance Survey OpenData | British Library | NHLE and OS OpenData under the Open Government Licence |
| **Netherlands** | Rijksmonumentenregister (RCE) | **BAG**: every building with its construction year | PDOK (Kadaster) | Delpher (newspapers) | RCE and BAG open (BAG CC0) |
| **Germany** | Monument lists per state (Denkmallisten) | 3D building data (LoD2) open in many states | BKG + state survey offices | Deutsche Digitale Bibliothek (API) | Varies by state |
| **Italy** | Vincoli in Rete; ICCD General Catalogue of Cultural Heritage | Municipal open data | IGM, regional geoportals | Biblioteca Digitale Italiana | ICCD open data CC BY 4.0 (*verify*) |
| **Nordics** | Norway: Kulturminnesøk (Riksantikvaren). Sweden: Fornsök and the building register (RAÄ). Denmark: Fund og Fortidsminder. Finland: Museovirasto registers. | Danish street-name origins via OSM/Wikidata (navne.findvej.dk) | National mapping agencies (all open) | National libraries | Generally very open (NLOD, CC0, CC BY) |
| **USA** | National Register of Historic Places (NRHP); HABS/HAER/HALS building surveys (Library of Congress) | City open data | USGS (terrain, geology) | Chronicling America | Federal works public domain. HMdb restricted. |
| **Others** | Australia: state heritage registers. NZ: Heritage New Zealand List. Canada: Canadian Register of Historic Places. | | | Australia: Trove (API) | *Verify per source* |

## 6. Licence rules for us

| Class | Licences | What we can do |
|---|---|---|
| **Green** | CC0, public domain, CC BY, Open Government Licence (UK), Licence Ouverte (France), NLOD (Norway) | Use, rewrite, cache; give attribution where required |
| **Amber** | CC BY-SA (Wikipedia, Wikivoyage), ODbL (OSM) | Use with attribution. Share-alike may apply to databases we publish or to closely derived text, so get a legal review before launch (`architecture.md` §3). |
| **Red** | Non-commercial (NC), no-derivatives (ND), "no commercial use without permission" terms (SIPA, HMdb, WDPA, Gallica commercial) | Don't ingest. Link by ID only, or ask the owner for a licence. |

Attribution has to reach the listener: topic cards show sources, and an "About this content" screen lists licences. Fact cards (B) store the source and licence of every fact, so this can be automated.

## 7. Recommendation by stage

1. **Prototype (now):** English + local Wikipedia, OSM via Overpass, Nominatim, as built.
2. **Cheap next steps (prototype):**
   - **Wikidata facts per place:** architect, style, date, heritage status, "named after". This fills the gaps behind short Wikipedia stubs.
   - **Street names:** OSM `name:etymology:wikidata` → namesake's Wikidata item and article. Street stories while walking.
   - **Scenery:** OSM peaks, viewpoints, rivers, and route relations into the planner for drives.
   - **Wikivoyage** for areas, Today, and food.
3. **MVP (B):** load the green-licensed registers and datasets for the countries we test in, starting with Portugal:
   - Lisbon CC0 street names, Cascais heritage, DGT land cover, Itiner-e.
   - Ask Património Cultural about SIPA, and the Lisbon Toponymy unit about the street-name origin stories.
   - Add Copernicus DEM visibility for drives.
   - Add country packs (heritage register + street names + land cover) as we expand, using the §5 pattern.
4. **Later:** archives and newspapers, old maps, licensed guidebook content for premium hot spots, street-level imagery for facade descriptions.

## 8. Open questions

1. Legal review of share-alike (CC BY-SA, ODbL) for generated narration and published fact cards.
2. Whether Património Cultural will license SIPA for commercial use, and on what terms.
3. Whether the Lisbon Toponymy unit's street-name origin stories can be licensed.

Sources consulted for the licence checks: [SIPA terms](http://www.monumentos.gov.pt/site/app_pagesuser/SitePageContents.aspx?id=08a335ea-db85-4fdd-862b-fe6e623e44a8), [OSM Portugal source list](https://wiki.openstreetmap.org/wiki/WikiProject_Portugal/Lista_de_Fontes), [Lisbon toponymy dataset](https://dados.cm-lisboa.pt/id/dataset/toponimia-de-lisboa/resource/a8729e08-8973-4607-bd2d-cf6ff1183fd0), [Cascais heritage dataset](https://dados.gov.pt/en/datasets/patrimonio-cultural-imovel/), [dados.gov.pt heritage counts](https://dados.gov.pt/en/datasets/bens-imoveis-culturais-n-o/), [OSM name:etymology:wikidata](https://wiki.openstreetmap.org/Key:name:etymology:wikidata), [Open Etymology Map](https://wiki.openstreetmap.org/wiki/Open_Etymology_Map), [Itiner-e](https://www.itiner-e.org/about), [Itiner-e on Zenodo](https://zenodo.org/records/17122148), [HMdb copyright](https://hmdb.org/copyright.asp).
