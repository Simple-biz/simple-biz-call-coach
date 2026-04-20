# Call Coach Chrome Extension — End of Day Report

**Date:** April 17, 2026
**Developer:** Kayser B
**Project:** DevAssist-Call-Coach

---

## Session Overview

**Focus:** Ship OpenAI fallback (issue #63, planned 2026-04-15) plus a late addition — AI receptionist behavior tuning.

**Outcome:** 1 PR merged (#65), version bumped to 2.2.6, Lambda redeployed with OpenAI failover live. 14 files changed, ~7,845 insertions.

---

## Accomplishments

### 1. ✅ PR #65 — OpenAI Failover Infrastructure (v2.2.6)

**Commit:** `8c792be` → merged as `af695c0`
**Issue closed:** #63 (OpenAI Fallback for AI Tip & Intelligence Generation)

**Problem being solved:** Anthropic Claude API experienced downtime earlier in the week. Entire AI coaching feature went offline — both tip generation and intelligence analysis stopped working. No fallback existed.

**Solution:** Added OpenAI (gpt-4.1-mini) as an automatic fallback for both Haiku-dependent features. Fully parity — same output format, same parsers, zero UI changes.

#### Files Added

| File | Lines | Purpose |
|------|:-----:|---------|
| `infra/lib/lambda/shared/openai-client.ts` | +369 | OpenAI SDK wrapper (streaming tips + JSON intelligence via structured outputs) |
| `infra/lib/lambda/shared/fallback-utils.ts` | +84 | `shouldFallback()`, `withTimeout()`, `logFallback()`, env flags for testing |
| `tests/perf/verify-openai-fallback.mjs` | +208 | Local OpenAI verification test |

#### Files Modified

| File | Change |
|------|--------|
| `infra/lib/lambda/shared/claude-client-optimized.ts` | Split into public wrapper + internal Anthropic impl; fallback before first chunk |
| `infra/lib/lambda/shared/intelligence-client.ts` | Wrapped with try/timeout/fallback to OpenAI |
| `infra/lib/websocket-stack.ts` | Added `OPENAI_API_KEY` to Secrets Manager + `OPENAI_MODEL` + `ANTHROPIC_TIMEOUT_MS` env vars |
| `infra/bin/infra.ts` | Read + validate `OPENAI_API_KEY` env var |
| `.env.production.template` | Added `OPENAI_API_KEY` placeholder |
| `package.json`, `vite.config.ts`, `src/background/index.ts` | Version bump 2.2.5 → 2.2.6 |

#### Fallback Trigger Logic

- **5xx status codes** (500, 502, 503, 504, 529 Anthropic overloaded)
- **Timeouts** (default 5s, configurable via `ANTHROPIC_TIMEOUT_MS`)
- **Connection errors** (ECONNRESET, ENOTFOUND, ETIMEDOUT, ECONNREFUSED)
- **Does NOT fall back on** 4xx client errors or 429 rate limits (those are our bugs or require backoff)

#### Key Architectural Decision

Only fall back to OpenAI **before the first chunk is emitted** to the client. This prevents mid-stream dual-output where partial Anthropic text would be followed by full OpenAI text. Partial responses are accepted as "real enough."

#### Model Change from Plan

Original plan specified `gpt-4o-mini`. Shipped with `gpt-4.1-mini` instead — slightly cheaper and comparable quality for structured output tasks.

#### Testing Flags Baked In

- `FORCE_OPENAI_FALLBACK=true` — skip Anthropic entirely, use OpenAI directly (Phase 1 testing)
- `FAIL_ANTHROPIC_CALLS=true` — throw synthetic 500 to exercise fallback path (Phase 2 testing)
- Both default OFF

---

### 2. ✅ AI Receptionist Behavior Tuning

Late addition to the PR — not in the original #63 scope. Improves how the AI handles calls that hit an automated receptionist / gatekeeper instead of the business owner.

**Problem:** When call hits a receptionist (AI or human), the coach was still suggesting discovery questions and asking for business owner names — not appropriate for a gatekeeper.

**Solution:**

1. **Regex detection** of receptionist phrasing in transcript:
   ```
   "ai receptionist", "virtual receptionist", "automated system",
   "assisting with appointments", "how can i assist you",
   "team call you back", "team reach out"
   ```

2. **When detected, inject hard rule into the prompt:**
   ```
   🚨 RECEPTIONIST MODE DETECTED (hard rule):
   - Customer is a gatekeeper/AI receptionist, not the business owner
   - Do NOT ask for owner/business name or run discovery questions
   - Keep asks operational only: transfer to owner/manager OR callback routing
   ```

3. **Example scripts added:**
   - *"Of course, no worries — could you connect me with whoever handles website decisions real quick?"*
   - *"No problem at all — can you pass a quick message that Bob's website team called?"*

4. **Always-included scripts:** `SCRIPTS_AI_RECEPTIONIST` is now prepended to every stage-filtered bundle so the receptionist handling is always available, not just on greeting stages.

---

## Performance & Behavior Status

### Anthropic Primary Path (unchanged)

- TTFC: ~1100-1300ms warm
- Total: ~2100-2300ms warm
- 3s CEO target: PASS

### OpenAI Fallback Path (verified locally)

- Parses correctly with existing `[HEADING]:[STAGE]:[CONTEXT]:[SCRIPT]:` regex
- Structured outputs mode ensures valid JSON for intelligence
- Latency: ~1.2-2.8s end-to-end (within 5s timeout budget)
- Only fires on real Anthropic failures (5xx/timeout)

---

## Verification Completed

- [x] Local verification via `tests/perf/verify-openai-fallback.mjs` — all scenarios parse correctly
- [x] Anthropic primary path smoke-tested post-deploy — no regressions
- [x] `FORCE_OPENAI_FALLBACK=true` flag tested against deployed Lambda (Cobb granted temp env var)
- [x] All 10 existing verification scenarios pass with both providers
- [x] CloudWatch log line `[FALLBACK]` confirmed on triggered fallback

---

## Collaboration Notes

- **Coordination with Cobb (senior):** Reviewed plan before implementation, granted temp IAM/Console access to set `FORCE_OPENAI_FALLBACK` env var for Phase 1 testing

---

## PR Merged

| PR | Title | Version |
|----|-------|---------|
| [#65](https://github.com/Simple-biz/simple-biz-call-coach/pull/65) | feat(fallback): add OpenAI failover and parity tuning | 2.2.6 |

Deployed to production via `cdk deploy DevAssist-WebSocket`.

---

## Decisions Made

1. **Model: `gpt-4.1-mini` (not `gpt-4o-mini` as originally planned)** — slightly cheaper, similar quality for structured output
2. **Only fall back before first chunk** — avoids mid-stream dual-output edge case
3. **Silent fallback, no UI indicator** — agent should never know which provider answered; cleanest UX
4. **Receptionist handling as regex-triggered hard rule** — rather than stage-based, since receptionist can appear at any point
5. **AI_RECEPTIONIST scripts always loaded** — ensures the coach can pivot to receptionist mode regardless of detected stage

---

## Notes

- Fallback is silent by design — monitor CloudWatch Logs with filter `[FALLBACK]` to track when it fires
- Cost spike protection: consider adding a CloudWatch alarm on `[FALLBACK]` frequency (>100/hour) to catch extended Anthropic outages
- Both testing env flags (`FORCE_OPENAI_FALLBACK`, `FAIL_ANTHROPIC_CALLS`) should remain OFF in production
