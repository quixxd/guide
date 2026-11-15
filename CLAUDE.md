# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An app that acts as a personal audio tour guide for walks and drives.

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

`.env` needs `ANTHROPIC_API_KEY`. `ACCESS_TOKEN`, when set, is required on every `/api` call (header `x-access-token`, or `?key=`, which the client stores in localStorage).

## Architecture (current code: the rev1 prototype, still a Node server; rev2 moves it onto the phone)

**Client (`public/`, plain ES modules, no bundler):** a mobile web page. `position.js` holds the two interchangeable position sources (`GpsSource` smooths raw GPS into speed and heading; `SimSource` moves along an OSRM route, with bus stops and a speed multiplier). Both emit the same `{lat, lon, heading, speed}`, so the server can't tell real from simulated. `speech.js` handles output (browser `speechSynthesis`, one sentence per utterance, with a watchdog) and push-to-talk input (Web Speech recognition). `app.js` runs the tour state machine: `waiting → fetching → speaking → waiting`, plus `paused`, `listening` and `answering`. It requests the next segment only once the previous one has finished speaking, so commentary fits the listener's position at that moment.

**Server (`server/`, plain `node:http`):** the endpoints stream NDJSON events (`debug`, `pois`, `card`, `text`, `cards`, `silence`, `error`, `done`).
- `tour.ts` orchestrates one segment: reverse geocode → `pois.ts` gathers places → `planner.ts` decides → sources fetched → `narrator.ts` streams Claude → session updated.
- `planner.ts` is the core rule from `spec/rev1/architecture.md` §2: deterministic code decides **what** to talk about and **for how long**, and the LLM only writes the words. It is pure (no I/O) and unit-tested. Mode comes from speed (`stationary`/`walking`/`vehicle_slow`/`vehicle_fast`), and each mode has a profile (horizon, "near" radius, visibility, segment length limits). It ranks candidates by notability + lens fit + proximity, computes the ETA and closest-approach distance from heading and speed, and picks focus > orientation > now > approaching/look-ahead > deeper > area > silence. The time budget becomes a word budget at 2.6 words/sec.
- `pois.ts` merges Wikipedia geosearch (English plus the local-language wiki) with OpenStreetMap features from Overpass. Queries snap to a grid so a moving listener reuses cached tiles. Overpass is often overloaded, so it gets 4 s before narration goes ahead on Wikipedia alone, and a failure triggers a 2-minute back-off.
- `narrator.ts` holds the prompts. Narration must be grounded in the SOURCES block and end with a `CARDS: a | b` line, which `parsers.ts` strips from the spoken stream. Push-to-talk replies start with an `INTENT: question | steer | control` line. Steering notes are kept per session and fed into later prompts.
- `session.ts` holds sessions in memory: covered POIs, look-ahead announcements, areas covered, recent segments (fed back to avoid repetition), and steering notes. A restart loses them.
- External services (Nominatim, Wikipedia, Overpass, FOSSGIS OSRM) are public and rate-limited. All calls send `config.userAgent`, Nominatim is throttled to 1 request/s, and results are cached in memory (`http.ts` `cached()`).
