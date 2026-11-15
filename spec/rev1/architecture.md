# Audio Tour Guide: Architecture Options (backend, data, commercials)

Status: v0.4. Path, voice tier, and test approach decided. Front end (§10) and hosting (§11) are decided for the prototype and deferred for the full app. §12 lists what the prototype actually uses, §13 maps where code runs and which language fits each place, §14 compares LLM providers, §15 covers data storage, §16 defines the fallback ladder for describing a location, and the decision log (§17) records every decision with the alternatives considered. Monetization is in `monetization.md`. Builds on `spec.md`. All prices are USD list prices as of Nov 2026. Most third-party TTS/STT figures come from vendor pages and comparison roundups, so verify them before committing.

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

The backbone sources are below. `data-sources.md` goes further: sources for streets, individual buildings, drive roads, and scenery, country-specific sources (Portugal first), and licence rules.

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

Other providers are compared in §14.

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

## 10. Front end

What decides the front end isn't the screens. It's what has to keep working for an hour with the phone in a pocket: location and audio with the screen locked, lock-screen and headset controls, push-to-talk, and later CarPlay / Android Auto, offline packs, and app store purchases. A browser on iPhone can't keep reading location or speaking once the screen locks, and Android browsers stop location too.

| | A. Web app | B. Capacitor (web app in a native shell) | C. React Native + Expo | D. Native (Swift + Kotlin) |
|---|---|---|---|---|
| Location and audio with screen locked | No | Yes, via native plugins | Yes | Yes |
| Lock-screen and headset controls | Unreliable with the browser voice | Yes, via plugin | Yes | Yes |
| CarPlay / Android Auto | No | Hard (custom native code) | Possible (community library or own module) | Best |
| Prototype code reused | All | Most screens and logic | Logic; screens rewritten | None |
| TypeScript shared with server | Yes | Yes | Yes | No |
| Buying passes | Web checkout | App store billing (e.g. RevenueCat) | Same as B | StoreKit / Play Billing |
| Effort for iPhone + Android | Lowest | Low | Medium | Highest (two codebases) |

Flutter sits in the same tier as C but uses Dart, so it loses the shared TypeScript.

Whichever shell wins, the client keeps the same layers so a swap doesn't touch the logic: a **tour engine** (pure TypeScript state machine and segment queue, no UI), a **position source** (GPS, recorded trace, simulated route), an **audio output** designed as "play this queue of clips, with captions" (browser voice today, server-rendered audio later), **voice input**, an **API client** with event types shared with the server, and a **thin UI**. In the prototype the engine and the page code are still mixed in `public/app.js`; splitting them is planned for later.

### Alternative considered: running inside an AI assistant (ChatGPT app, Claude connector, Gemini)

The idea: build the guide as an app inside ChatGPT (OpenAI's Apps SDK), or as a connector for Claude or Gemini, with all generation live and tied to the user's assistant account. Our server would offer tools such as `whats_around(lat, lon, heading)`, `tell_me_about(place)`, and `the_road_ahead`, returning grounded facts. The assistant's model would write the words and its voice mode would speak them. Findings as of Nov 2026, mostly from third-party and developer-forum reports, so to re-check before acting:

| | Works | Breaks or unclear |
|---|---|---|
| Cost | Generation and voice run on the user's assistant account. Our LLM and TTS costs drop to ~zero. | — |
| Voice | ChatGPT's voice can keep running in the background and shows on the iPhone lock screen | Unclear whether voice mode calls app tools: developers report it doesn't, while OpenAI's help page says Live voice can use connected apps |
| Position | — | **No continuous GPS feed to apps.** ChatGPT's own location sharing is an optional setting for search. The workaround, a companion app posting GPS to our server, is a native background app anyway. |
| Proactive narration | — | **The assistant only speaks when spoken to.** Scheduled tasks run at most hourly and reportedly exclude voice chats. No pace-aware narration: it becomes ask-and-answer ("what's this?", "continue"). |
| Control and quality | Our tools still supply grounded sources | The assistant's model decides what to say and for how long, so our planner, word budgets, and "only from sources" rule become requests, not guarantees. No button-first controls, topic cards, or headset semantics of our own. We can't pick the model. |
| Accounts and distribution | Account linking via OAuth; listing in the assistant's app directory | Ranking and policy controlled by the platform; apps were reportedly renamed "plugins" in July 2026 |
| Payments | External checkout on our own site is allowed | As of early 2026, ChatGPT apps couldn't sell digital goods or subscriptions in-app, so passes would be sold outside |

**Verdict:** not viable as the main product. Hands-free, pace-aware touring needs continuous GPS, unprompted speech, and our planner owning the timing, and none of those are available inside an assistant. **Worth doing later as a secondary channel ("Ask mode"):** questions while standing or sitting somewhere, trip planning, and discovery for the full app. It reuses the B-stage data layer (fact cards, the fallback ladder in §16), exposed as an MCP tool server, so little of the work is extra.

## 11. Backend hosting

What the backend needs, by stage:

- **Prototype (A, now):** one Node process. Sessions live in memory, responses are long-lived streams (a segment can take 10–60 s), and all data comes from public APIs. The phone needs an HTTPS address.
- **MVP and later (B, then C):**
  - the session orchestrator: WebSocket or streaming HTTP, one connection per tour, for an hour or more
  - Postgres with PostGIS
  - a routing and map-matching server (Valhalla or OSRM, ~32 GB RAM for Europe)
  - batch jobs that build fact and area cards
  - object storage and a CDN for cached audio
  - auth and purchase webhooks (e.g. RevenueCat)

  Location traces are personal data, so EU hosting and short retention are the safe default.

Two constraints rule some platforms in or out:
- **Long-lived streams:** platforms with short request time limits (some serverless functions cap requests at 10–60 s) don't fit the orchestrator.
- **Session state:** in-memory sessions only work on a single instance. Running more than one needs sticky routing, or the state moved to Redis or Postgres.

### Prototype options

| | P1. Laptop + Cloudflare quick tunnel | P2. Laptop + named Cloudflare tunnel | P3. Small PaaS container (Fly.io, Railway, Render) | P4. Serverless / edge (Cloudflare Workers, Vercel, Lambda) |
|---|---|---|---|---|
| Cost | $0 | $0 plus a domain (~$10/yr) | ~$5–10/month | $0–5/month |
| Always reachable | Only while the PC is on and online | Same as P1 | Yes | Yes |
| Stable address | No: it changes on every restart | Yes | Yes | Yes |
| Setup | One command | Cloudflare account, a domain, one-time config | Account, Dockerfile or buildpack, secrets | A rewrite: no in-memory sessions, runtime limits |
| Fit | Testing by one person, with this PC left on | Same as P1, without re-sharing the URL | Testers elsewhere, or the PC is off | Poor at this stage |

Render's free tier sleeps after inactivity, and the first request then waits ~30–60 s. If we choose Render, use a paid instance.

### Production options (MVP onwards)

| | H1. PaaS containers + managed DB | H2. Hyperscaler managed services | H3. Rented servers (VPS / dedicated) | H4. Edge-first (Cloudflare) |
|---|---|---|---|---|
| Examples | Orchestrator on Fly.io, Railway or Render. Managed Postgres with PostGIS (Supabase, Neon, or the platform's own). R2 for audio. | AWS (ECS Fargate or App Runner, RDS with PostGIS, S3 + CloudFront) or GCP (Cloud Run, Cloud SQL, GCS) | Hetzner or OVH, deployed with Docker plus Kamal or Coolify | Workers + Durable Objects (one per tour session, holding its WebSocket) + R2 + Hyperdrive to Postgres |
| Monthly cost at the start (one region) | ~$100–400 | ~$300–1,000 | ~$60–200 | ~$50–150, plus somewhere to run PostGIS and routing |
| Big-RAM routing server | Expensive on PaaS | Fine, at hyperscaler prices | **Cheapest:** a 64 GB dedicated server is roughly €40–70/month | Not possible here; needs H1–H3 |
| Operations burden | Low | Medium: many services to wire together | **High:** we patch, back up, and fail over ourselves | Low for the edge part, but the system is split in two |
| Scaling and regions | Easy multi-region (Fly.io) | Anything, anywhere | Manual. Few regions (EU, some US). | Global by default |
| Lock-in | Low (containers) | Medium | Lowest | High (Workers runtime, Durable Objects) |
| Extras | | Startup credit programmes, compliance certifications | | R2 is already the choice for audio |

Firebase-style backends aren't listed: they have no PostGIS for the geo queries. Supabase appears under H1 as a managed Postgres + PostGIS option, not as the whole backend, because the orchestrator still needs a long-running service.

Prices are rough starting figures as of Nov 2026; check the providers' pricing pages before committing.

### Recommendation

- **Prototype:** stay on **P1** (decided).
  - Move to **P2** if sharing a new address after every restart gets annoying.
  - Move to **P3** (Fly.io or Railway, one instance, EU region) when someone other than us tests it, or the PC can't stay on. P3 needs a Dockerfile and the secrets set on the platform.
  - Both moves work with the current code.
- **MVP and later:** deferred. The leading candidate mixes **H1** and **H3**:
  - the orchestrator and API in a PaaS container in the EU
  - managed Postgres with PostGIS
  - R2 for audio
  - the RAM-heavy parts (Valhalla/OSRM, the card-building batch jobs) on one rented dedicated server

  Revisit **H2** if startup credits make it effectively free, and **H4** if global latency becomes the bottleneck.

## 12. The prototype as built

The first prototype is a deliberately stripped-down A. These are its choices; several differ from the target design in §2:

| Area | Prototype choice | Alternatives considered | Target design |
|---|---|---|---|
| Client platform | Mobile web app, opened from a URL | Expo / React Native app via Expo Go: closer to the product, but slower to change, and desktop simulation is harder | Phone app; shell deferred (§10) |
| Voice | Browser built-in speech synthesis: free, no key, works straight away | OpenAI gpt-4o-mini-tts (recommended at the time, ~$0.45/hr); Google Cloud TTS Neural2/WaveNet (~$0.45/hr) | Standard neural cloud voice, rendered on the server |
| Push-to-talk | Browser speech recognition (Web Speech), with a typed fallback | — | On-device OS recogniser, cloud fallback |
| Hosting | Laptop + Cloudflare quick tunnel | Fly.io or Render container | See §11 |
| Server runtime | Node 24 running TypeScript directly (no build step), plain `node:http` | A framework (Express, Fastify, Hono) | Open |
| Transport | NDJSON streamed over HTTP POST, one request per segment | WebSocket | WebSocket or streaming HTTP (§2) |
| Narration model | Claude Sonnet 5.5 at low effort, grounded in raw Wikipedia/OSM text | Haiku (cheaper; becomes the choice in B, once fact cards exist) | Haiku over fact cards (B) |
| Places data | Public APIs on demand: Wikipedia geosearch (English + local language), Overpass, Nominatim, cached in memory | Own OSM extract in PostGIS (too slow to set up for a prototype) | Self-hosted geo knowledge base (§3) |
| Path ahead | Heading and speed from GPS; no map matching | Valhalla / OSRM map matching | Map-matched road ahead (spec UC-2) |
| Simulated routes | Public FOSSGIS OSRM (foot and car profiles) | Self-hosted OSRM / Valhalla | Self-hosted routing |
| Map | Leaflet with OSM tiles | MapLibre + vector tiles | Optional, per the spec |
| Sessions | In memory, lost on restart | Redis / Postgres | Persistent |

## 13. Code environments and languages

Every place our code runs, the language options for it, and a recommendation. None of these were decided explicitly before. The prototype's choices (TypeScript on the server, plain JavaScript in the browser) were made to get it running.

The main tension is **one language everywhere** (shared types, shared logic, one toolchain, one person can work across the whole system) against **the best tool for each job** (Python for data work, Swift/Kotlin for deep phone integration, Go for very many connections).

| # | Environment | What runs there | Options | Recommendation |
|---|---|---|---|---|
| E1 | **Phone app** | Screens, tour engine, position, audio, push-to-talk | TypeScript (web, Capacitor, Expo); Swift + Kotlin (native); Dart (Flutter) | **TypeScript.** It follows from the front-end leading candidate (Expo, §10). Prototype: keep plain JavaScript until the engine is split out of `app.js`, then make the engine TypeScript. |
| E2 | **Native phone modules** | CarPlay / Android Auto, edge cases in background audio and location that libraries don't cover | Swift (iOS) + Kotlin (Android); none if libraries suffice | **Swift + Kotlin, only when needed,** as small Expo modules. No native code until a feature requires it. |
| E3 | **Tour server** (orchestrator + API) | Sessions, planner, LLM streaming, TTS streaming, WebSocket/streaming HTTP, auth, purchase webhooks | TypeScript/Node (current); Python (FastAPI); Go; Kotlin/JVM; Elixir | **TypeScript/Node.** The work is mostly waiting on I/O (LLM, TTS, data). Types are shared with the app, and it's already written. (LLM and TTS vendor SDKs exist for Python and Go too, so they don't decide this.) Go or Elixir only become interesting at very large numbers of simultaneous tours. |
| E4 | **Shared core** | Planner, geometry, lens definitions, API event types | TypeScript package used by both app and server; schema-first contracts (JSON Schema / OpenAPI) if languages diverge | **A shared TypeScript package.** Bonus: the planner can then also run on the phone, which the offline roadmap item needs. If another language joins, generate JSON Schema from the TypeScript schemas (e.g. Zod). |
| E5 | **Content pipeline** (batch jobs) | Building and checking fact and area cards, refreshing them when Wikipedia changes, pre-rendering audio (C), Claude batch calls | TypeScript (same as server); Python | **TypeScript by default,** since cards use the same schemas as the server. **Python is allowed for heavy one-off data processing** where its libraries are clearly better (Wikipedia dump parsing, `pyosmium`, data analysis). |
| E6 | **Geo data and routing** | PostGIS, Valhalla / OSRM, importing OSM, Overture, and Wikidata | Not our code to write: SQL, osm2pgsql's Lua style files, routing config files | **SQL + config files.** Keep geo queries in SQL (PostGIS), called from E3/E5. |
| E7 | **Quality tools** | Unit tests, simulated and replayed tours, narration quality evals, end-to-end app tests | node:test (current); Vitest; Playwright (web); Maestro or Detox (Expo); Python for evals | **node:test now; Vitest once there's an app package.** Playwright for the web prototype, Maestro for the Expo app. Narration evals in TypeScript next to the prompts, unless the eval tooling we pick is Python-only. |
| E8 | **Infrastructure** | Container builds, deploy config, cloud resources | Platform config files (Dockerfile, `fly.toml`); OpenTofu/Terraform (HCL); Pulumi (TypeScript) | **Dockerfile + platform config at first.** Add OpenTofu, or Pulumi if staying in TypeScript, only when resources outgrow one platform (H2/H3 in §11). |
| E9 | **Web pages** (later) | Landing page, web checkout where allowed, an internal tool for reviewing fact cards | Static site (Astro); React (Next.js, Vite); the content-review tool could be server-rendered by E3 | **TypeScript.** Astro for the public site; the review tool as a small React or server-rendered page on E3. Not needed before B. |

**Repository shape that fits the recommendation:** one repository with npm workspaces: `app/` (E1, E2), `server/` (E3), `shared/` (E4), `pipeline/` (E5), plus `infra/` (E8). Moving to it can wait until the app or the pipeline starts.

**What would change the recommendation:**
- Choosing fully native or Flutter for the app (§10) breaks E1/E4 sharing. Contracts would then go schema-first, and E3's TypeScript advantage shrinks.
- If the content pipeline turns out to be mostly data science (ranking notability, entity matching across OSM, Wikidata, and Overture), Python for E5 becomes the better call.

## 14. LLM provider

The model that writes the narration was never chosen explicitly. Claude was assumed from the start, and the prototype uses Claude Sonnet 5.5. This section compares the alternatives on equal terms. (It was drafted by Claude, an Anthropic model, so the comparison deliberately avoids quality claims that haven't been measured.)

### Two jobs, two tiers

- **Live narration and push-to-talk answers:** many short calls, and speed to the first words matters. In A the model reads raw source text (large input). In B it turns compact fact cards into speech (small input), which is the job of a fast, cheap model.
- **Building fact and area cards (B) and hard questions:** fewer, larger calls, often batched. Accuracy and faithfulness to the sources matter more than speed.

### Cost per tour hour

Assumptions: ~50 calls per hour (40 segments + 10 answers) and ~6,000 output tokens per hour (≈4,500 spoken words). **B (fact cards):** ~3k input tokens per call ≈ 150k input per hour. **A (raw sources):** ~10k input per call ≈ 500k input per hour, before any prompt caching.

Fast tier (live narration in B):

| Provider | Model | $ per 1M tokens, input / output | ≈ $ per tour hour (B) |
|---|---|---|---|
| Anthropic | Claude Haiku 5.5 | 0.10 / 0.50 | ~0.02 |
| OpenAI | GPT-5 nano | 0.05 / 0.40 | ~0.01 |
| OpenAI | GPT-5 mini | 0.25 / 2.00 | ~0.05 |
| Google | Gemini 3.1 Flash-Lite | 0.25 / 1.50 | ~0.05 |
| Google | Gemini Flash (newest) | ~0.75–1.50 / 3.75–9.00 (sources disagree) | ~0.13–0.28 |
| Open-weight, hosted (Groq, Together, Fireworks) | GPT-OSS 120B | 0.15 / 0.60 | ~0.03 |
| Open-weight, hosted | Llama 4 Scout | ~0.11–0.18 / 0.34–0.59 | ~0.02–0.03 |

Strong tier (fact cards; live narration in the prototype):

| Provider | Model | $ per 1M tokens, input / output | ≈ $ per tour hour (A, no caching) |
|---|---|---|---|
| Anthropic | Claude Sonnet 5.5 | 2 / 10 | ~1.05 |
| Anthropic | Claude Opus 5.5 | 4 / 20 | ~2.10 |
| Google | Gemini 3.1 Pro | 2 / 12 | ~1.10 |
| OpenAI | GPT-5.4 mini | 0.75 / 4.50 | ~0.40 |
| Mistral | Mistral Large 3 (open weights, EU company) | 0.50 / 1.50 | ~0.26 |
| Zhipu | GLM-5.3 (open weights) | ~1.20–1.40 / 4.40–6.00 | ~0.65–0.75 |

Batch APIs are ~50% off at Anthropic, OpenAI, and Google, which applies to card building. Prompt caching cuts repeated input sharply at all three. Every price here comes from third-party trackers as of Nov 2026, and they disagree in places. Check the providers' own pricing pages before relying on them.

**What this shows:** in B, every provider's fast tier costs cents per tour hour, against ~$0.45 for the voice. **Price doesn't decide the provider.** It only matters for A (the prototype) and for card building, where the spread is roughly 4–8×.

### What does decide it

| Criterion | Why it matters here | What we know |
|---|---|---|
| **Sticking to the sources** | The spec rules out made-up facts. Narration must use only the SOURCES block. | Unmeasured for our prompts. Has to be tested. |
| **Sounding good spoken aloud** | Natural, varied, at the right length for the word budget | Unmeasured. Has to be judged by listening. |
| **Time to first words** | Commentary must start before the place is passed | Varies by model, load, and region. Specialised hardware hosts (Groq, Cerebras) are typically fastest for open-weight models. Has to be measured from our server. |
| **Voice and speech from the same vendor** | One vendor, one bill, one integration | OpenAI and Google also sell text-to-speech and speech recognition (and speech-to-speech APIs). Anthropic doesn't sell TTS, so a Claude setup needs a second vendor for the voice. |
| **Current events (*Today* lens)** | Needs web search | Anthropic, OpenAI, and Google all offer built-in web search tools. Google's grounding with Google Search is the most direct fit. |
| **Data location and privacy** | Prompts include the listener's surroundings, though not their identity | All major providers offer EU data processing options. Mistral is EU-based. |
| **Stability** | Models get retired and prices change | Hosted open-weight models churn fastest (e.g. a DeepSeek model reported retired in Sep 2026). The big three give deprecation notice. |
| **Free tier for testing** | Lower prototype cost | Google keeps a free tier for Flash and Flash-Lite. |

Self-hosting an open-weight model on our own GPUs isn't worth it at our scale: hosted inference is already cents per hour.

### Recommendation

1. **Don't pick on paper. Measure.** Build a small eval: ~20 real segment plans (Lisbon walk, Porto, Sintra drive, a bus stretch), each with its SOURCES and word budget, run through 4–6 candidates. Score each on facts traceable to the sources, word-budget accuracy, how it sounds read aloud, time to first words, and cost. Candidates: Claude Haiku 5.5 and Sonnet 5.5, GPT-5 mini (or GPT-5.4 mini), Gemini 3.1 Flash-Lite and Flash, and GPT-OSS 120B or Llama on Groq. A run costs a few dollars.
2. **Make the provider swappable first.** Only `server/narrator.ts` calls the model. Put a small interface in front of it (stream text for a system + user prompt), so switching, or using one provider for live narration and another for cards, is a config change.
3. **Until then,** the prototype keeps Claude Sonnet 5.5, because it's already wired up. That's a default, not a decision.

## 15. Data storage

Earlier sections assumed Postgres with PostGIS plus object storage without comparing alternatives. This section lists the data we'll hold, compares storage architectures, and recommends one per stage.

### What we store

| # | Data | Shape and access pattern | Size (rough) | If it's lost |
|---|---|---|---|---|
| D1 | **Geo knowledge base**: places, named features, links to Wikidata, Wikipedia, and Overture | Read-heavy spatial queries: within a radius, along the road ahead, nearest. Bulk imports and periodic refreshes. | A few GB per continent (places and named features, not every road) | Rebuild from sources (hours) |
| D2 | **Source text**: Wikipedia extracts and articles, Wikidata facts, keyed by revision | Read by card building and the A path; refreshed when sources change | A few GB (geotagged articles only); raw dumps much larger | Rebuild from dumps |
| D3 | **Fact and area cards** (B) | Small structured documents (a few KB), per place and lens, versioned against source revisions, with verification status | A few GB per million places | Regenerate (costs LLM money) |
| D4 | **Audio library** (C) | Immutable audio files, read through a CDN; metadata (place, lens, length, voice) is a small table | ~1.3 TB per 100k fully covered places | Re-render (costs TTS money) |
| D5 | **Live sessions** | Small state per tour (covered places, recent segments, steering), written once per segment, gone after hours | Tiny | The tour loses its memory mid-walk |
| D6 | **Accounts and entitlements**: user, free-tour flag, passes, top-ups, purchase receipts | Relational, transactional, low volume, must be exactly right | Tiny | **Irreplaceable: money and trust** |
| D7 | **Listening-time ledger** | Append-only usage events (seconds listened per segment). Balance = sum. Must not double-count across reconnects or devices. | Small | **Irreplaceable: billing** |
| D8 | **Tour history and location traces** | Personal data. Needed for the recap and visited-places log (roadmap), debugging, and evals. | Small per user | Annoying, not critical |
| D9 | **Analytics, costs, logs** | Append-heavy product events, per-call LLM/TTS cost and latency, error logs; analytical queries | Grows fastest | Loss of insight |
| D10 | **Search for push-to-talk answers** | Find relevant facts for a question | Derived from D2/D3 | Rebuild |
| D11 | **On the phone**: settings, sign-in token, later offline region packs | Key-value; packs are read-only bundles of places, cards, and audio | KB; packs tens to hundreds of MB | Re-download |

Two observations shape the choice:
- **Recoverability splits the data in two.** D1–D4 and D10 are big and rebuildable from sources. D6–D7 are tiny and irreplaceable. They need different backup and change regimes, even if they sit on the same database server.
- **Retrieval for questions is geo-first.** A question on a walk is almost always about something nearby. Filtering by location narrows the candidates to ~20 places, and their cards fit straight into the prompt. Vector search is a later optimisation, not a requirement.

### Storage architectures compared

| | S1. Postgres-centric | S2. Specialised stores (polyglot) | S3. Edge / serverless-native | S4. Backend-as-a-service | S5. Pre-built static data files |
|---|---|---|---|---|---|
| What it is | One Postgres with PostGIS (geo), JSONB (cards), full-text and later pgvector (search), ordinary tables (accounts, ledger, sessions). Object storage for audio and dumps. | PostGIS for geo, a document database (MongoDB, DynamoDB) for cards, Redis/Valkey for sessions, a vector database (Qdrant, Pinecone), a warehouse (ClickHouse, BigQuery) for analytics | Cloudflare D1 (SQLite), KV, Durable Objects storage, Vectorize, R2; or Turso (libSQL) | Firebase / Firestore, or Supabase (Postgres plus auth, storage, functions) | The pipeline bakes places and cards into per-region tiles or SQLite files on object storage + CDN; the server and app read them directly |
| Geo queries | **Best in class** (PostGIS: radius, corridor, nearest, OSM import tools) | Best in class (PostGIS stays) | Weak: no PostGIS. Geohash or R-tree workarounds; geo still needs PostGIS elsewhere | Firestore: geohash only, no real spatial queries. Supabase: full PostGIS. | Pre-computed per tile; no ad-hoc queries |
| Transactions for money data | Yes, one database | Only within each store | Per database (SQLite) | Firestore: limited. Supabase: yes. | No; needs a database alongside |
| Systems to run | 1 database + object storage | 4–6 | Several, but managed | 1 platform | Build pipeline + CDN, plus a database for D5–D9 |
| Cost at the start | ~$25–300/month | Several times S1 | Very low | Free tier, then usage-based | Very low to serve |
| Scaling limits | Analytics at large volume; vector search beyond tens of millions of items; geo imports competing with app traffic (fix: separate instances) | Scales per store | Database size caps (e.g. ~10 GB per D1 database), runtime limits | Firestore query model; Supabase as S1 | Freshness: every change needs a re-bake |
| Lock-in | Low (standard Postgres, available everywhere) | Medium | High | Firestore: high. Supabase: low (it's Postgres). | Low |
| Fit for a one-person team | **High** | Low | Medium | Firestore: poor (no geo). Supabase: high. | High for read-only content |

Ruled out: **Firestore as the main store** (no real spatial queries, awkward for the ledger); **a dedicated vector database at launch** (geo-first retrieval makes it unnecessary); **a warehouse at launch** (Postgres tables or an analytics service cover early volumes); **Google Places or similar as a store** (terms forbid caching, §3).

### Per data kind: options and recommendation

| Data | Options | Recommendation |
|---|---|---|
| D1 Geo | PostGIS; MongoDB geospatial; Elasticsearch/OpenSearch geo; SQLite + R-tree/SpatiaLite; DuckDB spatial (batch only) | **PostGIS**, imported with osm2pgsql plus Overture/Wikidata loaders. DuckDB spatial is handy in the pipeline for crunching Overture files before loading. |
| D2 Source text | Postgres tables; object storage (raw dumps, extracts as files) | **Raw dumps in object storage; parsed extracts in Postgres**, keyed by page and revision so cards know when they're stale |
| D3 Cards | Postgres JSONB; document database; versioned JSON files in object storage | **Postgres JSONB**, with columns for place, lens, source revisions, model, verification status, and version |
| D4 Audio | Cloudflare R2; S3 + CloudFront; Google Cloud Storage; Bunny | **R2** (free egress); metadata table in Postgres |
| D5 Sessions | In memory (current); Postgres row per session; Redis/Valkey; Durable Objects (if edge, §11 H4) | **In memory, saved to Postgres after each segment**, so a restart or reconnect resumes the tour. Add Redis only if load demands it. |
| D6 Accounts and purchases | Postgres; RevenueCat as the purchase record; identity via Sign in with Apple/Google, Supabase Auth, Clerk, Firebase Auth | **RevenueCat as the record of purchases** (it validates App Store and Play receipts), mirrored into **Postgres** by webhook. Accounts start anonymous (device-bound), with Apple/Google sign-in added to move between devices. |
| D7 Listening ledger | Postgres append-only table; event stream (Kafka etc.) | **Postgres append-only table** with an idempotency key (session + segment number), so retries and reconnects can't double-count. Pass balance = allowance − sum. RevenueCat doesn't meter hours, so this is ours. |
| D8 History and traces | Store full traces; store visited place IDs only; keep nothing server-side | **Visited place IDs per tour, no raw traces by default.** That's enough for the recap and visited-places log. Raw traces only with opt-in (testing, recorded walks for regression), deleted after a fixed period (e.g. 30 days). EU region. |
| D9 Analytics, costs, logs | Postgres tables; PostHog (EU cloud or self-hosted); ClickHouse / BigQuery later; platform logs + Sentry | **PostHog (EU)** for product events; **a Postgres table for per-call LLM/TTS cost and latency** (needed to check margins per pass); platform logs + Sentry for errors. A warehouse only when volume demands it. |
| D10 Search | Geo filter only; Postgres full-text; pgvector; dedicated vector database | **Geo filter first.** Add Postgres full-text and **pgvector** for questions that reach beyond what's nearby ("what else did this architect build?"). |
| D11 On the phone | Key-value (MMKV / AsyncStorage) for settings; offline packs as SQLite, PMTiles/FlatGeobuf, or JSON bundles | **Key-value for settings; SQLite for offline packs** (places, cards, R-tree index) plus audio files. The planner can query it on the phone, and the same bundles can feed S5 later. |

### Recommendation by stage

- **Prototype (now): in memory**, as built. Everything resets on restart: sessions, and cached Wikipedia and OpenStreetMap results. Cheap optional improvement: a local SQLite file (Node's built-in `node:sqlite`) for the external-API cache and sessions, so restarts don't lose them and Overpass gets hit less. Not needed for field tests.
- **MVP (B): S1, Postgres-centric**, plus R2, RevenueCat, and PostHog. Two logical databases from day one:
  - **content** (D1–D3, D10): big, rebuildable, loaded by the pipeline. It can live on the rented server next to routing (§11 H3).
  - **app** (D5–D9): small, irreplaceable, on a managed Postgres with point-in-time backups.

  They can share one server at first and split when imports start competing with app traffic.
- **Scale and offline (C): add S5.** Bake hot regions into static SQLite or tile bundles on R2 behind a CDN. The same artifact serves fast lookups and offline downloads. Postgres stays the source of truth.

Revisit if: the full app goes edge-first (§11 H4), which pulls sessions toward Durable Objects; analytics outgrow Postgres and PostHog (add ClickHouse or BigQuery); or questions need broad semantic search at scale (consider a dedicated vector database).

## 16. Describing a location: the fallback ladder

**Rule:** talk about the most specific thing near the listener that we have grounded material for. If that thing has nothing (left) to say, climb one rung to something broader. Drop back down as soon as something more specific comes into range. Silence is a valid last rung, never padding or invention (spec UC-10).

### The ladders

On foot (walking, standing, sightseeing bus in town):

| Rung | Subject | Example (Lisbon) | Where the subject comes from | Where the material comes from |
|---|---|---|---|---|
| **L0** | The thing in view: building, monument, church, statue, plaque | Igreja da Madalena | Planner candidates (§2, `planner.ts`) | Wikipedia, Wikidata, heritage registers, OSM tags (`data-sources.md`) |
| **L1** | The street, square, bridge, or park the listener is on | Rua da Madalena | The named way under the listener (nearest named street within ~25 m, aligned with heading; Nominatim's `road` in the prototype) | The street's own article or Wikidata item, its namesake (`name:etymology:wikidata`), city street-name databases. Also **aggregates** of buildings along it (below). |
| **L2** | The ensemble or quarter: a historic zone, planned district, square with its surroundings | Baixa Pombalina (the grid rebuilt after 1755) | Heritage zones and ensembles (OSM, registers), `place=square`, historic district polygons | Ensemble articles, register text, aggregates |
| **L3** | Neighbourhood or parish | Santa Maria Maior | Admin boundaries (OSM `admin_level`, mapped per country), Nominatim `neighbourhood` / `suburb` | Wikipedia (local language), Wikivoyage, area cards (B) |
| **L4** | Town or city | Lisbon | Admin boundaries | Same as L3 |
| **L5** | Region | Lisbon region / Estremadura | Admin boundaries, historical provinces, wine regions | Same |
| **L6** | Country and big themes | Portugal: the Age of Discoveries, azulejos, the 1755 earthquake | Country, plus themes linked to the places already covered | Wikipedia, area cards |
| **→** | Preview of the next interesting place | "In about four minutes you'll reach the cathedral" | Planner candidates beyond range | — |
| **∅** | Silence | | | |

By car (and buses between towns):

| Rung | Subject | Example (Sintra → Cabo da Roca) | Where the subject comes from | Where the material comes from |
|---|---|---|---|---|
| **D0** | Landmark in view, near or far | Palácio da Pena on the ridge | Planner candidates, plus terrain visibility for distant ones (`data-sources.md`, Copernicus DEM) | As L0 |
| **D1** | The road itself | EN247, or a stretch that follows a Roman road or the Camino | The matched road, its OSM route relations, and stretches running along Itiner-e Roman roads | Road articles, route articles, Itiner-e |
| **D2** | Landscape in view | Serra de Sintra, the Atlantic cliffs, a protected area | Named natural features plus visibility; land cover under and ahead of the car; protected areas | Wikipedia, Natura 2000, land cover classes, geology |
| **D3** | Settlement being passed | Colares | Admin boundaries, `place=*` nodes | As L3/L4 |
| **D4** | Region | Sintra-Cascais Natural Park, the Colares wine region | Regions, parks, wine regions, historical provinces | As L5 |
| **D5** | Country and big themes | Portuguese agriculture, the Atlantic climate | As L6 | As L6 |
| **→ / ∅** | Preview, then silence | | | |

### How the planner climbs

1. **Mode picks the ladder and the starting rung.**
   - Walking and standing: L0–L6.
   - Sightseeing bus in town: L0–L6 too, with vehicle timing.
   - Slow vehicle: L0, then L2 upwards. A street is passed too quickly to tell its story, except when stuck in traffic.
   - Fast vehicle: D0–D5.
2. **A rung qualifies only if it has enough unused material for the time budget.** Rule of thumb: at least **3× as many source words as words to be spoken**, after removing what this session has already covered. This stops the model padding a thin source into a long segment. In B, the same check counts unused facts on the fact card.
3. **Pick the lowest qualifying rung.** Ties go to lens fit: a rung with material but no fit to the listener's lenses can be skipped for the next rung up that fits, but only one rung. The *Nature & Landscape* lens, for example, prefers D2 over D3; *Famous People* likes the street's namesake (L1).
4. **Higher rungs come in chapters.** A neighbourhood, town, or region has more to tell than one segment: history, today, people, food, legends, chosen by lens. The session tracks which chapters of which subject have been told. A long walk through one quarter then gets several different L2/L3 segments, not one "area story" followed by silence. This replaces the prototype's "area once" rule.
5. **Fit the rung to the gap.** Short gaps (under ~15 s) take a small item: a quick fact about the street, or silence. Long gaps take a chapter from a higher rung.
6. **Limit generic content.** On foot, the guide climbs to L5/L6 at most every 15–20 minutes. Country-level talk on a city walk feels like filler. The listener's frequency setting (spec UC-10) can turn the higher rungs off altogether.
7. **Drop back down immediately.** When a lower-rung subject with material comes into range (a new building, a new street), it takes over at the next sentence break.
8. **Boundaries get a bridge.** Crossing into a new L2/L3 area earns one short line ("We've just crossed into Alfama"), and that area's chapters become available.
9. **Say what scope we're on, sometimes.** When the guide climbs because a building has no record, it can say so ("Not much is recorded about this house, but the street…"). That's honest and builds trust. Use it occasionally, not every time.

### Aggregates: grounded material for things with no article

Many buildings have no article but do have tags or register entries: construction date, style, architect, heritage status, former use. One such building isn't a story, but twenty of them along a street are: "most houses along here went up between 1880 and 1910, several by the same architect." These **aggregates** are computed by code from the data, so they stay grounded. They give L1 and L2 material even where no one has written about the street. Sources: OSM `start_date` / `architect` / `heritage` tags, heritage registers, national building registries (`data-sources.md` §5).

### Where it lives in the code

- **Gather (I/O):** `resolveLadder(position, heading, mode)` returns the subjects on each rung, with their available material and Wikidata IDs, using the same cached sources as places (`pois.ts`, Nominatim, Overpass).
- **Decide (pure, unit-tested):** the planner takes the ladder, session coverage (subject + chapter), budget, and lenses, and returns a plan. The prototype's `area` plan becomes `scope { rung, subject, chapter, budgetSec }`.
- **Session:** coverage tracked per subject and chapter, not just per place.
- **Debug panel:** shows the whole ladder: each rung's subject, how much material it has, and why the chosen rung won.

### By stage

- **Prototype (A):** L0 as now. L1 from Nominatim's road name plus OSM etymology and street Wikidata/Wikipedia tags. L3–L6 from Nominatim's address parts plus Wikipedia search by name. Chapters by lens. No aggregates yet.
- **B:** street cards (L1), area cards per admin unit with chapters (L2–L5), aggregates computed in the pipeline, terrain visibility and road history for D0–D2.
- **Later: local news as a filler chapter.** A *local news* chapter at town level (L4 / D3), offered when the ladder has nothing else unused and before the preview and silence rungs. At most one item per town per tour, cached per town per day. Filters: no crime, accidents, or tragedy; no named private individuals; visitor-relevant items first (festivals, openings, works, local achievements). Short summaries in our own words, with the outlet named. Sources in `data-sources.md` §3 (Current information).
- **C:** higher-rung chapters are the most reusable content there is: every listener in a quarter hears the same area chapters. That makes them the first candidates for pre-rendered audio.

## 17. Decision log

| # | Topic | Decision | Alternatives considered | Status |
|---|---|---|---|---|
| 1 | Architecture path | A → B → C (§8): live prototype, hybrid fact cards at launch, audio caching in hot spots | A only (too expensive per hour, facts unchecked); B only (no route to an affordable premium voice or offline); C from the start (too complex, less personal) | Decided |
| 2 | Voice at launch | Standard neural tier, ~$0.45 per tour hour | Basic cloud (~$0.11/hr, may sound cheap); HD (~$0.80/hr); premium expressive (~$1.10–2.70/hr). Premium voice becomes a later paid add-on (`monetization.md`). | Decided |
| 3 | Geography | No fixed launch region. Test wherever we are, plus simulated tours anywhere (§9). | One test city first; worldwide content pre-built from day one | Decided |
| 4 | Places data | OSM, Wikidata, Wikipedia, Wikivoyage, Overture/Foursquare open places (§3) | Google Places: $1–3 per tour hour, and caching isn't allowed | Decided |
| 4a | Data sources beyond the backbone | Open. Recommended order: Wikidata facts, OSM street etymology, scenery features, and Wikivoyage first; then green-licensed national registers, land cover, terrain, and Itiner-e per country (`data-sources.md` §7) | Red-licensed sources (SIPA without permission, HMdb, WDPA, Gallica commercial); Atlas Obscura, Tripadvisor, guidebook publishers (licensing deals, later) | Open |
| 5 | Planning vs wording | Deterministic planner decides what, when, and for how long; the LLM only writes the words (§2) | Letting the LLM decide timing | Decided |
| 6 | Speech recognition | On-device by default, cloud fallback for place names (§2) | Cloud only | Decided |
| 7 | Where the logic runs | Orchestration on the server; the phone does the sensing (§2) | Orchestration on the device (API keys on the phone; logic changes need app releases) | Decided |
| 8 | Front end, prototype | Mobile web app (§10, §12) | Expo app | Decided |
| 9 | Front end, full app | Leading candidate: React Native + Expo (§10) | Web app (no GPS or audio with the screen locked); Capacitor; fully native; Flutter | Deferred |
| 9a | Running inside an AI assistant (ChatGPT app, Claude connector, Gemini) as the product | Rejected as the main product: no continuous GPS, no unprompted speech, no control over timing or grounding (§10). Kept for later as a secondary "Ask mode" channel built on the B data layer as an MCP tool server. | Companion GPS app + assistant (still needs a native app); ask-and-answer only | Rejected (main product); later (secondary channel) |
| 10 | Prototype voice | Browser built-in (§12) | OpenAI TTS; Google Cloud TTS | Decided |
| 11 | Hosting, prototype | Laptop + Cloudflare quick tunnel (§11) | Named tunnel; PaaS container; serverless | Decided |
| 12 | Hosting, production | Leading candidate: PaaS + managed Postgres + R2, with routing and batch jobs on a rented server (§11) | Hyperscaler; rented servers only; edge-first | Deferred |
| 13 | Monetization | One free tour, then hour-based passes and top-ups (`monetization.md`) | Passes only; freemium subscription; ads + paid; pay-as-you-go | Decided |
| 14 | Languages, prototype | TypeScript on the server (Node 24, no build); plain JavaScript in the browser (§12) | — (chosen to get the prototype running, not discussed) | In place |
| 15 | Languages, full system | Leading candidate: TypeScript for app, server, shared core, and pipeline; Swift/Kotlin only for native modules; Python allowed for heavy data processing (§13) | Python server; Go or Elixir server; native or Flutter app (Swift/Kotlin, Dart) | Open |
| 16 | LLM provider | Open. Prototype default: Claude Sonnet 5.5 (already wired up). Next: make the provider swappable, then pick by a measured eval (§14). | Claude (Haiku, Sonnet, Opus); OpenAI (GPT-5 nano/mini, GPT-5.4 mini); Google (Gemini Flash-Lite, Flash, Pro); hosted open-weight models (GPT-OSS, Llama, Mistral, GLM); self-hosted open weights (not worth it at our scale) | Open |
| 17 | Data storage, prototype | In memory: sessions and external-API caches reset on restart (§12, §15). Optional: a local SQLite file. | — (chosen to get the prototype running) | In place |
| 18 | Data storage, full system | Leading candidate: Postgres-centric (PostGIS, JSONB, later pgvector), split into a rebuildable content database and an irreplaceable app database; R2 for audio; RevenueCat as the purchase record; PostHog (EU) for analytics; append-only listening ledger; no raw location traces by default. Static region bundles added for scale and offline (§15). | Specialised stores (document DB, Redis, vector DB, warehouse); edge-native (D1, KV, Durable Objects); Firestore (no spatial queries); static files only | Open |
| 19 | Describing a location when there's little data | Fallback ladder (§16): on foot building → street → ensemble/quarter → neighbourhood → town → region → country → preview → silence; by car landmark → road → landscape → settlement → region → country. A rung needs 3× more source words than spoken words. Higher rungs told in chapters. Aggregates from building data. | One area story then silence (prototype); letting the model fill gaps freely (risks invented facts) | Decided, to implement |
| 20 | Market focus | Europe first. Areas ranked by demand × (6 − existing coverage) × fit × data readiness; first mapping and ongoing research approach in `market-areas.md`. The app still works anywhere. | Fixed launch city; global from day one | Decided (Europe); mapping draft |

Product decisions (controls, cards, lenses, languages, scope) are logged in `spec.md` §11.
