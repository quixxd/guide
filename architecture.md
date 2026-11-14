# Audio Tour Guide: Architecture Options (backend, data, commercials)

Status: v0.2. Path, voice tier, and test approach decided (§10). Monetization is in `monetization.md`. Builds on `spec.md`. All prices are USD list prices as of Nov 2026. Most third-party TTS/STT figures come from vendor pages and comparison roundups, so verify them before committing.

## 1. Summary

- **The main choice is what gets generated ahead of time and shared between listeners, and what gets generated live for each listener.** Three workable answers are compared below:
  - **A. Live:** everything is generated per listener, in real time.
  - **B. Hybrid:** facts are prepared once and shared. The narration itself is written and voiced live for each listener.
  - **C. Library:** the narration audio is prepared once and shared. Only short connecting lines, answers to questions, and gaps in coverage are live.
- **Voice (TTS) is the biggest variable cost, not the LLM.** With current Claude pricing, writing the narration live costs cents per tour hour on Haiku. Voicing it costs from $0.10 to $2.70 per hour depending on voice quality. The voice tier is the single biggest commercial lever.
- **A holiday trip pass (~$10/week) works with B or C, but not with A at premium voice quality.**
- **Recommendation:** build **B**, with the content store designed so popular narration can be cached as audio (C-style) once usage concentrates in hot spots. Use a stripped-down A for the very first prototype to test the experience quickly.

## 2. Building blocks (common to all options)

```
┌──────────── Phone app ─────────────┐        ┌──────────────── Backend ─────────────────┐
│ GPS + heading + speed              │        │ Session orchestrator (one per tour)      │
│ Activity detection (walk/vehicle)  │──────▶ │  ├─ Position & path estimator            │
│ Push-to-talk capture (+ on-device  │  WS    │  │    (map matching → road/street ahead)  │
│   speech recognition)              │◀────── │  ├─ Narration planner (WHAT + WHEN)       │
│ Audio player (ducking, headset     │ audio  │  │    deterministic code, not LLM         │
│   buttons)                         │ +cards │  ├─ Narration writer (LLM: the WORDS)     │
│ Topic cards, controls              │        │  ├─ Voice (TTS)                           │
└────────────────────────────────────┘        │  └─ Session memory (what's been said)    │
                                              │ Geo knowledge base (PostGIS)             │
                                              │  POIs, roads, links to sources           │
                                              │ Content store (fact cards / audio)       │
                                              └──────────────────────────────────────────┘
```

Design rules that hold for every option:

1. **The planner decides *what* and *when*, the LLM decides *the words*.** Pass-by timing, look-ahead, and segment length (spec UC-3) come from deterministic code: it computes the ETA to each POI and gives the writer a time budget ("~25 seconds about X, through the Architecture & Art lens, before Y comes into view"). The LLM never decides timing. This keeps pacing reliable and testable.
2. **Grounded, not remembered.** The writer narrates from retrieved source facts (Wikipedia, Wikidata, OSM), not from the model's memory. This is how we meet the spec's no-made-up-facts rule. Sources travel with the content, so topic cards can show attribution.
3. **The phone handles sensing, the server handles thinking.** Activity detection (walking, in a vehicle, stationary) uses the free built-in OS APIs (iOS Core Motion, Android Activity Recognition). Orchestration runs server-side over a WebSocket, so API keys stay off the device and logic changes don't need app releases.
4. **Speech recognition on the device by default.** Push-to-talk clips are short (~1 minute of speech per tour hour), and the OS speech recognisers are free and fast. A cloud recogniser is a fallback for accuracy (place names). Even then it costs under $0.01 per hour.
5. **Self-host the map and POI data.** Paid places APIs are both expensive at this query rate and restrictive about caching (§3).

## 3. Data sources

| Need | Source | License / terms | Cost | Notes |
|---|---|---|---|---|
| POIs, roads, paths, geometry | **OpenStreetMap** (own extract in PostGIS) | ODbL: attribution required. Derived databases we publish must stay ODbL, but narration we produce from it is fine. | Free data, self-hosted | The backbone. Planet ~80 GB, Europe ~30 GB. |
| Structured facts, links between datasets | **Wikidata** | CC0 | Free (dumps) | Dates, architects, styles, population. Links OSM objects to Wikipedia. |
| Narrative source text | **Wikipedia** | CC BY-SA 4.0 | Free (dumps); Wikimedia Enterprise is paid for high-volume live API use | Main grounding text. Attribution required, and share-alike may apply to derived text, so this needs legal review. |
| Travel context, "Today", food | **Wikivoyage** | CC BY-SA | Free | Neighbourhood feel, local food, practical colour. |
| Restaurants, cafés, shops | **Overture Maps Places** (~72M) / **Foursquare OS Places** (~100M) | CDLA Permissive 2.0 / Apache 2.0 | Free | Better coverage of commercial POIs than OSM. |
| Road ahead, map matching | **Valhalla** or **OSRM** on OSM | Open source | Self-hosted server | Snaps the GPS trace to the road being followed and predicts the path ahead (spec UC-2). |
| Current events (*Today* lens) | LLM web search tool | Pay per search | $10 per 1,000 searches | Use sparingly. Cache per city per day. |
| Map display (optional) | MapLibre + self-hosted vector tiles (Protomaps) or MapTiler | Varies | ~$10–50/mo | The map is optional per the spec. |
| ~~Google Places~~ | Google Maps Platform | Restrictive caching and storage terms | Nearby Search $32–40 per 1,000 requests | **Avoid as a core source.** At one query every 100–200 m it would cost $1–3 per tour hour and couldn't be cached. |

## 4. Unit costs per tour hour

**Assumptions** (adjust to taste):

- The guide speaks ~50% of tour time: **30 minutes of speech per hour**, ≈ 4,500 words ≈ **27,000 characters**.
- ~40 narration segments plus ~10 push-to-talk interactions per hour.
- ~1 minute of user speech per hour (push-to-talk).

### Writing the narration (Claude API, current list prices)

| Model | Input / output per 1M tokens | Live narration cost per hour |
|---|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 | **~$0.03–0.10** |
| Claude Sonnet 5.5 | $2 / $10 (cache reads $0.20) | ~$0.30–1.00 (compact context) / $0.60–2.00 (raw sources) |
| Claude Opus 5.5 | $4 / $20 (cache reads $0.20) | ~$0.60–4.00 |

Batch processing is 50% off, which matters for pre-building content offline.

### Voicing the narration (TTS, 27k characters per hour)

| Tier | Examples | Price | Cost per hour |
|---|---|---|---|
| On-device | iOS / Android system voices | free | **$0** |
| Basic cloud | Google Standard | ~$4 / 1M chars | ~$0.11 |
| Neural | Azure Neural, Polly Neural (~$16/M); OpenAI gpt-4o-mini-tts (~$0.015/min) | — | **~$0.45** |
| HD / generative | Google Chirp 3 HD, Polly Generative, OpenAI tts-1-hd | ~$30 / 1M chars | ~$0.80 |
| Premium expressive | ElevenLabs Flash/Turbo → v3 | ~$40–100 / 1M chars | ~$1.10–2.70 |

At scale, self-hosting an open-source TTS model on GPUs, or a volume deal with a provider, can bring the neural tier down to cents per hour.

### Everything else

| Item | Cost per hour |
|---|---|
| Speech recognition: on-device | $0 |
| Speech recognition: cloud fallback (~$0.003–0.008/min) | < $0.01 |
| Web search for *Today*, cached | ~$0.01–0.02 |
| Audio delivery (~11 MB/hr at 48 kbps Opus) | ~$0.001 (≈ $0 on Cloudflare R2) |
| Geo queries on own PostGIS / Valhalla | ≈ $0 per hour (fixed server cost) |

### Fixed monthly costs (early stage, one region, e.g. Europe)

| Item | Per month |
|---|---|
| API and orchestrator containers | $50–200 |
| Managed Postgres + PostGIS (POIs, content, sessions) | $50–300 |
| Valhalla / OSRM server (Europe needs ~32 GB RAM) | $100–300 |
| Object storage (cached audio, tiles). R2: $15/TB-month, free egress | $10–50 |
| Monitoring and logging | $0–100 |
| **Total** | **~$300–1,000** (global coverage roughly 2× that) |

Plus Apple Developer ($99/yr) and Google Play ($25 one-time).

## 5. Architecture options

### A. Live: everything generated per listener, in real time

**How it works**

1. The phone streams position. The orchestrator map-matches it and fetches nearby and upcoming POIs from PostGIS.
2. For each segment, the orchestrator pulls the **raw source text** for the POIs (Wikipedia extracts, Wikidata, OSM tags) and sends it, with the session memory, lenses, and time budget, to a capable LLM (Sonnet-class). The LLM writes the segment.
3. The text is streamed through cloud TTS, and the audio is streamed to the phone with topic-card events.
4. Push-to-talk follows the same path: speech recognition → LLM with context → TTS.

**What's stored:** only the geo knowledge base and session state. No narration is kept, apart from optional logs.

**Cost:** ~**$1.0–2.5 per hour** with a neural voice, ~$2–4.5 with a premium voice. The LLM carries a lot of context, since it reads raw sources on every call.

| Pros | Cons |
|---|---|
| Fastest to build: no content pipeline | Highest cost per hour, and it grows linearly with use. The same POI is paid for again by every listener. |
| Maximum adaptivity: every word fits this listener's pace, lens, steering, and session history | Runtime hallucination risk: facts are pulled from raw sources live, with no chance to review them |
| Works anywhere OSM and Wikipedia have coverage, from day one | Quality varies between listeners. Harder to test and improve. |
| | Doesn't help the offline roadmap item |

### B. Hybrid: shared fact cards, live narration

**How it works**

1. **Prepared once and shared (lazily):** the first time any listener comes near a POI, or when a region is pre-seeded, a batch job builds a **fact card** for it. The card is a compact, structured, sourced set of facts per lens, e.g. *History*: 5 key facts with dates; *Architecture & Art*: style, architect, notable features; *Curiosities*: 2 odd facts; plus 1–2 sentence "hooks", the links to nearby POIs, and source URLs for attribution. It's generated by a strong model (Sonnet or Opus, batch at 50% off) from Wikipedia, Wikidata, and OSM. Cards can be checked automatically (facts must be traceable to the source text) and reviewed for top POIs. **Area cards** do the same for districts, towns, regions, and road stretches, for the long arcs of driving (spec UC-10).
2. **Live, per listener:** the planner picks POIs and time budgets. A fast, cheap model (Haiku-class) turns the relevant fact cards, session memory, lenses, and tone into the spoken segment, including the personal touches ("remember the merchant family…"). The text is streamed through TTS.
3. **Push-to-talk:** answered from the fact cards first. If the cards don't cover the question, the orchestrator escalates to a stronger model with the raw sources (and web search for current matters).

**What's stored:** geo knowledge base, fact and area cards in Postgres (a few KB per POI, so 1M POIs is a few GB), session state. Cards are refreshed when their sources change (Wikipedia revision IDs) or on a schedule.

**Cost:**
- **Live:** ~**$0.50–0.60 per hour** with a neural voice (LLM ~$0.03–0.10 + TTS ~$0.45). ~$0.15 with a basic voice, ~$1.2–2.8 with a premium one.
- **Building cards:** ~$0.01–0.02 per POI on Sonnet batch. ~$1–2k for the 100k most-visited POIs worldwide, paid lazily as places get visited. Haiku-built cards are 10–20× cheaper if quality allows.

| Pros | Cons |
|---|---|
| Facts are checked once, before anyone hears them. Strongest answer to the honesty requirement. | A content pipeline to build and maintain (generation, verification, refresh) |
| Live narration stays fully personal: pacing, steering, tone, session references | The voice is still paid per listener, which is the main variable cost |
| LLM cost per hour falls ~10–20× compared with A | The first visitor to a long-tail POI waits for (or misses) its card. Needs a fallback to the A-style raw path. |
| Same quality everywhere, and easy to evaluate and tune (cards and narration prompts can be tested separately) | |
| Cards are reusable later for recaps, the visited-places log, offline packs, and more languages | |

### C. Library: shared, pre-rendered narration audio

**How it works**

1. **Prepared once and shared:** for each POI and area, the narration itself is written *and voiced* ahead of time, as a set of variants: per lens × length (≈15 s / 45 s / 2 min) × perhaps a couple of tones. Clips are stored as audio files on a CDN. The hottest areas are pre-rendered in advance, and the rest is rendered the first time someone needs it and kept from then on.
2. **Live, per listener:** the planner works like a smart playlist. It picks the clip variant that fits the time budget and lens, and sequences it. Short **live connecting lines** ("coming up on your left in about 200 metres…", "remember the merchant…") are written live and voiced in the same voice, so the joins aren't audible.
3. **Push-to-talk:** live (as in B). Areas with no clips fall back to B-style live narration.

**What's stored:** everything B stores, plus an audio library. ~36 minutes of audio per fully covered POI (all lens and length variants), ≈ 13 MB at 48 kbps. 100k POIs ≈ 1.3 TB ≈ $20/month on R2.

**Cost:**
- **Live, in hot areas** (≥70–80% of speech served from the library): ~**$0.10–0.30 per hour** even with a high-end voice. In the long tail, the same as B.
- **Pre-rendering:** ~$0.50 per POI for all variants at neural prices, ~$1.30–3.20 at premium prices. Pre-render only the top few thousand POIs and render the rest on demand.

| Pros | Cons |
|---|---|
| Lowest cost per hour where it matters most: city centres, tour bus routes, famous drives. A premium voice becomes affordable. | Less personal: clip wording is fixed, and steering changes which clips play, not what they say. Session references only appear in the connecting lines. |
| Lowest latency and most consistent audio quality | Variants multiply (lenses × lengths × tones), and every voice or prompt change means re-rendering |
| Natural route to the **offline roadmap item**: download a city or region pack | Clip lengths are fixed, so it can't fit odd timing gaps as precisely as live text |
| Content can be reviewed by people before it ships | Two narration paths to keep consistent (library and live fallback). Most complex system overall. |

## 6. Side-by-side

| | A. Live | B. Hybrid | C. Library |
|---|---|---|---|
| Variable cost per hour (neural voice) | $1.0–2.5 | **$0.5–0.6** | $0.1–0.3 hot / $0.5 long tail |
| Variable cost per hour (premium voice) | $2–4.5 | $1.2–2.8 | **$0.3–0.8** hot |
| Upfront content cost | none | low (lazy, ~$1–2k for top 100k POIs) | medium (audio pre-render for top POIs) |
| Personalisation and pace fit | ★★★ | ★★★ | ★★ |
| Fact reliability | ★ | ★★★ | ★★★ |
| Latency | ★★ | ★★ | ★★★ |
| Build effort | ★ (lowest) | ★★ | ★★★ (highest) |
| Fit with the offline roadmap | poor | good (cards travel well) | best |
| Coverage from day one | everywhere | everywhere (with fallback) | hot spots only, B elsewhere |

## 7. Commercials

Pricing and monetization models are covered in `monetization.md`. This section only covers the cost side.

**App store fees:** 15% (Apple and Google small-business programmes under $1M/year revenue, and subscriptions after year one), otherwise 30%. Web checkout is possible in some regions (US, EU), with region-specific rules.

### Unit economics: one 7-day trip pass

Assumes $9.99 price, ~$8.50 after a 15% store fee, and **10 hours of listening** (~1.5 h/day). Heavy users can reach 20 hours.

| | Variable cost (10 h) | Margin per pass | Verdict |
|---|---|---|---|
| A, neural voice | $10–25 | **negative** | Needs ~$20+ pricing or hard caps |
| A, premium voice | $20–45 | **very negative** | Not viable |
| B, basic voice | ~$1.5 | ~80% | Viable, but the voice may feel cheap |
| B, neural voice | ~$5–6 | ~30–40% | Viable, though thin for heavy users |
| B, premium voice | $12–28 | negative | Only as a paid "premium voice" upgrade |
| B + C caching, neural, city use | ~$1–3 | ~65–90% | Healthy |
| C hot areas, premium voice | ~$3–8 | ~10–65% | A premium voice becomes possible in hot spots |

The free tier costs money too. With on-device voice and Haiku it's ~$0.05 per hour. A cloud voice for free users would cost 10× more.

## 8. Recommendation and evolution

1. **Prototype (weeks):** a stripped-down **A**: OSM and Wikipedia lookup, a basic planner, Sonnet writing segments, standard neural TTS, tested wherever we are and in simulated tours (§9). The aim is to validate the experience (timing, pacing, topic cards, steering) as fast as possible, before investing in a content pipeline. Cost isn't a concern at prototype volumes.
2. **MVP:** move to **B**. Add fact and area cards (lazy batch generation, verification, refresh), switch live writing to Haiku, and keep the raw path as the long-tail fallback. Launch on a standard neural voice.
3. **Scale:** add **C-style audio caching** where usage concentrates (city centres, bus tour routes, famous drives). Clips that don't depend on the session get rendered once and reused. That makes a premium voice affordable in hot spots and lays the groundwork for offline region packs.

Moving A → B → C is additive: each step keeps the previous path as a fallback, so nothing is thrown away.

## 9. Testing and simulated tours

Testing happens wherever we are at the time, plus **simulated tours** of places we aren't in. This shapes the architecture in two ways.

**1. Position comes from a swappable source.** The app reads position, heading, speed, and activity through one interface, with three interchangeable sources:

| Source | What it does | Use |
|---|---|---|
| **Real** | Phone GPS + motion sensors | Field tests, production |
| **Recorded trace** | Replays a GPS trace (e.g. GPX) recorded on an earlier walk or drive, at 1× or faster | Repeatable regression tests: the same walk, compared across builds |
| **Simulated route** | Pick a start and end (or waypoints) anywhere in the world, plus a mode (walk, bus, drive). A routing engine generates a realistic path along streets or roads, with realistic speed, stops, traffic lights, and stop-and-go for buses. Speed multiplier, plus manual pause and turn-around. | Exploring places we aren't in. Testing edge cases (U-turns, mode switches, sparse stretches) on demand. |

The backend doesn't know or care which source is active, so a simulated tour exercises exactly the same pipeline as a real one. That includes pass-by timing, which is the hardest thing to get right. A simulated tour should show the moving position on a map, so you can tell whether commentary lands at the right moment.

**2. Data coverage has to follow us anywhere from day one.** Since there's no fixed launch city, the prototype can't depend on a pre-loaded regional extract. It fetches data **on demand** from public APIs instead: the Overpass API for OSM POIs, the Wikipedia and Wikidata APIs, and a public routing endpoint for simulation paths. That's fine at prototype volumes and respects their usage policies. As we move to B, we switch to the self-hosted geo knowledge base, loading regions as they're needed or going straight to a planet extract.

## 10. Decisions made

1. **Architecture:** the A → B → C path (§8).
2. **Voice at launch:** standard neural tier, ~$0.45 per tour hour.
3. **Geography:** no fixed launch region. Test wherever we are, plus simulated tours anywhere (§9).
4. **Monetization:** being worked out separately in `monetization.md`.
