# Audio Tour Guide: Topics to Discuss Later

Status: list as of 2026-11-15. Important aspects not yet discussed. When one is taken up, record the outcome in the relevant doc (`spec.md`, `architecture.md`, `data-sources.md`, `monetization.md`), log the decision, and remove it here.

## Now: before or during the Portugal field tests

1. **Test plan and success measures.** What to measure on a walk:
   - **Signals:** skips, pauses, questions per hour, listening time, and "wrong / boring / too late" moments.
   - **Capture:** a feedback button or quick voice notes, plus a short write-up after each walk.

   Without this, field tests give impressions rather than decisions.
2. **Guide persona and editorial policy.**
   - **Voice:** warm, witty, or scholarly?
   - **Sensitive topics:** colonial history, the Religion and Politics lenses, wars, living people.
   - **Kids:** adjusting the tone.
   - **Accuracy:** disputed facts, and what to do when a listener says "that's wrong".

   These rules feed directly into the prompts.
3. **Gaps and timing between segments.** The prototype requests the next segment only after the current one finishes. That leaves silent gaps and risks missing a passing place. Options:
   - prepare the next segment while the current one plays
   - stream the voice
   - pre-load the route ahead for tunnels and dead zones

## Before launch

4. **Safety and legal.**
   - **Driving:** distraction and liability; lowering our volume when navigation apps speak.
   - **Privacy:** location as personal data, GDPR consent, privacy policy, data deletion.
   - **Content:** liability for wrong facts or statements about real people.
   - **Licences:** the share-alike legal review (`data-sources.md` §8).
   - **App stores:** Apple's review of background location; whether hour-based passes are sold as consumables or non-renewing subscriptions.
5. **Competition and positioning.** Existing GPS audio-guide apps (VoiceMap, SmartGuide, GPSmyCity, Autio and others) and current AI guides; what makes us the choice; naming and brand. Before investing in B.
6. **Cost controls and abuse protection.** A leaked access key today means unlimited LLM spend. Needs:
   - per-user rate limits
   - spending alerts and caps on the LLM account
   - real authentication before outside testers
7. **Battery and mobile data abroad.** Hours of GPS plus streamed audio, and expensive roaming outside the EU. Affects audio bitrate, pre-loading, and a possible "low data" mode.

## Later

8. **Accessibility.** An audio-first app suits blind and low-vision users, a possible deliberate audience. Captions for deaf and hard-of-hearing users; screen reader support; text size.
9. **Listener feedback and corrections.** Turning "that's wrong" reports into fact-card fixes: flagging, review, correction.
10. **Partnerships with businesses.** Sightseeing bus operators, car rental companies, hotels, tourism boards: as channels, and how they'd change pricing.
11. **Operations.** Monitoring and alerts, a log of what the guide said (for debugging and evals), and EU VAT if we sell through our own website.
12. **Roadmap, timeline, and budget.** Milestones from prototype to B to launch, and what each costs to build.
