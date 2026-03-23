# Call Coach — Auto-Dial Campaign Fix Report

**Date:** March 20, 2026
**Branch:** `fix/autodial-campaign-coaching`

---

## Problem Statement

Manual dialing worked perfectly with the Call Coach extension, but auto-dial campaigns (where agents join a campaign and the system dials leads automatically) did not trigger coaching — no transcription, no AI suggestions, no intelligence updates.

---

## Why Manual Dial Worked

Manual dial uses **DOM detection**. When an agent clicks a number in CallTools:

1. The CallTools UI shows a timer, hangup button, and "On a Call" status
2. The content script detects these DOM elements every 2 seconds
3. After 3 confirmations (~6 seconds), it sends `CALL_STARTED` to the background
4. Background starts capture → offscreen document → Deepgram → AI backend

This path was fully wired and reliable because the DOM elements are consistent for manual calls.

---

## Why Auto-Dial Failed — Four Stacked Problems

### Problem 1: Dead Webhook URL

- **Cause:** The CallTools webhook (HttpRequest #767) was pointing to `https://ntfsuy-ip-112-201-65-219.tunnelmole.net/webhook/calltools` — a temporary tunnel URL from an earlier dev session that had expired
- **Effect:** CallTools fired webhooks for every auto-dial call, but they went to a dead endpoint — silently lost
- **Fix:** Updated the webhook URL to the permanent AWS Lambda URL: `https://bs4esfiod22hjsl3qezeoeutci0kvfnq.lambda-url.us-east-1.on.aws/`

### Problem 2: Lambda Crashed on Auto-Dial Payloads

- **Cause:** Auto-dial sends partial webhook payloads — fields like `destination`, `source`, `call_type`, `start` arrive as `null` or `undefined`. The Lambda's `storeCallEvent` function tried to store `{ S: undefined }` in DynamoDB, which threw `TypeError: Cannot read properties of undefined`
- **Effect:** The webhook hit the Lambda but the Lambda crashed before it could broadcast the event to the extension
- **Evidence:** Lambda logs showed `[Webhook] Processing call.started for agent unknown` followed immediately by `Error storing event: TypeError`
- **Fix:** Made all DynamoDB fields optional — only store fields that have values

### Problem 3: Extension Never Started Coaching from Webhook

- **Cause:** The webhook `CALL_STARTED` handler in the background worker set `isOnCall: true` and broadcast `CALL_DETECTED` to the UI, but **never called `startCaptureAndCoaching()`**. The DOM detection path had this wired up (checking `coachingPending` and auto-starting), but the webhook path was missing it
- **Effect:** The call was "detected" via webhook but no offscreen document was created, no Deepgram connection, no transcription, no AI — nothing actually started
- **Fix:** Added `startCaptureAndCoaching()` call to the webhook handler when `coachingPending` is true. Also kept `coachingPending` armed between auto-dial calls so back-to-back campaign calls auto-start

### Problem 4: Webhook Flood from Other Agents

- **Cause:** CallTools sends `app_user_id: null` for auto-dial calls — there's no way to identify which agent the call belongs to from the webhook payload. The Lambda fell back to broadcasting to ALL connected extensions. Every agent in the campaign received every other agent's `CALL_STARTED` events — hundreds per minute
- **Effect:** The extension was flooded with `STATUS_UPDATE` messages. If the extension tried to act on these, it would falsely trigger coaching for another agent's call. After call end, a stray webhook could immediately start a new false session
- **Fix:** Implemented destination phone number matching:
  - Content script extracts the dialed number from CallTools DOM every 500ms
  - Reports it to background as `expectedDestination`
  - When a webhook `CALL_STARTED` arrives, background matches `destination` from the webhook against `expectedDestination`
  - Only matching webhooks trigger coaching — all others are silently ignored
  - Also suppressed `CALL_STARTED` webhook logs to reduce console noise

---

## What's Working Now

| Feature | Manual Dial | Auto-Dial Campaign |
|---------|------------|-------------------|
| Call Detection | DOM (timer/hangup/status) | DOM + Webhook destination matching |
| Transcription | Working | Working |
| Intelligence (auto 10s) | Working | Working |
| AI Suggested Line | Working (on click) | Working (on click) |
| Entity Extraction | Working | Working |
| Multi-call campaigns | N/A | Coaching stays armed between calls |
| Webhook flood protection | N/A | Silently ignores other agents' calls |

---

## Detection Flow Summary

### Manual Dial

1. Agent enters number → content script reads it (500ms polling)
2. Agent clicks dial → DOM elements appear → content script detects call (~6s)
3. `CALL_STARTED` sent to background → coaching starts
4. Webhook arrives → enriches call with `callToolsCallId` (but doesn't re-trigger)

### Auto-Dial Campaign

1. Agent clicks "Start AI Coaching" → `coachingPending = true`
2. Agent joins campaign → auto-dialer shows number in preview
3. Content script reads number from DOM (500ms) → `expectedDestination` set
4. Auto-dialer connects → DOM detects call → coaching starts
5. OR: Webhook fires with matching destination → instant coaching start
6. Call ends → `coachingPending` stays armed → next auto-dial auto-starts

---

## Files Changed

| File | Change |
|------|--------|
| `infra/lib/lambda/webhook/index.ts` | Handle partial payloads, split 401/403 auth, raw payload logging |
| `src/background/index.ts` | Webhook destination matching, auto-start from webhook, keep coaching armed, async listener |
| `src/content/index.ts` | `extractDestinationNumber()`, 500ms destination polling, `all_frames: true` |
| `src/services/aws-websocket.service.ts` | Suppress CALL_STARTED log noise |
| `vite.config.ts` | Added `all_frames: true` for iframe support |
| CallTools API (HttpRequest #767) | Updated webhook URL to permanent AWS Lambda |

---

## Remaining Considerations

- **Webhook flood:** The Lambda still broadcasts to all connections when `agentId === 'unknown'`. A future optimization would be to filter server-side by matching the WebSocket connection's agent identity against the webhook payload. For now, client-side destination matching handles this.
- **Stale DynamoDB connections:** The Lambda tries to broadcast to ~10 stale WebSocket connections (GoneException). These should be cleaned up on disconnect. Not blocking but wastes Lambda execution time.
- **Auto-dial DOM detection:** The `all_frames: true` fix ensures content script runs in iframes, which may be needed if CallTools campaign UI uses iframes. Not yet confirmed if auto-dial actually needs this.
