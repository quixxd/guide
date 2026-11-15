# Spec revision 2

Current revision, started 2026-11-15. Revision 1 (`../rev1/`) is kept as history and is not edited further.

**The change in one line:** a live prototype on the phone first, then a rollout built on a catalog of pre-made walking routes with recorded narration and no LLM at run time.

| Document | What it covers |
|---|---|
| `spec.md` | The two phases, prototype and rollout use cases, the route model (stops, stretches, chapters, digressions), lenses, product decisions (§8) |
| `architecture.md` | Prototype on the phone with a PHP key relay on HoboHost; rollout content pipeline, route packs, static delivery, the app; what rev1 work carries over; decision log (§5) |
| `topics-later.md` | Aspects not yet discussed, updated for rev2 |

Rev1 documents that still apply unchanged and are referenced from here:

| Document | Used for |
|---|---|
| `../rev1/data-sources.md` | Sources and licences for writing route scripts and prototype narration |
| `../rev1/market-areas.md` | Choosing cities and routes; language order |
| `../rev1/architecture.md` §4, §9, §10, §14, §16 | Voice tiers, simulated tours, front-end options, LLM providers, the fallback ladder |

Rev1's `monetization.md` (hour-based passes) no longer fits and is withdrawn; rollout pricing is open (`spec.md` §7).
