# Audio Tour Guide: Product Spec, revision 2

Status: rev2 draft v0.1, 2026-11-15. This is the current spec. Rev1 (`../rev1/`) is kept as history and as the source of the analysis that still applies (data sources, market areas). What changed and why is in §1 and the decision log (§8). This document covers *what* the app does for the user; how it's built is in `architecture.md`.

## 1. What changed from rev1

Rev1 planned one product built in three technical steps: live generation everywhere (A), then shared fact cards with live narration (B), then cached audio (C). Every listener got commentary written for them on the spot, wherever they were.

Rev2 splits the work into two phases with different products:

| | Prototype | Rollout |
|---|---|---|
| What it is | A web page on your phone that talks you through the street and area you're walking through, written live | A catalog of walking routes in selected cities, with narration written, checked, and recorded ahead of time |
| Narration | Written live by an LLM for where you are | Pre-recorded audio. **No LLM at run time.** |
| Where | Anywhere | Only on our routes, in our cities |
| Who | Us, for testing | The public |
| Purpose | Learn what good narration sounds like on foot, and build the prompts the route pipeline will reuse | The product |

Why: the rollout gets checked content (every script reviewed before anyone hears it), studio-quality voice, offline use, and near-zero running cost per listener. In return it gives up spontaneity: the guide only works on routes we've made. The live prototype stays useful as the place where we learn how to write narration, since the same prompts and source handling will produce the route scripts.

## 2. Prototype

### 2.1 Scope

A web page, opened on the phone, that talks you through the street and area you're walking through. Simple live narration only. More can be added to the prototype later.

**In:**
- Walking. (Speeds of a bus or car aren't tuned or tested.)
- Live narration about what's around you: the building in front of you, the street, the quarter, the town (rev1 fallback ladder, `../rev1/architecture.md` §16).
- One lens at a time, **History** by default (§4).
- Place cards on screen for the places the guide mentions or is near. Tapping one makes it the next thing the guide talks about.
- Pause / Continue, Skip, Stop.
- Simulated walks for testing at home.

**Out (for now):**
- Push-to-talk questions and voice steering. Rev1's prototype has them; the phone version doesn't carry them over. They may come back later.
- Routes, pre-recorded audio, offline use.
- Screen-off use. Test with the screen on: a web page can't keep reading GPS or speaking with the screen locked, especially on iPhone.
- Other users. The page is for us; it's protected by an access password.

### 2.2 Use cases

**P-1: Start.** Open the page, allow location, tap **Start** (lens preset to History, changeable). Within a few seconds the guide gives a short orientation: where you are and what's around you.

**P-2: Listen while walking.** The guide talks about the most specific thing near you that it has material for: a building, then the street, the quarter, the town. It times mentions so they land while the place is in view, leaves gaps rather than padding, and doesn't repeat itself. It never makes things up; when it has nothing, it stays quiet.

**P-3: Tap a place card.** Cards show places the guide has mentioned and places nearby. Tapping one makes it the next segment, after the current sentence finishes.

**P-4: Control playback.** Pause stops speech; Continue picks up with what's relevant where you are now, not where you paused. Skip drops the current segment. Stop ends the walk.

**P-5: Simulated walk.** Pick a start and end on a map. The page then walks the route at walking pace (with a speed multiplier), and the guide behaves exactly as on a real walk.

**P-6: Lose the connection.** The guide finishes the sentence it has, says it's lost connection, and resumes when the connection is back.

## 3. Rollout

### 3.1 Concepts

- **City:** a place where we offer routes. Chosen from `../rev1/market-areas.md` (Portugal first).
- **Route:** a walking path through a city that we designed, with one lens. Typically 1–2.5 hours including stops, 2–5 km, 8–15 stops.
- **Stop:** a point on the route where you're meant to pause and look: a church, a square, a viewpoint.
- **Stretch:** the part of the route between two stops.
- **Chapter:** one piece of narration, recorded ahead of time, tied to a place on the route:
  - **Stop chapters** play when you arrive at a stop.
  - **Stretch chapters** play while you walk a stretch: the streets you're on, the quarter, the story that links the stops.
  - **Intro and outro** play at the start and end.
- **Digression:** a short recorded piece (about 30–90 seconds) about a place near the route that isn't a stop. Each has a **POI button** that shows while you're near it.
- **Route pack:** everything a route needs (path, map area, audio, texts), downloaded to the phone before the walk.

### 3.2 Lenses

**One route, one lens.** A route tells one kind of story from start to end.

**Default: History,** in the style of a typical human-led walking tour: how the place came to be, what happened here, who lived here, with architecture, legends, and everyday life woven in where they serve the story. That's how good city guides tell it, and it's what most visitors expect.

Other lenses come later as **separate routes** in the same city (an architecture walk, a food walk, a literary walk), not as a switch on an existing route. The rev1 lens list (`../rev1/spec.md` §5) is the pool to choose from.

### 3.3 Use cases

**R-1: Browse and choose a route.** The user opens the app, picks a city (or it's suggested from their location), and sees its routes: title, lens, length, duration, start point on a map, a short description, and a sample to listen to.

**R-2: Download.** Before setting off, the user downloads the route pack (on Wi-Fi if they like). The walk then works without a connection.

**R-3: Get to the start.** The app shows the start on the map and how far it is. Getting there is up to the user (or their maps app); we don't do turn-by-turn navigation. They can also join at any stop.

**R-4: Walk the route.** With the phone in a pocket and the screen off:
- The route line and your position show on the map when you look.
- The app follows your progress along the route, and plays each chapter at its place: stop chapters on arrival, stretch chapters as you walk the stretch.
- Directions are part of the narration ("at the end of this street, turn left towards the river"), written into the script.
- Walking pace doesn't matter. If you walk past a stretch before its chapter starts, that chapter is skipped (it was about where you no longer are). A chapter that has started plays to its end. Stop chapters always play when you reach the stop, and can be replayed from the stop's card.
- If you stand still, nothing new starts until you move on, apart from the stop chapter where you are.

**R-5: Take a digression.** As you walk, POI buttons appear for places near you that have a digression. Tap one:
1. The route narration pauses at the end of the current sentence.
2. The digression plays.
3. A short line ("Back to our route.") leads back, and the route narration resumes from the sentence where it paused.

If you walk over to look at the place, the app doesn't warn you that you've left the route while you're near it. Digressions you've heard are marked. Buttons you don't tap simply disappear as you walk on.

**R-6: Leave the route.** If you're more than about 40 m from the route (and not near a digression you just tapped), narration pauses after the current sentence and a short recorded line says you've left the route and the map shows the way back. When you're back on the route, it resumes. If you rejoin further along, chapters you skipped are not played (you can play them from their stop cards).

**R-7: Control playback.** Pause / Continue, Skip (to the next chapter), Replay (the current chapter from the start), and Stop. They work from the lock screen and the headset buttons.

**R-8: Pause the walk and come back later.** Progress is saved. Opening the route again offers to continue where you left off, or start over.

**R-9: Sources.** Each route lists its sources and credits (Wikipedia articles, registers, photos), as the licences require.

### 3.4 Scenario: an afternoon in Alfama

Maria and Tom are in Lisbon. At the guesthouse they download *Alfama: from Moorish town to fado*, a 90-minute History route. They walk to the start at the Sé. Maria puts the phone in her pocket.

The intro plays as they arrive: how the cathedral was built on the site of the mosque after 1147, and why it looks like a fortress. As they climb towards Santa Luzia, a stretch chapter tells how Alfama survived the 1755 earthquake and why its streets still follow the medieval tangle. *"At the top of these steps, go left onto the terrace."* A button for *Igreja de Santa Luzia* appears; Tom taps it, hears a minute about the azulejo panels on its wall, and the guide says "Back to our route" and carries on about the view.

They stop for coffee for twenty minutes. Nothing plays. When they move on, the next stretch picks up. Further down, they wander off into a side street; the guide pauses and says they've left the route. They look at the map, find their way back, and it resumes. At the end, the outro ties the walk together at the fado museum.

## 4. Cross-cutting expectations

- **Factual honesty.** Prototype: grounded in sources fetched live; no invented facts. Rollout: every script is checked against its sources and reviewed by a person before it's published.
- **Audio first, buttons for control.** No voice commands in either phase for now.
- **Language:** English first. Order of further languages from `../rev1/market-areas.md` §4.
- **Rollout works offline** once a route is downloaded, and runs with the screen locked and the phone in a pocket.
- **Battery:** a 2–3 hour walk on one charge without trouble.

## 5. Out of scope for the rollout (first release)

- Any LLM at run time: no questions, no voice steering, no live narration.
- Spontaneous touring anywhere (the rev1 core idea, now the prototype only).
- Driving routes, bus routes, train rides.
- More than one lens per route; switching lenses mid-route.
- User-made routes, social features, reviews.
- Turn-by-turn navigation, booking, opening hours.

## 6. Roadmap (later)

- **More lenses** as separate routes per city.
- **Driving routes and sightseeing-bus routes** (rev1 ideas, as pre-made routes).
- **More languages.**
- **More cities** following the research loop in `../rev1/market-areas.md` §5.
- **Live features as an add-on:** questions about what's around you, or live narration off our routes, if users want them and the cost works.
- **Ask mode inside AI assistants** (rev1 roadmap).
- **Prototype additions** when useful: push-to-talk, playing a hand-made route.

## 7. Open questions

1. **Pricing for the rollout.** The rev1 model (passes with listening hours) was designed around per-hour LLM and voice costs that no longer exist. Options: per route, per city, a subscription for all routes, or a free first route plus any of these. To decide before launch.
2. **How many routes per city at launch,** and which cities first.
3. **Who reviews scripts,** and how much editing a route needs.
4. **The voice:** which premium voice, and whether one voice is used for all routes.
5. **Joining mid-route and walking a route backwards:** joining at a stop is in (R-3). Reverse direction would need separate stretch chapters, so it's out for now.

## 8. Decisions and alternatives considered

| # | Topic | Decision | Alternatives considered |
|---|---|---|---|
| R2-1 | Phases | Two phases: a live prototype, then a rollout built on pre-made routes | Rev1's single product grown A → B → C |
| R2-2 | Prototype scope | Simple live narration while walking, place cards, playback controls, simulated walks | Keeping push-to-talk and voice steering (dropped for now); also playing a hand-made route (later) |
| R2-3 | Rollout narration | Written, checked, and recorded ahead of time; no LLM at run time | Live narration (rev1 A); live narration over shared fact cards (rev1 B); cached audio with live joins and fallback (rev1 C) |
| R2-4 | Rollout coverage | Our routes in selected cities only, walking first | Spontaneous touring anywhere (rev1); driving and bus routes at launch (roadmap) |
| R2-5 | Lenses | One lens per route; History by default, in the style of a human-led walking tour | Several lenses per route, chosen by the listener (rev1); *Surprise me* as the default (rev1) |
| R2-6 | Places off the route | POI buttons with short pre-recorded digressions; afterwards the route resumes where it paused | No digressions; free exploration with live narration (needs a run-time LLM) |
| R2-7 | Walking pace | Chapters tied to places on the route; passed stretch chapters are skipped, started chapters finish, stop chapters always play | Time-based playback (breaks for slow or fast walkers); playing every chapter in order regardless of position |
| R2-8 | Leaving the route | Pause after ~40 m off the route with a recorded line; resume on return; no warning near a tapped digression | Turn-by-turn guidance back to the route; ignoring deviations |
| R2-9 | Directions | Written into the script; the map shows the line | Separate turn-by-turn navigation (out of scope) |
| R2-10 | Pricing | Rev1 hour-based passes withdrawn; new model open (§7) | Keeping the rev1 passes |
| R2-11 | Screen layout | A full-screen map with a bottom panel in three positions: a strip (title and Play), collapsed while walking (photo, name, where it is, the sentence being spoken, topic buttons with photos) and pulled up (big photo, the whole narration with the current sentence highlighted, topics, replay / skip / stop). Dragging follows the finger and snaps. The place being talked about is labelled and outlined on the map; areas (district, town) are never outlined. Tapping a topic button switches to it at once; tapping a place on the map shows a small card, and tapping its name switches to it. Photos open full screen. | A: map above, story below; B: photo first with a mini map; D: tabs switching Map / Photo / Story (UI canvas); topic taps waiting for the current part to finish |
| R2-12 | Walks on the start screen | Four buttons, one lens each: **Historic walk** (default, first), **Famous people walk**, **Food & drink walk** (past and present: trade, cellars, cafés, local dishes; never invented places, hours or prices) and **Photo walk** (where to stand, what to frame, light; a line of history for context). The lens steers which places are picked (weighted strongly) and how they're told; a food walk also looks up the local cuisine for area stories. | Architecture walk and Legends walk (too close to the historic walk); Art & culture, Film & music, Green, Local life (Art & culture as the runner-up for the fourth) |
| R2-13 | Name and logo | **Chatty Joe** (home screen, browser tab, start screen; the guide is "Joe" in the app's text). Logo: a smiling speech bubble with curly yellow hair and a tilted pink cap on the app's blue (logo canvas option G, pink). | "Guide" (working name); logo options A–F and H on the logo canvas (cap, headphones, map pin, speech bubble, sound waves, minimal face, backwards cap) |

Technical decisions are in `architecture.md` §5.
