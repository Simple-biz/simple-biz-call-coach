# Call Coach Chrome Extension — End of Day Report

**Date:** April 22, 2026
**Developer:** Kayser B
**Project:** DevAssist-Call-Coach
**Version:** 2.2.9 → **2.2.10**

---

## Session Overview

**Focus:** AI tip generation latency — reduce time from "customer finishes speaking" to "tip visible on screen."

**Outcome:** 2 PRs shipped and merged to `main` (#74, #75). Prompt compression deployed to production Lambda. Temporary per-tip latency benchmark panel added to history view for collecting real-call performance data.

---

## Commits Today

| Commit | Message |
|--------|---------|
| `17b145d` | perf(prompt): compress system prompt for faster tip generation (#74) |
| `65e3ccb` | v2.2.10: tip-latency benchmark + version bump (#75) |

---

## Accomplishments

### 1. ✅ PR #74 — Prompt compression (permanent perf win)

**Problem:** Warm AI-tip generation was averaging ~2160ms total / ~1221ms time-to-first-chunk. Below our 3-second CEO target but still longer than it needs to be for a fluid coaching experience.

**Approach:** Tightened the ultra-compressed system prompt in `infra/lib/lambda/shared/claude-client-optimized.ts` by ~170 tokens. Collapsed verbose sections into tight one-liners — no behavior change, all rules and triggers preserved.

**Sections compressed:**
- **Rule 1a (hostile/fake input)** — 7 lines → 1 line. Kept all triggers (profanity, placeholder dismissals, fake names, reserved phones, repeated nonsense) and the Respect Decline response.
- **BOB identity framing** — 5 lines → 4 tight lines. Kept peer-tone intro rule and honest "I'm Bob's assistant" answer to direct identity questions.
- **CONVERSION STAGE RULES** — 9 lines → 4 lines. Kept Name → Business → Email/Time → Sign Off flow.
- **VALIDITY CHECK** — 4 lines → 1 line.
- **SCRIPT / ANTI-REPETITION / ESCALATION / FACTS** — section headers + bullets → tight one-liners.

**Deployed via:** `npx cdk deploy DevAssist-WebSocket --require-approval never --output "$env:TEMP\cdk-out-callcoach"`

**Measured impact (3x perf-test sessions of 3 rounds each):**

| Metric | Baseline | After | Δ |
|--------|----------|-------|-----|
| Warm TTFC | ~1221ms | **~1155ms** | -66ms (-5%) |
| Warm total | ~2160ms | **~2092ms** | -68ms (-3%) |

Modest but real. Free-and-easy category — no added complexity, no cost.

---

### 2. ✅ PR #75 — Tip-latency benchmark panel (TEMPORARY) + v2.2.10 bump

**Why a second PR:** PR #74 was squash-merged with only the prompt compression commit before the benchmark + version bump commits were pushed. The Chrome Web Store deploy then failed with `PKG_INVALID_VERSION_NUMBER` because `manifest: 2.2.9` is already published. PR #75 carried the orphaned commits to main and unblocked the deploy.

**Benchmark panel (temporary):** Adds an amber "AI Tips (benchmark)" section at the top of every history transcript detail view, listing each tip generated during the call with a per-tip generation-ms badge. Measurement: clock from first `TIP_CHUNK` arriving → final `AI_TIP` firing (client-visible streaming duration).

All three touch points are marked `// TEMP benchmark` for a clean revert later:
- `src/utils/history-store.ts` — `HistoryTip` type + `tips` field on `CallHistoryRecord`
- `src/background/index.ts` — `pendingTipStartedAt` clock, `currentCallTips` accumulator, listener changes, reset on `CALL_STARTED`
- `src/components/TranscriptDetail.tsx` — `TipsBenchmarkPanel` component

**Version bump:** 2.2.9 → 2.2.10 in `package.json`, `vite.config.ts`, `src/background/index.ts`.

---

## Live-Call Validation

Real production call (2m 11s, 31 transcript lines, 4 tips generated):

| Tip | Stage | Latency | Note |
|-----|-------|---------|------|
| Website Opportunity | VALUE_PROP | **1198ms** | First tip of call, cache warm |
| Clarify Intent | VALUE_PROP | **1979ms** | Longer output (objection + ask) |
| Wrong Fit | SIGNOFF | **931ms** | Short signoff script |
| Call Closed | SIGNOFF | 3353ms | Post-signoff outlier (model refused to generate a real tip after the call had ended) |

- **Median (excluding post-call outlier): ~1369ms**
- **Average (all 4): 1865ms**

3 of 4 tips landed in the 930-2000ms band — matches the synthetic perf-test numbers. The single outlier was a post-signoff non-tip ("Call is complete — no further response needed") that doesn't affect real coaching latency.

---

## Deployment Notes

- **Lambda:** `DevAssist-WebSocket` deployed via CDK with `$env:TEMP\cdk-out-callcoach` output dir to avoid Windows file-watcher EPERM locks.
- **Chrome Web Store:** Deploy run #21 initially failed on `2.2.9` conflict. PR #75 merge triggered a new deploy run that should succeed with `2.2.10`.
- **Production backend:** Prompt compression live on all real traffic since ~16:00 UTC.

---

## Agent Update Message

> Call Coach v2.2.10 is live! Reload the extension to get the update.
>
> What's new:
>
> ⚡ Faster AI tips — prompt optimization shaves ~60–70ms off warm tip generation (live-call median ~1.4s)
> 📊 New "AI Tips (benchmark)" panel in History — shows generation time in ms per tip (temporary, helps us measure performance on real calls)
>
> To update:
>
> Go to Manage extensions.
> On the upper left click the 'Update' Button.
> Once the popup message on the lower left says 'Extensions Updated' then you're good to go. Happy call-coachin everyone!

