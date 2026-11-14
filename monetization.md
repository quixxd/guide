# Audio Tour Guide: Monetization Options

Status: v0.2. Launch model decided (see below). Builds on the cost figures in `architecture.md`. Prices and hour allowances are starting points to tune once real usage data comes in.

## Launch model (decided)

A simplified version of **M5 (hybrid)**: one free tour, then hour-based passes. No unlimited plans, no ads, no add-ons at launch.

| Product | Price (base, USD) | Includes | Est. cost to us* | Net after 15% store fee | Margin |
|---|---|---|---|---|---|
| **First tour** | free, once | One tour, up to 60 minutes, full quality (standard cloud voice) | ~$0.50 | — | acquisition cost |
| **Day pass** | $3.99 | 4 hours of listening within 24 hours | ~$2.00 | ~$3.40 | ~40% |
| **Week pass** | $9.99 | 12 hours of listening within 7 days | ~$6.00 | ~$8.50 | ~30% |
| **Annual** | $39.99 | 40 hours of listening within 12 months | ~$20.00 | ~$34.00 | ~40% |
| **Top-up** | $4.99 | +5 hours on the current pass | ~$2.50 | ~$4.25 | ~40% |

\* At ~$0.50 per listening hour (architecture B, standard voice). The prototype on architecture A costs more, but prototype volumes are small. Margins grow as audio caching (C) lowers the cost per hour.

**Rules**

- **Only listening counts.** Hours are counted while narration or answers are playing, not while the tour is paused or the guide is silent.
- **Remaining time stays out of sight.** There's no counter on the main screen. Instead, the guide gives a **short heads-up** when ~30 minutes are left ("you have about half an hour left on your pass") and offers a top-up when the hours run out. Without that warning, a capped pass would just stop mid-tour.
- **One free tour per user,** tied to the app store account or device, to limit abuse from reinstalls.
- **Regional pricing:** prices follow regional purchasing power through the app stores' regional price tiers. Since our cost per hour is the same everywhere (~$0.50), regional prices keep at least **~$0.70 per included hour** before store fees, so no region loses money. Where that floor would make a pass too expensive locally, the pass includes fewer hours rather than dropping below the floor.

## Roadmap (later)

- **Audio ads**, in a free tier only.
- **Daily free allowance** (e.g. 15 minutes per day on the built-in voice), on top of the free tour.
- **Showing remaining time** in the app (to be decided later).
- **Premium voice** as a paid add-on.
- **Unlimited plans with fair use**, once audio caching brings the cost per hour down.

## Background: the options considered

The rest of this document is the analysis behind the decision, kept for reference.

## 1. Constraints that shape pricing

- **Usage comes in bursts.** People use it intensely on holiday (1–3 hours a day for 1–2 weeks), then not at all for months. A typical user takes 1–3 trips a year.
- **Every hour costs us money.** With architecture B and the standard voice, a tour hour costs **~$0.50** (the prototype on A costs $1–2.50). A free hour on the phone's built-in voice costs **~$0.05**.
- **App store fees:** 15% (small-business programmes, and subscriptions after year one), otherwise 30%.
- **The value shows up fast.** Ten minutes of walking with the guide is the best sales pitch, so letting people try it matters more than marketing copy.
- **Heavy users exist.** A road-tripper can easily listen for 4–6 hours a day. Anything "unlimited" needs a fair-use limit or a price that covers it.

## 2. Building blocks

| Block | What it means here | Pros | Cons |
|---|---|---|---|
| **Free trial** | Full product, free for a limited time or amount of use, then you pay | Shows the full experience | A **time-limited** trial (e.g. 7 days) means the whole holiday is free and the user leaves. Trials should be **usage-limited** (e.g. first 60 minutes). |
| **Free tier** | A permanently free, limited version | Brings people in, word of mouth, and there's always something to open | Costs money for every free hour. It must be cheap to serve (built-in voice, Haiku), and the limit must still leave a reason to pay. |
| **Freemium** | The business model of *free tier + paid upgrade*: the basic product is free forever, and you pay for more (more time, a better voice, more features) | Familiar, scales well | The free/paid line has to be drawn carefully. If it's too generous nobody pays, and if it's too stingy nobody gets hooked. |
| **Paid tiers, fixed** | Fixed price for a period: day pass, week pass, monthly or annual subscription | Simple, predictable, no ticking meter while you listen | Unlimited use makes heavy users unprofitable unless there's a fair-use limit. Monthly subscriptions get bought for one holiday month and cancelled. |
| **Pay-as-you-go** | Buy hours (prepaid packs) and use them up while listening | The margin is protected on every hour. Fair to occasional travellers. | A ticking meter on a leisure product makes people hold back. Less predictable revenue. |
| **Audio ads** | Short spoken ads between narration segments, in the free tier | Lets the free tier pay for itself | Low revenue at small scale (rough estimate: a few cents per listening hour). Ad networks need a lot of volume first. Interrupts the flow, and location-based "sponsored" mentions damage trust in the guide's honesty. |

**Rough ad maths:** 3 ad slots per hour at a ~$10 CPM (thousand plays) brings in ~$0.03 per hour. That roughly covers a free hour on the built-in voice ($0.05), but not one on the standard cloud voice ($0.50). Ads can only ever pay for a cheap free tier, and only once there's real volume.

## 3. Packaged alternatives

### M1. Holiday passes

| | |
|---|---|
| Free | First hour free (one time) |
| Day pass | $3.99, 24 hours |
| Week pass | $9.99, 7 days |
| Annual "Explorer" | $39.99, all year |
| Limits | Fair use on all passes, e.g. 4 hours per day |
| Ads | None |

Matches how people travel. "Buy a week for your trip" is easy to understand, and there's no meter. **Risk:** a heavy road-tripper on a week pass (20+ hours) costs more than the pass earns ($10 vs $8.50 net) until audio caching (C) brings costs down. The fair-use limit handles that.

### M2. Classic freemium subscription

| | |
|---|---|
| Free tier | 20–30 minutes a day, built-in phone voice, a few questions per day |
| Plus | $9.99/month or $39.99/year: unlimited (fair use), standard cloud voice, unlimited questions |
| Trial | First tour on Plus, free |
| Ads | None |

The standard app model, and the free tier keeps people coming back between trips. **Risk:** holiday users subscribe for one month, listen 15+ hours, and cancel. That's why the monthly price is set high ($9.99 rather than $5.99) and the annual plan is the real target.

### M3. Ad-supported free + paid

| | |
|---|---|
| Free tier | Generous use (e.g. 1 hour a day), built-in phone voice, an audio ad every ~20 minutes |
| Paid | Removes ads, switches to the cloud voice: as a pass or a subscription |

The lowest barrier to entry, and ads offset some of the free tier's cost. **Risks:** at small scale ad revenue is close to zero, and ads interrupt exactly the immersion we're selling. Better as a later addition than a launch model.

### M4. Pay-as-you-go hour packs

| | |
|---|---|
| Free | First hour free |
| Packs | 5 hours $4.99 · 15 hours $11.99 · 40 hours $24.99. Hours never expire. |
| Metering | Only narration time counts. Pauses and silence don't. |
| Ads | None |

Every hour sold covers its cost (~$0.60–1.00 net per hour against a ~$0.50 cost), so there's no heavy-user risk. Fair to someone who travels once a year. **Risk:** meter anxiety ("I'll turn it off to save hours"), which undercuts the relaxed, always-on experience the spec describes.

### M5. Hybrid: suggested starting point

| | |
|---|---|
| Try it | First tour free (60 minutes, full quality) |
| Stay around | A small free allowance every day (e.g. 15 minutes, built-in voice), so the app is worth opening on a short city break or between trips |
| Holiday | Day pass $3.99, week pass $9.99 |
| Frequent travellers | Annual $39.99 |
| Later | Premium voice as an add-on. Ads only in the free allowance, and only once volume justifies it. |
| Limits | Fair use on passes and annual (e.g. 4 hours per day) |

It combines M1's fit with travel habits and M2's reason to come back, with no meter and no ads at launch. **Risk:** more products for people to choose between. The paywall screen has to make "just buy a week" the obvious choice.

## 4. Side-by-side

| | M1 Passes | M2 Freemium sub | M3 Ads + paid | M4 Pay-as-you-go | M5 Hybrid |
|---|---|---|---|---|---|
| Fit with holiday usage | ★★★ | ★★ | ★★ | ★★★ | ★★★ |
| Margin protection (heavy users) | ★★ (fair use) | ★★ (fair use) | ★ | ★★★ | ★★ (fair use) |
| Recurring revenue | ★ | ★★★ | ★★ | ★ | ★★ |
| Simplicity for the user | ★★★ | ★★★ | ★★ | ★★ | ★★ |
| Listening experience (no meter, no ads) | ★★★ | ★★★ | ★ | ★ | ★★★ |
| Cost of free users | low | medium | medium (offset by ads) | low | low–medium |

## 5. Decisions taken

1. **Model:** M5 (hybrid), simplified.
2. **Ads:** later, free tier only.
3. **Free experience:** one free tour for now.
4. **Unlimited plans:** none yet. Every plan includes a set number of hours.
5. **Remaining time:** not shown for now. Showing it is on the roadmap as a later decision.
6. **Regional pricing:** yes.
7. **Premium voice add-on:** later, on the roadmap.
