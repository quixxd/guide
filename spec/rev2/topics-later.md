# Audio Tour Guide: Topics to Discuss Later

Status: rev2 list as of 2026-11-15, carried over from `../rev1/topics-later.md` and updated for the route-catalog rollout. When a topic is taken up, record the outcome in `spec.md` or `architecture.md`, log the decision, and remove it here.

## Now: during the prototype

1. **Test plan and success measures.** What to measure on a walk:
   - **Signals:** skips, pauses, listening time, and "wrong / boring / too late" moments.
   - **Capture:** a feedback button or quick voice notes, plus a short write-up after each walk.

   The prototype's real job is to find out what good narration on foot sounds like, so the write-ups should say *why* a segment worked or didn't.
2. **Guide persona and editorial policy.**
   - **Voice:** warm, witty, or scholarly? Rev2 default is the style of a good human-led history walk.
   - **Sensitive topics:** colonial history, religion, wars, living people.
   - **Accuracy:** disputed facts, and how scripts handle them.

   These rules feed the prototype prompts now and the route scripts later.
3. **Gaps and timing between segments (prototype).** The prototype requests the next segment only after the current one finishes, which leaves silent gaps. Options: prepare the next segment while the current one plays, or stream speech sentence by sentence.

## Before the rollout

4. **Route design method.** How we choose stops and order, how long routes are, how many per city, and what tool supports a person designing them.
5. **Script review workflow.** Who reviews, what they check, how edits feed back into the prompts, and how long a route takes to review.
6. **Voice choice.** Which premium voice, one or several, and how pronunciations of local names are fixed.
7. **Safety and legal.**
   - **Licences:** share-alike legal review. Published scripts are fixed texts, so whether they count as adaptations of CC BY-SA sources matters more now (`../rev1/data-sources.md` §8).
   - **Privacy:** location stays on the phone in the rollout; GDPR still needs a privacy policy and consent for analytics.
   - **Content:** liability for wrong facts or statements about real people.
   - **App stores:** Apple's review of background location for a walking app.
   - **Walking safety:** crossing roads with headphones; scripts shouldn't ask people to look at things while crossing.
8. **Competition and positioning.** More pressing in rev2, because pre-made GPS walking tours is exactly what VoiceMap, SmartGuide, GPSmyCity and others sell. What makes ours the choice (quality of story, voice, price, coverage of underserved places from `../rev1/market-areas.md`); naming and brand.
9. **Battery and mobile data abroad.** Mostly solved by offline packs; check pack sizes and GPS battery use on a 2–3 hour walk.

## Later

10. **Accessibility.** An audio-first app suits blind and low-vision users, a possible deliberate audience: spoken directions, screen reader support, captions (transcripts are already in the route pack).
11. **Listener feedback and corrections.** "That's wrong" reports turned into script fixes and new pack versions.
12. **Partnerships.** Tourism boards, hotels, sightseeing operators, local guides as script reviewers or co-authors.
13. **Operations.** Monitoring of downloads and errors, versioning and rollback of route packs, EU VAT if we sell through our own website.
14. **Roadmap, timeline, and budget.** Milestones from prototype to the first city's routes to launch, and what each costs (mainly review time per route and language).
