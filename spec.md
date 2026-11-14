# Audio Tour Guide: Use Cases & User Scenarios

Status: draft v0.4, written for discussion. Decisions taken so far, with the alternatives considered, are in §11. This covers *what* the app does for the user, not how it is built.

## 1. Vision

A personal tour guide on your phone for when you're out on foot or on the road, usually on holiday. You start it wherever you are, and it works out where you are, which way you're heading, what's around you, and what's coming up. Then it talks you through the place: its history, what it is today, the landmarks and sights you're passing, and good places to stop along the way. The commentary keeps pace with you.

**What you hear is audio. How you control it is buttons.** Pause, continue, and stop are always on screen. To ask a question or say how you want the commentary to change, you hold a push-to-talk button. The places and topics the guide is talking about appear on screen as tappable topics, so one tap steers the guide in that direction.

## 2. Users and contexts

| Context | Typical speed | What matters |
|---|---|---|
| **Walking** (city, old town, village, trail) | 3–6 km/h | Details: individual buildings, squares, plaques, stories behind doors. Time to go deep. |
| **Sightseeing bus** (double-decker, hop-on-hop-off) | 0–30 km/h, stop-and-go | A raised view from the top deck. Many sights close together, passed slowly. The user has picked this app over the bus's own generic commentary, so it has to be more personal and better timed. |
| **Driving** (driver) | 30–130 km/h | Bigger picture: towns, regions, landscape, long story arcs. Announce things *before* they arrive. The driver should almost never need to touch the screen. |
| **Riding as passenger** (car, taxi, tram, train) | any | Like driving, but touching the screen is fine, so there's more steering and more questions. |
| **Stationary** (viewpoint, café, bench, traffic jam) | 0 | A chance for a deeper dive into what's in view, or a pause. |

The primary user is a holidaymaker in an unfamiliar place, alone or with companions who share the audio (headphones, phone speaker, or car audio).

## 3. Core concepts

- **Tour session**: one continuous run of the guide, from start until the user stops it.
- **Position context**: where the user is, which way they're moving, how fast, and how they're travelling (walking, bus, car), all inferred continuously from the phone. The user doesn't enter a destination.
- **Surroundings**: what is around the user *now*: the street, district, town, landscape, and points of interest (POIs) in view or nearby.
- **Horizon**: what is *coming*: POIs and places ahead along the likely path. How far ahead it reaches depends on speed (a few hundred metres on foot, tens of kilometres by car).
- **POI**: any place worth mentioning: landmarks, buildings, monuments, museums, viewpoints, natural features, and also practical places like restaurants, cafés, markets, and shops worth a stop.
- **Lens**: the angle the commentary takes (history, today, art, and so on; see §5). You pick lenses at start and can change them any time.
- **Narration segment**: one unit of spoken commentary about a place, POI, or theme. Segments are sized to fit the time available before the next relevant thing.
- **Topic card**: an on-screen item for a POI or topic the guide is currently talking about or has just mentioned. Tapping it steers the guide toward that topic.
- **Push-to-talk (PTT)**: the button you hold to speak to the guide. The app only listens while it's held.

## 4. Main screen

The main screen during a tour always shows:

1. **Playback controls**, always visible and large enough to hit without looking closely:
   - **Pause / Continue** (one toggle)
   - **Stop** (end the tour)
   - The play/pause button on the headset or car audio also works as Pause / Continue.
2. **Push-to-talk button**: large and easy to reach. Hold it to ask or steer, release to send.
3. **Topic cards**: the POI or topic being talked about now, plus up to 5 recent ones. Tapping one steers the guide (UC-7).
4. **Active lenses**: shown compactly and tappable to change (UC-8).

Secondary controls (**skip** the current segment, **replay** the last segment) are within reach but less prominent. A map, a transcript, and settings are optional extras, not the main experience.

## 5. Lenses

At tour start the user picks one or more lenses, or leaves the default:

| Lens | Covers |
|---|---|
| **Surprise me** *(default)* | A balanced mix, leaning on whatever is most remarkable about the place |
| **History** | How the place came to be, eras, events, what happened here |
| **Today** | What the place is like now: daily life, what's going on, the vibe |
| **Architecture & Art** | Buildings and styles, artworks, artists, design |
| **People & Society** | How people live and lived, communities, traditions, social issues |
| **Economy & Industry** | What the place lives on: trade, work, wealth and poverty |
| **Politics & Power** | Who rules and ruled, conflicts, borders, current politics |
| **Nature & Landscape** | Geography, geology, climate, plants and animals |
| **Food & Drink** | Local cuisine and produce, and notable places to eat and drink along the way |
| **Culture & Legends** | Myths, folklore, literature, film, music, festivals |
| **Religion & Belief** | Faiths and their places of worship, religious history, rituals, pilgrimages, how belief shapes the place |
| **Famous People** | Notable people who were born, lived, or worked here |
| **Curiosities** | Odd facts, little-known stories, trivia |

Tone and depth ("short and fun", "kid-friendly", "in-depth") are separate from lenses and can be set by voice (UC-8).

## 6. Use cases

### UC-1: Start a tour

**Trigger:** User opens the app wherever they are.

1. The app determines the user's position and, if possible, direction and speed.
2. The app shows the lenses (§5) as tappable choices. The user taps one or more and presses **Start**.
   - Pressing **Start** without choosing uses *Surprise me*.
   - A returning user sees **Start with last settings** as a one-tap option.
3. The app opens with a short spoken orientation: where you are, what this place is in one or two sentences, and what's coming up.
4. Continuous narration begins (UC-3), and the main screen (§4) is shown.

**Notes**
- Starting must take seconds. A first-time user should be listening within three taps.
- If the user is standing still, the app can't tell their direction yet. It starts with what's around them and picks up the direction once they move.

### UC-2: Work out where the user is going

There's no destination input. The app estimates the user's likely path from:
- Direction and speed of movement.
- The road or street being followed. On a road, the path ahead is nearly certain. In a city walk it's only probable.

When the path is uncertain (city walking, a junction ahead), the horizon covers several possible directions and leans toward nearby things rather than far-ahead ones. When the user changes direction (turns off, makes a U-turn), the app updates the horizon and drops queued commentary that no longer applies.

### UC-3: Continuous, pace-aware narration

This is the heart of the app. While the user moves, the app picks what to talk about and when:

- **Pass-by timing:** commentary about a POI lands while it's in view or just before, never after you're long past it.
- **Look-ahead announcements:** at speed, the app gives a heads-up early enough ("in about two kilometres, on your left, you'll see…").
- **Segment sizing:** how long a segment runs depends on the time until the next relevant thing. On foot between two close landmarks: short. On a 20-minute stretch of motorway: a longer story about the region.
- **Priority over sequence:** if something notable is about to come into view, the app wraps up or pauses the current story, covers the landmark, then resumes the story or drops it.
- **Lens-weighted selection:** among everything nearby, the app prefers what fits the active lens(es), and tells it from that angle. The same cathedral is told differently under *Architecture & Art* than under *Politics & Power*.
- **Practical POIs:** restaurants, cafés, markets, and similar places get a brief mention when they're notable or fit the lenses ("on the corner is a bakery that's been making pastéis since 1837"). Mentions only: no reviews, bookings, or opening hours lookups.
- **Topic cards follow along:** each POI or topic the guide starts talking about appears as a topic card (§4, UC-7).
- **Silence is allowed:** the app doesn't fill every second. It leaves natural gaps, and in empty stretches it goes quiet or switches to a wider theme rather than padding (UC-10).
- **No repetition:** the app remembers what it has said this session and doesn't repeat itself, e.g. on the way back along the same street. It can refer back instead ("remember the merchant family I mentioned? This was their warehouse.").

### UC-4: Adapt to changes in pace and mode

The app notices when the user speeds up, slows down, stops, or switches mode, and adjusts:

- **Walking → stopped:** a chance to go deeper on what's in view, or offer to.
- **Stopped for a long time** (café, lunch): narration fades into a pause. It resumes when the user moves again or presses **Continue**.
- **Walking → in a vehicle** (bus, tram, car): switches to the right scale of commentary and horizon for that vehicle.
- **Stop-and-go** (sightseeing bus, city traffic): uses the slow stretches for depth, and times mentions to the sights it creeps past.
- **Driving → traffic jam:** a chance for a longer story about the area.
- **Driving → stopping** (parking, fuel): pauses, or offers something about the stop itself.

### UC-5: Control playback

The **Pause / Continue** and **Stop** buttons are always on screen (§4). The play/pause button on the headset or car audio also toggles Pause / Continue.

- **Pause:** speech stops at once (or at the end of the current sentence). While paused the app keeps tracking position, so on **Continue** it picks up with what's relevant *now*, not where it left off five minutes and a kilometre ago.
- **Stop:** ends the tour (UC-12).
- **Skip:** drops the current segment and moves on.
- **Replay:** repeats the last segment.

The same controls also work by voice through push-to-talk ("pause", "skip that", "say that again").

### UC-6: Ask a question (push-to-talk)

The user holds the PTT button, asks, and releases. The guide pauses its narration, answers by voice, then resumes.

- **About what's in view:** "What's that building on the right?", "What's the tall tower ahead?", "What was that we just passed?" The app has to work out what the user means from their position, direction, recent commentary, and the topic cards on screen.
- **Follow-ups:** "Tell me more about that", "Why was it destroyed?", "Who was he?"
- **General questions about the place:** "What's the population here?", "What do people do for work around here?"
- **Practical questions about nearby places:** "Is there a good place for lunch around here?", "What's that market?" These are answered from what the guide knows about nearby POIs.

If the question is ambiguous, the app asks a short clarifying question. The user answers with PTT again.

### UC-7: Steer with topic cards

As the guide talks, each POI or topic it mentions appears on screen as a **topic card**, e.g. *"Sé Cathedral"*, *"1755 earthquake"*, *"Fado"*, *"Pastelaria Santo António"*.

- **Tap a card:** the guide shifts toward it at the next natural break, without cutting off the current sentence or thought. It then goes deeper on that POI or topic, and leans its upcoming commentary that way (more about the earthquake's impact on the places ahead, for example).
- The current card is highlighted, and up to 5 recent cards stay visible, so the user can tap back to something mentioned a minute ago. Older cards drop off. There's no history to scroll back through.
- The guide briefly confirms the shift by voice ("Sure, more about the earthquake.").

This is the main way to steer without speaking. It's quick, quiet, and works in a noisy street or on a bus.

### UC-8: Steer by voice or lens (push-to-talk)

For steering that a topic card can't express, the user holds PTT and says what they want:

- **Change or add a lens:** "Switch to art", "Add some food stuff". (Lenses can also be changed by tapping the active-lens display.)
- **Adjust balance:** "Less kings and wars, more about how ordinary people lived."
- **Adjust depth or tone:** "Keep it short", "Go deeper", "Make it fun for the kids", "Speak more slowly".
- **Adjust frequency:** "Talk less", "Only tell me about the big things", "Keep talking".
- **Follow a thread:** "Follow the story of the Hanseatic League as we go."

Steering takes effect immediately and stays in force for the rest of the session until changed. The app briefly confirms the change.

### UC-9: Driving

When the user is the driver:
- The tour runs entirely without touching the screen once started. Commentary never asks for a reply.
- The driver can pause and continue with the car's or headset's play/pause button, without touching the phone.
- The controls (§4) stay large and simple, so a single tap is enough when needed (as with a navigation app in a phone holder). Passengers can do the steering.
- Commentary is concise and avoids asking the driver to look away for long ("look closely at the third window…").
- Narration gives way to navigation prompts and calls from other apps, then picks up again.

### UC-10: Handle places with little to say

In sparse areas (empty motorway, forest, open sea, farmland), the app:
- Widens the scope: landscape, geology, climate, agriculture, the region as a whole, history that played out across the area.
- Previews the next interesting place and how far away it is.
- Or stays quiet, depending on the user's frequency setting.

The app should never make up facts to fill silence. When it isn't sure, it says so or says nothing.

### UC-11: Sightseeing bus tour

The user is on a city sightseeing bus (double-decker, hop-on-hop-off) and chooses this app over the bus's own recorded commentary, because they want commentary in their own language, on their chosen lenses, timed to where the bus actually is.

- The app recognises stop-and-go bus movement along a typical tour route, and the higher vantage point.
- Commentary is dense but well timed: the bus passes many sights slowly, so each gets a short, precise mention as it comes into view, with depth on the slow stretches and at stops.
- When the user hops off, the app switches to walking (UC-4). When they get back on, it switches back.
- It avoids the generic "on your left is…" listing: it goes deeper on what matches the user's lenses and briefly skips over the rest.

### UC-12: End a tour

The user presses **Stop**, or the app ends the session after a long period of inactivity (asking first, by voice). On stop, the app confirms and ends the session.

### UC-13: Lose the connection

The app works online only. If the connection drops:
- The guide finishes what it already has, then tells the user briefly that it's lost connection and pauses.
- Pressing PTT while offline gives a clear "I can't answer right now, no connection".
- When the connection comes back, the guide picks up with what's relevant at the user's current position.

### UC-14: Simulated tour (testing)

For development and testing, a tour can run on a simulated position instead of real GPS:
- **Simulated route:** pick a start and end point (or waypoints) anywhere in the world and a mode (walk, bus, drive). The tour then plays as if you were moving along that route at a realistic pace, with a speed multiplier, pause, and turn-around.
- **Recorded trace:** replay a GPS trace recorded on an earlier real walk or drive.
- A map shows the simulated position moving, so you can judge whether commentary lands at the right moment.

Everything else (narration, topic cards, push-to-talk, steering) behaves exactly as on a real tour. Simulation is a developer feature, hidden from regular users at launch.

### UC-15: Free tour, passes, and running out of time

Pricing details are in `monetization.md`. In the app:
- A new user's first tour is free (up to 60 minutes, full quality).
- After that, starting a tour leads to a simple screen to buy a day, week, or annual pass. Each pass includes a set number of listening hours.
- Remaining time isn't shown on screen. When about 30 minutes are left, the guide says so briefly. When the hours run out, it finishes its current sentence, pauses, and offers a top-up. Buying one continues the tour where it is.

## 7. User scenarios

### S-1: Morning walk through an old town

Maria and Tom are in Lisbon for a week. After breakfast they leave their guesthouse in Alfama with no plan. Maria opens the app, taps **History** and **People & Society**, and presses **Start**.

Through her earbuds: *"You're in Alfama, the oldest district in Lisbon. It survived the 1755 earthquake largely intact, which is why the streets still follow their medieval tangle. You're heading downhill toward the river, and in about two minutes you'll reach the Sé, the cathedral."* Cards for *Alfama*, *1755 earthquake* and *Sé Cathedral* appear on screen.

As they wander, the app tells short stories about the streets they pass. At the cathedral it explains why it looks like a fortress. Maria holds the talk button: *"Why is everyone hanging laundry outside?"* The guide answers, ties it to how small the houses are and the district's working-class past, then carries on. A moment later Tom taps the *1755 earthquake* card, and the guide goes deeper on how the city was rebuilt, pointing out the differences as they come down into the flatter, grid-like Baixa.

It mentions a pastry shop on the corner that's been there since the 1800s. They stop for coffee. The app goes quiet. Twenty minutes later they head off uphill in a new direction, and the guide picks up with what's ahead.

### S-2: A long coastal drive

Lars is driving the coastal road in western Norway. Before setting off he puts the phone in its holder, taps **Nature & Landscape** and **History**, and presses **Start**. The audio plays through the car.

From the road he's on, the app works out the route ahead. It covers the region in long arcs: how the fjords were formed, the fishing economy, the stave churches. It announces highlights well ahead: *"In about eight kilometres the road crosses a series of low bridges over the open sea, the Atlantic Road. I'll tell you how it was built as we get close."*

On the bridges it times the story to the crossing. On a long empty stretch it tells a longer story about the stockfish trade. When the navigation app announces a turn, the guide stops mid-sentence, waits, and resumes. Lars's daughter in the passenger seat taps *Stockfish* to hear more, then holds the talk button: *"Are there whales here?"* The guide answers. Lars hasn't touched the phone since he set off.

### S-3: "What's that?"

Walking through a city she doesn't know, Aiko notices an odd building with a green dome on her right. She holds the talk button: *"What's that green dome on the right?"* The app works out the most likely match from her position, direction, and nearby POIs, and confirms: *"That's the old synagogue. It was built in…"* A card for it appears. If the app can't tell which building she means, it asks: *"Do you mean the dome on the corner, or the one further back?"*

### S-4: Steering mid-tour

Halfway through a walking tour of Rome, Ben has heard enough about emperors. He holds the talk button: *"Less ancient Rome, more about the city today: what it's like to live here, the economy, politics."* The guide confirms and changes angle. When they pass the next ruin, it gives just one sentence on the ruin, then talks about the neighbourhood around it, rents, and local politics over excavation and construction. Ben spots a card for *Testaccio market* and taps it. The guide tells him about the market and the old slaughterhouse district around it, and suggests it for lunch.

### S-5: Family road trip

A family is driving through Provence. From the passenger seat, one parent holds the talk button: *"Make it fun for the kids, short stories, trivia."* The guide switches to short, lively segments with questions for the kids ("Can anyone guess why the fields are purple?"). The kids take turns with the phone, tapping cards like *Lavender* and *Roman aqueduct*. The guide still stays quiet when the navigation app is giving directions at a tricky junction.

### S-6: Switching from walking to a tram

Sofia has been walking through Vienna's inner city with detailed commentary. She hops on a tram along the Ringstraße. The app notices the faster movement, switches to a wider view (the Ringstraße as a single 19th-century project), and times short mentions to each major building as the tram passes.

### S-7: Turning back

Driving through Tuscany, Paolo realises he's missed his exit and turns around. The app drops the story it had queued about the next town, picks up the new direction, and doesn't repeat what it said on the way in. Instead it adds a different angle on the same places.

### S-8: Losing coverage

On a mountain road, the mobile signal drops. The guide finishes its current sentence, says *"I've lost connection, I'll pick up again once we're back in coverage,"* and pauses. Ten minutes later, with signal back, it resumes with the valley they're now driving into.

### S-9: Double-decker bus tour

Priya and Sam are in London and buy tickets for a hop-on-hop-off double-decker. The bus provides headphones with recorded commentary in eight languages: generic, and often a few seconds off from what's outside. They climb to the top deck, put in their own earbuds instead, open the app, tap **Architecture & Art** and **Curiosities**, and press **Start**.

The app recognises the stop-and-go pace along a typical tour route. As the bus crawls down the Strand, the guide doesn't list every building. It picks the ones that match their lenses and times each one so it's speaking just as the building comes into view from the top deck. During a five-minute wait in traffic it tells them the odd story of a Roman bath hidden down a side street they can almost see. Sam taps the card for *St Paul's Cathedral* as it comes up, and the guide tells the story of Wren's design battles.

They hop off at St Paul's. The app notices they're walking now, and switches to close-up commentary as they wander round the cathedral and over the Millennium Bridge. An hour later they get back on another bus, and the guide switches back to bus mode and picks up along the new route.

## 8. Cross-cutting expectations

- **Audio out, buttons in:** what the guide says is audio. Playback control is buttons that are always visible. Speaking to the guide is push-to-talk only: no always-on microphone, no wake word.
- **Low latency:** answers to push-to-talk questions start within a couple of seconds, and taps on topic cards take effect just as fast.
- **Factual honesty:** no made-up history. Uncertainty is stated as uncertainty.
- **Language:** English only for now, both narration and push-to-talk.
- **Works with headphones, phone speaker, and car audio**, and plays well with other audio (navigation, calls, music).
- **Battery and data aware:** a full day of walking or a long drive is realistic.
- **Online only** for now.
- **Phone app only** for now.

## 9. Out of scope for now

- Turn-by-turn navigation (the app guides *about* places, not *to* them).
- Entering a destination or route: the path is inferred from position and direction only.
- Planned tours ("make me a 2-hour walk"): the app is spontaneous only, starting where you are.
- Booking, ticketing, reviews, opening hours.
- Recognising different speakers (driver vs kids).
- User-created tours and social features.

## 10. Roadmap (later)

- **Post-tour recap:** a short summary of the tour, spoken or written.
- **Visited places log:** a list of places and stories covered, to look up later.
- **Offline mode:** prepared commentary for areas without coverage (rural drives, abroad without roaming).
- **Car integration:** CarPlay / Android Auto.
- **Hands-free voice:** a wake word, or push-to-talk from a headset or steering-wheel button.
- **More languages:** narration and push-to-talk beyond English.
- **More lenses**, e.g. *Military History*, *Science & Engineering*, *Transport*.
- **Planned routes and destination input.**
- **Speaker recognition:** tailoring to different listeners in the same car.

## 11. Decisions and alternatives considered

| Topic | Decision | Alternatives considered |
|---|---|---|
| Control | Buttons first. Pause/Continue and Stop always visible; speaking only through a push-to-talk button (§4). | Voice-first control, an always-on microphone, a wake word (hands-free voice is on the Roadmap) |
| Topic card tap | Takes effect at the next natural break, without cutting off the current sentence (UC-7) | Cutting in immediately |
| Topic card trail | Current card plus up to 5 recent ones; older cards drop off | A scrollable history (a visited-places log is on the Roadmap instead) |
| Headset / car play-pause button | Works as Pause/Continue, so a driver never needs the screen | Ignoring media buttons |
| Driving | No taps needed once the tour starts; passengers do the steering (UC-9) | Requiring taps while driving |
| Lenses | The 13 in §5, *Surprise me* by default. Tone and depth ("for the kids", "in depth") are set by voice, not as lenses. | *Military History*, *Science & Engineering*, *Transport* (Roadmap); tone and depth as lenses |
| Language | English only, for narration and push-to-talk | Several languages at launch (Roadmap) |
| Platform | Phone only | Desktop or car screens at launch (CarPlay / Android Auto on the Roadmap) |
| Kind of tour | Spontaneous only, starting where you are; the path is inferred from position and direction | Planned tours, destination or route input (out of scope for now, Roadmap) |
| Restaurants and cafés | Brief mentions as places along the way | Reviews, bookings, opening hours (out of scope) |
| Losing the connection | Finish what's already loaded, say so, and pause (UC-13) | Offline commentary (Roadmap) |
| Different listeners | Treated as one audience | Speaker recognition (Roadmap) |
| Free use and payment | One free tour, then hour-based passes; remaining time not shown, with a spoken heads-up instead (UC-15, `monetization.md`) | Showing remaining time (to decide later); ads; unlimited plans |

Technical decisions (architecture, voice, data, front end, hosting) are logged in `architecture.md` §13.

## 12. Open questions

None at the moment.
