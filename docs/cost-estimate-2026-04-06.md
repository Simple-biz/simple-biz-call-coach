# AI Coaching Cost Estimate

**Date:** April 7, 2026 (updated)
**Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
**Config:** 5s cache TTL, 15 transcript context window, max 150 output tokens, **instant pre-fetch enabled**

---

## Haiku 4.5 API Pricing

| | Per 1M Tokens | With Prompt Caching |
|--|--------------|-------------------|
| Input | $1.00 | $0.10 (90% savings) |
| Output | $5.00 | $5.00 (no change) |

---

## Per Claude Call

| Component | Tokens | Cost |
|-----------|--------|------|
| System prompt (golden scripts + rules) | ~1,800 | $0.0018 |
| Context (15 transcripts) | ~400 | $0.0004 |
| Output (coaching tip) | ~80 | $0.0004 |
| **Total per tip request** | **~2,280** | **~$0.0026** |

---

## Actual AWS Usage (Mar 31 – Apr 6, 2026)

Data pulled from CloudWatch metrics on the `IntelligenceHandler` Lambda.

| Date | Calls Started | Tip Requests | Transcripts | Errors | Avg Duration |
|------|--------------|-------------|-------------|--------|-------------|
| Mar 31 | 7 | 85 | 158 | 0 | 2,687ms |
| Apr 1 | 31 | 204 | 472 | 0 | 2,378ms |
| Apr 2 | 19 | 92 | 246 | 0 | 2,624ms |
| Apr 5 | 4 | 22 | 37 | 0 | 2,487ms |

**Key ratios (Apr 1, busiest day):**
- ~6.6 tip clicks per call
- ~15 transcript rows per call
- 0 errors post-Sonnet-404 fix

**Estimated Anthropic cost for Apr 1:**
- Input: 204 × ~2,400 tokens = ~490K → $0.49
- Output: 204 × ~150 tokens = ~31K → $0.15
- **Total: ~$0.64** (31 calls, likely 1 agent over ~4hr shift)

---

## Projected Cost Per Agent

### Without Pre-Fetch (manual-click only, previous behavior)

| Timeframe | Standard | With Prompt Caching |
|-----------|----------|-------------------|
| Per hour | $0.16 | $0.05 |
| Per day (8hr shift) | $1.28 | $0.40 |
| Per month (20 days) | $25.60 | $8.00 |

### With Pre-Fetch (instant tips, current behavior)

Pre-fetch generates tips every 5s + on every new transcript during active calls.
Estimated ~12 Claude calls/min during active conversation (vs ~1/min manual-only).

| Timeframe | Standard | With Prompt Caching |
|-----------|----------|-------------------|
| Per hour | $0.55 | $0.18 |
| Per day (8hr shift) | $4.40 | $1.44 |
| Per month (20 days) | $88.00 | $28.80 |

### At Scale (Pre-Fetch, Standard)

| Agents | Monthly (Standard) | Monthly (Cached) |
|--------|-------------------|-----------------|
| 1 | $88.00 | $28.80 |
| 5 | $440.00 | $144.00 |
| 10 | $880.00 | $288.00 |
| 25 | $2,200.00 | $720.00 |
| 50 | $4,400.00 | $1,440.00 |

---

## AWS Infrastructure Costs (estimated)

| Service | Monthly Cost |
|---------|-------------|
| Lambda (IntelligenceHandler) | < $2.00 |
| API Gateway WebSocket | < $2.00 |
| DynamoDB | < $1.00 |
| **Total AWS infra** | **< $5.00/mo** |

Infrastructure costs are negligible compared to Anthropic API usage.

---

## Cost Optimization Options

1. **Prompt caching** — System prompt is identical every call. Caching drops input cost by 90%. **Recommended — biggest win.**
2. **Reduce pre-fetch frequency** — Change from 5s to 10s interval to halve background calls. Trade-off: tips may be slightly staler.
3. **Batch API** — 50% off both input/output. Only viable if tips don't need real-time delivery (not recommended for live coaching).

---

## Notes

- **Pre-fetch enabled**: Tips are generated every 5s and on every new transcript. Button click serves cached tip instantly (0ms delay).
- **Transcript invalidation**: Cached tip is discarded and regenerated whenever a new final transcript arrives, ensuring tips always reflect latest conversation.
- Deepgram transcription costs are separate (billed by Deepgram, not included here)
- All baseline figures based on actual production usage data from CloudWatch (Mar 31 – Apr 6)
- Pre-fetch projections are estimates based on 5s interval + ~2 final transcripts per 10s during active calls
