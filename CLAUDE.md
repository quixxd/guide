# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An app that acts as a personal audio tour guide for walks and drives.

`spec.md` holds the agreed product spec: use cases, user scenarios, scope, and roadmap. Treat it as the source of truth for product behaviour, and update it when decisions change.

`architecture.md` compares the backend, data source, and cost options, and records the decisions: start with live generation (A), move to shared fact cards with live narration (B), then add pre-rendered audio caching (C). Standard neural voice at launch. There is no fixed launch region: testing happens wherever we are and in simulated tours, so position must come from a swappable source (real GPS, recorded trace, or simulated route). It also covers front-end, hosting, language, and LLM provider options (decided for the prototype, open for the full app), what the prototype actually uses, and a decision log with the rejected alternatives (§15). Product decisions are logged in `spec.md` §11. When a decision is made or changed, record it there, alternatives included.

`monetization.md` records the launch model: one free tour, then day, week, and annual passes that each include a set number of listening hours, plus top-ups. There are no unlimited plans or ads at launch, prices are regional, and remaining time is not shown on screen.

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
```

`.env` needs `ANTHROPIC_API_KEY`. `ACCESS_TOKEN`, when set, is required on every `/api` call (header `x-access-token`, or `?key=`, which the client stores in localStorage).

## Architecture (prototype = architecture A)

**Client (`public/`, plain ES modules, no bundler):** a mobile web page. `position.js` holds the two interchangeable position sources (`GpsSource` smooths raw GPS into speed and heading; `SimSource` moves along an OSRM route, with bus stops and a speed multiplier). Both emit the same `{lat, lon, heading, speed}`, so the server can't tell real from simulated. `speech.js` handles output (browser `speechSynthesis`, one sentence per utterance, with a watchdog) and push-to-talk input (Web Speech recognition). `app.js` runs the tour state machine: `waiting → fetching → speaking → waiting`, plus `paused`, `listening` and `answering`. It requests the next segment only once the previous one has finished speaking, so commentary fits the listener's position at that moment.

**Server (`server/`, plain `node:http`):** the endpoints stream NDJSON events (`debug`, `pois`, `card`, `text`, `cards`, `silence`, `error`, `done`).
- `tour.ts` orchestrates one segment: reverse geocode → `pois.ts` gathers places → `planner.ts` decides → sources fetched → `narrator.ts` streams Claude → session updated.
- `planner.ts` is the core rule from architecture.md: deterministic code decides **what** to talk about and **for how long**, and the LLM only writes the words. It is pure (no I/O) and unit-tested. Mode comes from speed (`stationary`/`walking`/`vehicle_slow`/`vehicle_fast`), and each mode has a profile (horizon, "near" radius, visibility, segment length limits). It ranks candidates by notability + lens fit + proximity, computes the ETA and closest-approach distance from heading and speed, and picks focus > orientation > now > approaching/look-ahead > deeper > area > silence. The time budget becomes a word budget at 2.6 words/sec.
- `pois.ts` merges Wikipedia geosearch (English plus the local-language wiki) with OpenStreetMap features from Overpass. Queries snap to a grid so a moving listener reuses cached tiles. Overpass is often overloaded, so it gets 4 s before narration goes ahead on Wikipedia alone, and a failure triggers a 2-minute back-off.
- `narrator.ts` holds the prompts. Narration must be grounded in the SOURCES block and end with a `CARDS: a | b` line, which `parsers.ts` strips from the spoken stream. Push-to-talk replies start with an `INTENT: question | steer | control` line. Steering notes are kept per session and fed into later prompts.
- `session.ts` holds sessions in memory: covered POIs, look-ahead announcements, areas covered, recent segments (fed back to avoid repetition), and steering notes. A restart loses them.
- External services (Nominatim, Wikipedia, Overpass, FOSSGIS OSRM) are public and rate-limited. All calls send `config.userAgent`, Nominatim is throttled to 1 request/s, and results are cached in memory (`http.ts` `cached()`).
