# AI Tip Generation — Latency Analysis & Optimization Options

Analysis of "Get Next AI Suggestion" performance and paths to reduce latency.

---

## Current Baseline (Measured)

Tested against production AWS infrastructure with 6 tip requests on a realistic 10-turn sales call transcript.

| Metric | Value |
|--------|:-----:|
| **TTFC (time to first word visible)** | 1251ms |
| **Total time (full tip ready)** | 2283ms |
| Stream duration (first → last chunk) | 826ms |
| Chunks delivered per tip | ~5 |
| Avg inter-chunk gap | 204ms |
| Worst case (p95) | 3078ms |
| Cold start outlier | up to 3976ms |

### Where the time goes (warm path)

```
Network client → Lambda:       ~80ms
Lambda routing + DynamoDB:     ~30ms
Prompt construction:           ~5ms
Claude TTFT (waiting):         ~1135ms  ← biggest chunk
─────────────────────────────────────
TTFC total:                    ~1250ms
─────────────────────────────────────
Streaming (Claude output):     ~825ms
WebSocket chunk hops:          ~50ms
Final processing:              ~10ms
─────────────────────────────────────
TOTAL:                         ~2285ms
```

**Bottleneck:** Claude's TTFT (~1.1s) dominates. Most optimizations target this.

---

## Optimization Options

### Tier 1 — Quick wins (low risk, low effort)

#### 1. Trim conversation window (20 → 8 turns)

**What:** Reduce the rolling transcript sent to Claude from 20 turns to 8.

**Why safe:** Established facts, entity extraction, intelligence summary, and previous suggestions are all preserved via separate in-memory Lambda caches. Within a 2-minute call, Lambda stays warm and all context survives.

**Impact:**

| Metric | Before | After |
|--------|:------:|:-----:|
| TTFC | 1251ms | **~1050ms** |
| Total | 2283ms | **~2080ms** |
| Savings | — | ~200ms (~10%) |

**Effort:** 1 line change. `contextWindow = 20` → `contextWindow = 8`

**Risk:** Minimal. Only affects calls longer than the Lambda container warm window (~5-15 min), which doesn't happen within a 2-min call.

---

#### 2. Smaller chunk buffer (20 → 5 chars)

**What:** Flush streamed tokens to the client every 5 characters instead of every 20.

**Impact on total time:** None — the tip completes at the same moment.

**Impact on perceived speed:** First word appears ~400ms sooner. "ChatGPT-style" typing effect.

| Metric | Before | After |
|--------|:------:|:-----:|
| TTFC | 1251ms | **~850ms** |
| Total | 2283ms | 2283ms (unchanged) |
| User feel | chunky | smooth typing |

**Effort:** 1 line change.

**Risk:** Slightly more WebSocket messages. Negligible AWS cost (~fractions of a cent per call).

---

#### 3. Pre-warm prompt cache at call start

**What:** Fire a dummy Claude request when a call begins to warm the ephemeral prompt cache.

**Impact:** Saves ~50-100ms on the first real tip request.

**Effort:** ~20 lines.

**Cost:** ~$0.001 per call.

---

### Tier 2 — Medium wins (moderate effort)

#### 4. Provisioned Lambda concurrency

**What:** Reserve 1-2 always-warm Lambda instances.

**Impact:** Eliminates cold start spikes (up to 1500ms savings on first request after idle).

| Metric | Before | After |
|--------|:------:|:-----:|
| Worst case (p95) | 3078ms | **~2200ms** |
| Cold start spikes | up to 4000ms | **eliminated** |

**Effort:** CDK config change, ~1 hour.

**Cost:** ~$15-25/month per reserved instance.

---

#### 5. Pattern-matched templates for common scenarios

**What:** Pre-compile known-good responses for recurring patterns ("how much does it cost", "I'm not interested", greetings). Pattern-match the latest caller transcript and serve the template instantly. Fall back to Claude only for novel situations.

**Impact:** ~0ms latency for 30-40% of clicks (pattern matches). Other 60% unchanged.

**Effort:** 2-3 days (template authoring, pattern matching logic, fallback).

**Risk:** If patterns match too aggressively, AI feels canned. Needs careful tuning.

---

### Tier 3 — Major overhaul (model swap)

#### Provider speed comparison for ~80-token tip

| Provider / Model | TTFT | Output speed | Total tip time | Quality | Reliability |
|------------------|:----:|:------------:|:--------------:|:-------:|:-----------:|
| **Cerebras (Llama 3.3 70B)** | ~150ms | ~2000 tok/s | **~250ms** | High | Newer |
| **Groq (Llama 3.3 70B)** | ~300ms | ~275 tok/s | **~600ms** | High | Mature |
| **Groq (Llama 3.1 8B)** | ~150ms | ~750 tok/s | **~250ms** | Medium | Mature |
| **GPT-4.1 nano** | ~600ms | ~150 tok/s | ~1300ms | High | Proven |
| **GPT-4o-mini** | ~700ms | ~110 tok/s | ~1500ms | High | Proven |
| **GPT-4o-mini + Predicted Outputs** | ~500ms | effective ~200 tok/s | **~1000ms** | High | Proven |
| **Gemini 2.0 Flash** | ~400ms | ~250 tok/s | ~750ms | High | Proven |
| **Claude Haiku 4.5 (current)** | ~1100ms | ~120 tok/s | **~1900ms** | High | Proven |
| **Claude Sonnet 4.5** | ~1500ms | ~80 tok/s | ~2500ms | Highest | Proven |

#### Why Groq/Cerebras are so much faster

Specialized inference hardware (LPUs / wafer-scale chips) vs standard NVIDIA GPUs used by OpenAI and Anthropic. Structural advantage that the traditional providers can't match without their own hardware.

#### OpenAI's Predicted Outputs feature

Our tips have a fixed structure:
```
[HEADING]: <2 words>
[STAGE]: <enum>
[CONTEXT]: <one sentence>
[SCRIPT]: "<the actual tip>"
```

~30-40% of output is predictable markers. OpenAI's Predicted Outputs feature lets us hint these structural portions, generating them ~3× faster. Usable only with GPT-4o / GPT-4o-mini.

---

## Stacking Strategy

### Cumulative impact for "Get Next AI Suggestion"

| Stage | TTFC | Total | Cost | Effort |
|-------|:----:|:-----:|:----:|:------:|
| **Today** | 1251ms | 2283ms | baseline | — |
| + Trim window (20→8) | 1050ms | 2085ms | $0 | 5 min |
| + Smaller chunk buffer | 850ms | 2085ms | $0 | 5 min |
| + Pre-warm cache | 800ms | 1985ms | ~$0.001/call | 30 min |
| + Provisioned concurrency | 750ms | 1900ms | ~$20/mo | 1 hr |
| + Pattern templates (30% hit rate) | 550ms avg | 1400ms avg | $0 | 2-3 days |
| + Swap to Groq Llama 3.3 | 200ms | 600ms | -40% cost | 1-2 days |
| **All stacked** | **~200ms** | **~600ms** | net savings | ~1 week |

---

## Decision Framework

### If the goal is "ship a fix this week"

1. Trim conversation window (5 min)
2. Smaller chunk buffer (5 min)
3. Pre-warm prompt cache (30 min)

**Result:** 1251ms → ~800ms TTFC, 2283ms → ~1985ms total. ~36% perceived speed improvement. Zero infra risk.

### If the goal is "sub-second feel"

Add to the above:
4. Swap to Groq Llama 3.3 70B with Haiku fallback (1-2 days, A/B test quality first)

**Result:** ~300ms TTFC, ~600ms total. Feels instant. Requires validation of tip quality against Claude baseline.

### If the goal is "absolute fastest regardless of risk"

5. Swap to Cerebras Llama 3.3 (newer, less battle-tested)

**Result:** ~150ms TTFC, ~250ms total. True real-time feel. Accept reliability tradeoff.

---

## Quality vs Speed Tradeoff

Before any model swap, validate quality:

- A/B test against 50 representative calls
- Compare tip acceptance rate (does the agent actually use it?)
- Compare adherence to golden scripts
- Monitor tone/authenticity complaints from sales team
- Keep Haiku as fallback for 30 days post-switch

Cheaper providers mean nothing if tip quality degrades and agents stop trusting the coach.

---

## Worth Reading

- Test script: `tests/perf/tip-generation-test.mjs`
- Full WebSocket latency test: `tests/perf/ws-latency-test.mjs`
- Lambda intelligence handler: `infra/lib/lambda/intelligence/index.ts`
- Claude client: `infra/lib/lambda/shared/claude-client-optimized.ts`
