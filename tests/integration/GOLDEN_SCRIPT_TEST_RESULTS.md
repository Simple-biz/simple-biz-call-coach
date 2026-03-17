# Golden Script Pipeline Simulation - Test Results

**Date:** 2026-03-17
**Environment:** Production AWS Backend
**Endpoint:** `wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production`
**Test Duration:** ~56s
**Result:** 6/6 PASSED

## Pipeline Under Test

```
Transcripts → AWS API Gateway WebSocket → Transcript Lambda → PostgreSQL
    → getIntelligence → Intelligence Lambda → Claude Haiku Analysis
    → Claude Haiku Golden Script Matching → AI_TIP Response
```

## Simulated Conversation

16 transcripts sent representing a full sales call between an agent and a customer (Acme Plumbing).

| # | Speaker | Transcript | Stage |
|---|---------|-----------|-------|
| 1 | Agent | Good morning, can you hear me okay? | GREETING |
| 2 | Caller | Yes I can hear you. Who is this? | GREETING |
| 3 | Agent | My name is Mark, and Bob and I are here to help your company... | GREETING |
| 4 | Caller | Yeah this is Acme Plumbing. What do you want? | GREETING |
| 5 | Agent | Are you the owner or decision maker? Perfect, I wanted to reach out... | VALUE_PROP |
| 6 | Caller | Okay, what exactly do you do? | VALUE_PROP |
| 7 | Agent | We help businesses like yours rank higher on Google... | VALUE_PROP |
| 8 | Caller | We already have a website though. | OBJECTION |
| 9 | Agent | Oh okay, that is great because we also optimize websites... | OBJECTION |
| 10 | Caller | I am not interested, we are pretty busy right now. | OBJECTION |
| 11 | Agent | I totally understand, can I at least send you a free audit... | OBJECTION |
| 12 | Caller | I mean I guess, sure, what does that involve? | CLOSING |
| 13 | Agent | Perfect! Let me get your email and I will send over that free audit. | CLOSING |
| 14 | Caller | Its john at acme plumbing dot com. | CLOSING |
| 15 | Agent | Great, I will have Bob personally review your business... | CLOSING |
| 16 | Caller | Sounds good, thanks. | CLOSING |

## AI Coaching Responses (from Claude Haiku via Production Backend)

### Full Conversation Suggestion
- **Stage:** CLOSING
- **Golden Script:** "Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"

### Objection Handling
- **Stage:** OBJECTION_HANDLING
- **Golden Script:** "Yeah, that's great that you already have one because we also optimize or revamp websites, especially with SEO."

### Closing Follow-up
- **Stage:** CLOSING
- **Golden Script:** "Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"

## Test Cases

| Test | Result | Time |
|------|--------|------|
| Connect to AWS WebSocket with API key auth | PASS | <1s |
| Start conversation and receive conversationId | PASS | 384ms |
| Process full 16-message sales conversation and return AI coaching tips | PASS | 37s |
| Handle objection transcript with appropriate coaching | PASS | 6.3s |
| Handle closing transcript with email capture coaching | PASS | 6.0s |
| End conversation cleanly | PASS | 413ms |

## Observations

1. **Stage detection works correctly** - Claude Haiku identified CLOSING and OBJECTION_HANDLING stages accurately based on conversation context.
2. **Golden scripts are contextual** - The suggested scripts reference the actual conversation (website optimization, Bob's review) rather than being generic.
3. **Latency** - AI suggestion generation takes ~5-7s per `getIntelligence` request (Lambda cold start + Claude Haiku inference).
4. **Transcripts are not auto-analyzed** - The backend stores transcripts on receipt but only generates AI coaching tips when `getIntelligence` is explicitly called (matching the "Get Next Suggestion" button UX).

## How to Run

```bash
npx vitest run tests/integration/golden-script-simulation.test.ts
```

Requires a live AWS backend. Test will fail if the WebSocket endpoint is unreachable.
