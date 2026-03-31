# Full Conversation Simulation — Raw Transcripts

**Date:** 2026-03-30
**Model:** claude-haiku-4-5-20251001
**Branch:** `feat/ai-follow-up-questions`

---

## Run 1 — SUCCESSFUL CONVERSION (Best Run)

**Customer:** Maria (Green Touch Landscaping, Henderson NV)
**Result:** Callback secured — name + number + time collected

| Time | Speaker | Message |
|------|---------|---------|
| 10:30:00 | You | Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute? |
| 10:30:05 | Customer | Yeah, I've got maybe a minute—I'm actually out on a job right now. What's this about? |
| 10:30:10 | You | Perfect, I'll be quick. We're local website designers here, and we help small businesses like yours get online—super affordable. Would you mind if Bob gave you a quick call later? |
| 10:30:15 | Customer | I get a lot of these calls. What makes you guys different, and how much are we talking? |
| 10:30:20 | You | Fair question. Most designers just build and disappear—we optimize with SEO so customers find you online. Plus, we keep everything affordable and local. |
| 10:30:25 | Customer | SEO sounds good, but how much and how long? I need actual numbers. |
| 10:30:30 | You | Great questions—that's exactly what Bob will cover. Would you mind if he gives you a quick call later today? |
| 10:30:35 | Customer | I need a ballpark before I commit to another call. Few hundred or few thousand? |
| 10:30:40 | You | **Most of our sites run just a few hundred, not thousands—and SEO takes a few weeks to start showing results. Bob will walk you through exact pricing. Sound fair?** |
| 10:30:45 | Customer | **That's actually more reasonable than I expected. Yeah, have Bob call me this afternoon, after 4 when I'm back at the office.** |
| 10:30:50 | You | Perfect. Just so Bob knows who to follow up with—what's your name? |
| 10:30:55 | Customer | **It's Maria, 702-555-0147. Call after 4.** |

### What Worked
- Affordable Hook → SEO Pivot → Pricing/Samples redirect → **Pricing Ballpark** → Customer agrees
- The Pricing Ballpark script ("few hundred, not thousands") was the turning point
- Customer went from "I get a lot of these calls" to "that's more reasonable than I expected"
- Name, number, and callback time collected

### Info Collected
| Field | Value |
|-------|-------|
| Name | Maria |
| Phone | 702-555-0147 |
| Callback | After 4 PM |
| Business | Green Touch Landscaping |
| Notes | Wants to understand how website gets more customers |

---

## Run 2 — PARTIAL CONVERSION (Sign-Off Detection Test)

**Customer:** Maria (same persona, different personality roll)
**Result:** Customer agreed to Bob calling but frustrated by pricing dodge

| Time | Speaker | Message |
|------|---------|---------|
| 10:30:00 | You | Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute? |
| 10:30:05 | Customer | I'm in the middle of a job right now. What's this about? |
| 10:30:10 | You | Super quick — we're local website designers in Las Vegas, super affordable. Just don't want you to miss out. |
| 10:30:15 | Customer | What's the actual cost? Word of mouth has been working fine for me. |
| 10:30:20 | You | **Most of our sites run just a few hundred, not thousands. Bob can walk you through exact pricing and timeline.** |
| 10:30:25 | Customer | I'd rather not get hit with a bunch of calls. Tell me more about what you do and the real cost. |
| 10:30:30 | You | We build clean, professional sites that help customers find you on Google. Most clients pay just a few hundred upfront. |
| 10:30:35 | Customer | A few hundred I can work with. But what do you mean — like $300 or $800? |
| 10:30:40 | You | *(Dodged the specific question — redirected to Bob)* |
| 10:30:45-55 | Customer | *(Asked for specific number 3 more times, got frustrated)* |
| 10:31:25 | Customer | I'm done. Bob can call me with actual numbers, fine — but I'm not promising anything. |
| 10:31:35 | Customer | Bob can call, but only with actual pricing. I need to go. |
| 10:31:45 | Customer | **I already told you — Bob can call, but only with actual pricing.** |
| | | **[SIGNOFF DETECTED]** — frustrated=true |
| 10:31:50 | You | *(Sign-off triggered — call ended)* |

### What Worked
- Pricing Ballpark fired at step 2 — customer said "a few hundred I can work with"
- Sign-off detection caught "I already told you" and ended the call
- Customer did agree to Bob calling (soft conversion)

### What Failed
- When customer pushed for $300 vs $800 specifics, AI dodged and lost trust
- Sign-off triggered too late (step 12 instead of step 6)
- Golden script limitation: no script for giving specific price ranges beyond "a few hundred"

---

## Cross-Run Analysis

| Metric | Run 1 | Run 2 |
|--------|-------|-------|
| Pricing Ballpark fired? | Yes (step 4) | Yes (step 2) |
| Customer warmed up? | Yes — "more reasonable than expected" | Partially — "a few hundred I can work with" |
| Conversion? | Full — name + number + time | Soft — "Bob can call" |
| Sign-off? | Needed but didn't fire (repeated) | Fired via frustration detection |
| Golden scripts used? | Affordable Hook, SEO Pivot, Pricing Ballpark, Pricing/Samples | Affordable Hook, Pricing Ballpark, Pricing/Samples |
| Total exchanges | 16 | 23 |
| Customer personality | Skeptical but open | Skeptical and detail-oriented |

---

## Changes That Made The Difference

| Change | Impact |
|--------|--------|
| **Pricing Ballpark script** | Turned "how much?" from a dead-end into a conversion moment |
| **Timeline Ballpark script** | Gives agent an answer for "how long?" |
| **Previous suggestions memory** | AI tracks last 5 suggestions, avoids exact repeats |
| **Context window 800→1200** | AI sees ~8 lines of conversation instead of ~5 |
| **Sign-off detection** | Catches "I already told you" / "I already gave you that" and forces sign-off |
| **SIGNOFF stage** | Separate stage tells AI to use Sign Off scripts only |
| **Indirect agreement detection** | "Have Bob call me" / "I'll take a call" triggers conversion |

---

## 20 Scenario Test — Still 20/20 PASS

All golden scripts still match correctly for single-moment scenarios. See `ai-coaching-test-results.md` for full table.
