# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Chatty Joe**: an app that acts as a personal audio tour guide for walks and drives.

The spec documents live in `spec/`. **`spec/rev2/` is the current revision**; `spec/rev1/` is history and is not edited further.

Rev2 in short: a **prototype** that runs almost entirely on the phone as a web page, narrating live wherever you walk, with a single PHP file on HoboHost shared hosting relaying LLM calls so the API key stays off the phone; then a **rollout** built on a catalog of pre-made walking routes per city (one lens per route, History by default), with scripts written, fact-checked, and reviewed offline, recorded as audio, and played by position along the route. POI buttons along the route play short recorded digressions. **No LLM at run time in the rollout.**

- `spec/rev2/spec.md`: phases, use cases, route model, product decisions (§8), open questions (§7). Source of truth for product behaviour.
- `spec/rev2/architecture.md`: prototype shape and PHP relay, rollout pipeline, route packs, delivery, app; decision log (§5). When a decision is made or changed, record it there or in spec §8, alternatives included.
- `spec/rev2/topics-later.md`: aspects not yet discussed. When one is settled, record it in the relevant doc and remove it there.
- Still in force from rev1, referenced by rev2: `spec/rev1/data-sources.md` (sources and licences), `spec/rev1/market-areas.md` (where to invest, languages), and `spec/rev1/architecture.md` §4, §9, §10, §14, §16 (voice tiers, simulated tours, front-end options, LLM providers, fallback ladder). Rev1's monetization model is withdrawn.

## Workflow

- Commit and push after each change. One commit per logical change, with a descriptive message. Push to the tracking remote right away.

## Commands

Node 24+ runs the TypeScript server directly (type stripping), so there is no build step. Imports use explicit `.ts` extensions and only erasable TypeScript syntax (no enums, namespaces, or parameter properties).

```sh
npm start                      # server on :8787, loads .env if present
npm run dev                    # same, with --watch
npm test                       # node:test, all test/**/*.test.ts
node --test test/planner.test.ts   # a single test file
npm run typecheck              # tsc --noEmit
npm run tunnel                 # cloudflared quick tunnel, for testing on a phone
npm run deploy                 # upload web/ (phone prototype + PHP relay) to HoboHost over FTPS
npm run deploy -- --dry        # list what would be uploaded
```

`.env` needs `ANTHROPIC_API_KEY` for the Node server. The phone prototype's relay uses `LLM_PROVIDER` (default `gemini`) with `GEMINI_API_KEY` and `GEMINI_MODEL`, or `anthropic` with `ANTHROPIC_API_KEY`; `npm run deploy` writes them into the relay config. `ACCESS_TOKEN`, when set, is required on every `/api` call (header `x-access-token`, or `?key=`, which the client stores in localStorage).

## Architecture: phone prototype (`web/`, deployed to https://chattyjoe.com/guide)

Plain ES modules with JSDoc types, no build step, checked by `tsc -p tsconfig.web.json`. Everything runs in the browser except the LLM call. Open as `…/guide/?key=ACCESS_TOKEN` (the page remembers the key). `&sim=bremen` (or `&sim=lat,lon;lat,lon`) walks a simulated route, `&speed=3` speeds it up, `&debug=1` shows the planner's view. On a desktop browser (mouse, no touch) the walk is simulated by default: arrow keys move you north/east/south/west, Shift runs, the cone follows the key direction; it starts where you last stopped, `&start=lat,lon`, or Bremen Marktplatz; `&gps=1` forces real location (`KeySource` in `position.js`).
- `app.js`: walk mode, layout C1/C2 (spec R2-11): a full-screen Leaflet map (Esri World Topo; you as a dot with a fading view cone from the compass or walking direction; places; simulated route) and a bottom sheet whose height follows the finger (handle row, or the content when scrolled to the top) and snaps by flick speed or halfway; collapsed while walking, pulled up to read (photo, narration with the current sentence highlighted, topic buttons, Play/Pause, replay / skip / stop). Tapping a topic or a place on the map makes it the next segment (`pendingFocus`). Wake lock. Loop: prepare a segment, stream it, speak sentence by sentence; when the last sentence of a complete segment starts, the next segment is prepared (`state.next`) so there's no long gap. Places are marked covered when their segment starts playing; spoken text is remembered once complete.
- `tour.js`: `Session` (covered places, announced, areas, recent texts) and `prepareSegment()` (reverse geocode → places → `planner.js` → sources → prompt). Pure planning stays in `planner.js` (unit-tested in `test/web/`).
- `pois.js`, `sources.js`: Wikipedia (en + local language), Overpass (4 s wait, 2-minute back-off), Nominatim (1 request/s), OSRM foot routes, all called directly from the page with an in-memory cache.
- `narrator.js`: prompts (grounded in SOURCES, word budget from the plan). `relay.js`: client for `api/narrate.php`, which streams one provider-neutral event stream (`text`, `done`, `error`) and reports `X-Guide-Calls` (used/limit today).
- `details.js`: for the place being talked about, its shape (Nominatim name search within ~400 m, trying English, local-language and OSM names; Overpass as fallback) and a photo (Wikipedia lead image, else Wikidata P18). Looked up when a segment is prepared, shown when it starts playing; never blocks narration. Also quick facts (`placeFacts`: one Wikidata SPARQL query with labels, plus OSM tags) shown as chips in the open panel (`factChips`) and passed to the narration as a "Facts about …" source (`factsText`, 3 s wait). 
- `visibility.js` (pure, tested) and `buildings.js`: line of sight. Building outlines come from OpenFreeMap vector tiles (zoom 14 `building` layer, decoded with `@mapbox/vector-tile` + `pbf` from jsDelivr); places whose straight line crosses another building are passed to the planner as `blocked`. The planner also applies a field of view (`FOV_LIMIT` 105°, `BESIDE_M` 25 m) using `pos.heading` when moving and `pos.facing` when standing (architecture A2-14).
- Logo: `icons/logo.svg` is the master (a smiling speech bubble with curly yellow hair and a pink cap, on the app's blue); `python scripts/make-icons.py` regenerates the PNG icons from the same geometry.
- PWA: `manifest.json`, `icons/`, `sw.js` (network first for the app's own files so deploys show at once, cache first for versioned CDN libraries, never caches `api/` or third-party data; pages are cached without their query string so `?key=` isn't stored). Installed on iPhone the app has its own storage, so the idle panel asks for the access key when none is stored. `sw.js` is excluded from `tsconfig.web.json` (service-worker globals).
- `geo.js`, `lenses.js`, `position.js`, `speech.js`: ported from the rev1 code below.

## Architecture: rev1 prototype (Node server + `public/`, to be removed once nothing depends on it)

**Client (`public/`, plain ES modules, no bundler):** a mobile web page. `position.js` holds the two interchangeable position sources (`GpsSource` smooths raw GPS into speed and heading; `SimSource` moves along an OSRM route, with bus stops and a speed multiplier). Both emit the same `{lat, lon, heading, speed}`, so the server can't tell real from simulated. `speech.js` handles output (browser `speechSynthesis`, one sentence per utterance, with a watchdog) and push-to-talk input (Web Speech recognition). `app.js` runs the tour state machine: `waiting → fetching → speaking → waiting`, plus `paused`, `listening` and `answering`. It requests the next segment only once the previous one has finished speaking, so commentary fits the listener's position at that moment.

**Server (`server/`, plain `node:http`):** the endpoints stream NDJSON events (`debug`, `pois`, `card`, `text`, `cards`, `silence`, `error`, `done`).
- `tour.ts` orchestrates one segment: reverse geocode → `pois.ts` gathers places → `planner.ts` decides → sources fetched → `narrator.ts` streams Claude → session updated.
- `planner.ts` is the core rule from `spec/rev1/architecture.md` §2: deterministic code decides **what** to talk about and **for how long**, and the LLM only writes the words. It is pure (no I/O) and unit-tested. Mode comes from speed (`stationary`/`walking`/`vehicle_slow`/`vehicle_fast`), and each mode has a profile (horizon, "near" radius, visibility, segment length limits). It ranks candidates by notability + lens fit + proximity, computes the ETA and closest-approach distance from heading and speed, and picks focus > orientation > now > approaching/look-ahead > deeper > area > silence. The time budget becomes a word budget at 2.6 words/sec.
- `pois.ts` merges Wikipedia geosearch (English plus the local-language wiki) with OpenStreetMap features from Overpass. Queries snap to a grid so a moving listener reuses cached tiles. Overpass is often overloaded, so it gets 4 s before narration goes ahead on Wikipedia alone, and a failure triggers a 2-minute back-off.
- `narrator.ts` holds the prompts. Narration must be grounded in the SOURCES block and end with a `CARDS: a | b` line, which `parsers.ts` strips from the spoken stream. Push-to-talk replies start with an `INTENT: question | steer | control` line. Steering notes are kept per session and fed into later prompts.
- `session.ts` holds sessions in memory: covered POIs, look-ahead announcements, areas covered, recent segments (fed back to avoid repetition), and steering notes. A restart loses them.
- External services (Nominatim, Wikipedia, Overpass, FOSSGIS OSRM) are public and rate-limited. All calls send `config.userAgent`, Nominatim is throttled to 1 request/s, and results are cached in memory (`http.ts` `cached()`).
