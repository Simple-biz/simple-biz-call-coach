# Gap Analysis — New Call Script vs Coaching Prompt

**Task:** `[SBCC-01-ST1]` (Feature Request `[SBCC-FR1]`)
**Date:** 2026-09-29
**Compared:** the new leadgen call script (now `doc/reference/official-call-script.md`) against the coaching
prompt on `main` @ `6ff3f97` — `infra/lib/lambda/shared/claude-client-optimized.ts`, which is what is deployed.
Line numbers below refer to that file on `main`.

**Verdict:** the prompt still follows the 2026-05-22 script. The pitch, location handling, most rebuttal wording and
three guidelines are out of date, and four branches of the new script have no counterpart at all.

Severity: **High** = the agent is told to say something the new script contradicts. **Medium** = wording drift
or a missing branch. **Low** = cosmetic, or a legacy line with no script equivalent.

---

## 1. Opener and value proposition

| # | New script | `main` | Gap | Sev |
|---|---|---|---|---|
| 1.1 | "…we help businesses and contractors lock down Page-1 rankings on Google and ChatGPT — plus fully manage their Google Business Profile — within 90 days, or it's completely free. I wanted to see if it makes sense to connect with someone local about an update?" | L74 Basic Intro: "We're very affordable. I wanted to see if you'd be interested in talking with someone LOCAL…"; L77 alt: "simple, affordable websites" | The whole value prop is old. No Page-1, ChatGPT, Google Business Profile or 90-day guarantee anywhere in the prompt | High |
| 1.2 | "If they don't seem to understand: We are local website developers that provide complete web design, hosting, and SEO. As a Google-certified partner… over 48,000 Page-1 rankings… 90 days or you don't pay a dime." | L78: "We're local website designers here in Topeka and Kansas City, so we wanted to see if you'd like some help from someone LOCAL" | Missing Google-certified, 48,000 rankings, hosting/SEO, guarantee | High |
| 1.3 | `{PLACE NAME}` — agent's discretion | L74, L78, L82, L84, L133, L220, L221, L245: hardcoded "Topeka (toe PEEK uh) and Kansas City (KAN zus sit ee)"; L224 pronunciation rule | Coach names a city the agent may not use | High |
| 1.4 | Ends with "…makes sense to connect…" | L74, L82, L84, L89: "…if you'd be interested…" | Script's guidelines say not to end on "interested" | Medium |
| 1.5 | — | L89 Affordable Hook, L125, L243, L667 fallback: "super affordable" | Old pitch; not in the new script | Medium |

## 2. Rebuttals

| # | Lead says | New script | `main` | Gap | Sev |
|---|---|---|---|---|---|
| 2.1 | Not right now | "…because you already have a website, or because you're just busy right now?" | L98 | Matches | — |
| 2.2 | Already have a website | "That's great. We also help businesses improve and optimize their existing websites. Would you mind if I have Bob or his partner give you a call…" | L101: "…because we also optimize websites…call you…" | Wording drift | Medium |
| 2.3 | Busy right now | "No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call…" | L103: "…call you later today…Would you mind if I have him give you a call?" | Adds "later today"; "him" instead of Bob or his partner | Medium |
| 2.4 | How much? | "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing…" | L125: "We're super affordable. I'll get Bob…reach out today…"; L243: "We're super affordable — …would you mind if he gives you a quick call?" | Old "affordable" claim; "he" not Bob or his partner | High |
| 2.5 | No website | "…I'll have Bob or his partner give you a call to talk about building one…" | L94: "…reach out today to chat with you…" | Adds "today" | Low |
| 2.6 | Not interested | "No problem. I appreciate you taking my call." | L113 (+ "Have a great day") | Matches in substance | Low |
| 2.7 | Built sites in my industry? / my city? | Two separate lines: "…examples of websites we've built for businesses like yours" / "…built in your area" | L129: one combined line, "reach out today with some samples of websites we've done in [your area/industry]" | Not split; adds "today" | Low |
| 2.8 | How do I reach you? | "Bob's number is ___. So we don't end up playing phone tag, would you mind if I have Bob or his partner give you a call?" | L131: "…let me have him call you. Would you mind if I have him or his partner…" | Wording drift | Low |
| 2.9 | Where are you located? | "Bob is in {locationguide}. Would you mind if I have Bob or his partner give you a call to talk about your website?" | L133: "Bob's in Topeka and Kansas City. I'll get him to reach out today with some samples…" | Hardcoded city; extra samples pitch | High |
| 2.10 | Can you do [technical]? | "…I'm just Bob's assistant… Would you mind if I have Bob or his partner give you a call to answer that for you?" | L135 matches; **but** L244 rule 5 overrides it: "Definitely, Bob can show you exactly how that works — would he be able to give you a quick call?" | Rule 5 implies the capability exists | High |
| 2.11 | Send us / email us your info | "Absolutely. What's the best email address? Bob or his partner can send over some examples… would they be calling to talk to you… or someone else in charge?" | L162 close; L146, L581: never ask a receptionist for email, even if they ask | Receptionist email requests get refused | Medium |

## 3. Branches in the new script with no counterpart in `main`

| # | New script | `main` | Sev |
|---|---|---|---|
| 3.1 | Likely receptionist agrees to a callback → "Excellent. Bob or his partner will reach out. Would they talk to YOU about the website, or is there someone else in charge of that?" | L138–151 receptionist section has no such line; L237 rule 1 says to accept and "give Bob's number" | Medium |
| 3.2 | Future date ("won't be ready until next year") → "…would it be okay if Bob or his partner reach out to you LATER TODAY…" | None | Medium |
| 3.3 | Non-engaging lead → "Just to make sure we're on the same page, is this to build a new website, or to update your existing website?" | None (L153–165 engagement asks discovery questions instead) | Medium |
| 3.4 | Appointment qualifiers: engaged lead, decision maker, clear purpose (build/update), same-day or next business day on request, name confirmed | L265 conversion steps cover name and time only; no purpose or decision-maker step; no same-day rule | Medium |

## 4. Guidelines

| # | Guideline | `main` | Gap | Sev |
|---|---|---|---|---|
| 4.1 | ALWAYS use "Bob or his partner" on a callback offer | L107, L108, L110, L111, L112, L127, L243, L244, L672: "if Bob gives you…", "would he be able…" | 9 lines drop "or his partner" | Medium |
| 4.2 | AVOID asking for a specific appointment time or day | L169 Confirm Time: "when's the best time to reach you?"; L172, L241: "when works best for you?"; L682 fallback | The conversion step contradicts the script | High |
| 4.3 | AVOID confirming their phone number | L171, L266: never ask | Matches | — |
| 4.4 | AVOID ending with "Is this something you'd be interested in?" | L74, L82, L84, L89 end on "interested" | See 1.4 | Medium |
| 4.5 | AVOID suggesting email | L168, L260 | Matches | — |
| 4.6 | End with a callback question | L274: "Must end with a question or callback ask" | Allows any question, e.g. L127 "Does that sound good?" | Low |

## 5. Lines in `main` with no basis in the new script

| # | `main` | Issue | Sev |
|---|---|---|---|
| 5.1 | L144: "Leave a message naturally — Caesar called…" | Hardcoded agent name; the agent is `[Agent]` | High |
| 5.2 | L120, L164: "We're scouting small to medium local businesses… got your number off of Google" | Not in the script (decision 2026-09-29: follow the script, deflect unscripted questions) | Medium |
| 5.3 | L111 Digital Marketing Pivot: "we're a whole digital marketing company" | Contradicts L280 ("never 'digital marketing company'") and the script's "local website designers" | Low |
| 5.4 | L165: "a legit local company here in [Location]" | `[Location]` placeholder; not script wording | Low |

## Totals

| Severity | Count |
|---|---|
| High | 8 |
| Medium | 12 |
| Low | 7 |
| Matches | 3 |

(4.4 repeats 1.4 from the guideline side; it's counted in both places.)

## What this feeds

- `[SBCC-01-ST2]` prompt and script-doc rewrite: every High and Medium row above.
- Found only later, in simulation, not visible from reading the prompt: stage-filtered scripts mean a rebuttal is
  missing when the lead raises it at an unexpected stage. That is covered by `[SBCC-01-ST6]`.
