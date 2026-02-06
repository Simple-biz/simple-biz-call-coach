# Tech-Spec: WebRTC Audio Capture Fix

**Created:** 2025-12-11
**Status:** Ready for Development

## Overview

### Problem Statement

The Call Coach extension is not capturing WebRTC audio from CallTools calls, resulting in:
- Empty transcriptions: `{"transcript":"","confidence":0}`
- Audio levels showing 11-13% (ambient/background noise instead of speech)
- Deepgram receiving wrong audio source (tab output instead of WebRTC streams)

**Root Cause:** The WebRTC interception architecture is correctly implemented, but has a **fatal timing/orchestration bug**:

1. CallTools establishes WebRTC connections when a call starts
2. WebRTC interceptor captures streams and content script sends `WEBRTC_STREAMS_READY` to background
3. Background receives the message but **does nothing** (coaching hasn't started yet)
4. User clicks "Start AI Coaching" later → popup sends `START_COACHING_FROM_POPUP`
5. Background's handler for `START_COACHING_FROM_POPUP` **does nothing except start keep-alive**
6. Background waits for `WEBRTC_STREAMS_READY` to trigger capture, but that message was already sent
7. **Capture never starts** → No audio → Empty transcripts

### Solution

Fix the orchestration flow to:
1. Allow background to check for pre-existing WebRTC streams when coaching starts
2. Properly trigger WebRTC capture with already-available streams
3. Add fallback detection if streams aren't available yet
4. Clean up the message flow to be more deterministic

### Scope (In/Out)

**In Scope:**
- Fix `START_COACHING_FROM_POPUP` handler in background to check for existing streams
- Add `CHECK_WEBRTC_STREAMS_STATUS` message for content script
- Update flow to handle both: streams-ready-first AND coaching-started-first scenarios
- Remove reliance on race conditions between stream detection and coaching start
- Add logging to debug stream availability

**Out of Scope:**
- Rewriting the WebRTC interceptor (it works correctly)
- Changing the Deepgram integration
- Modifying the dual-stream architecture (caller + agent)
- Tab capture fallback (focus on WebRTC only)

## Context for Development

### Codebase Patterns

**Message Flow Architecture:**
- Port-based connections: Content script ↔ Background (persistent)
- Runtime messages: Background ↔ Popup/SidePanel/Offscreen (broadcast)
- Window messages: Page context (interceptor) ↔ Content script (cross-context)

**State Management:**
- Background: Central state hub, persists to `chrome.storage.local`
- Zustand Store: React state for UI components, syncs with storage
- Content script: Maintains call detection state with debouncing

**Audio Flow:**
1. Interceptor (page context) → captures WebRTC streams → exposes via `window.__getInterceptedStreams()`
2. Content script → stores streams in `window.__webrtcStreams` → notifies background
3. Background → creates offscreen → tells offscreen to start capture
4. Offscreen → sends `GET_WEBRTC_STREAMS` to content script
5. WebRTC Bridge (content) → retrieves streams → creates AudioContext → processes to Int16 PCM
6. Bridge → sends audio via Chrome runtime port to offscreen
7. Offscreen → forwards audio to dual Deepgram WebSockets (caller + agent)

### Files to Reference

**Critical Files:**
- `src/background/index.ts:362-367` - BUG: `START_COACHING_FROM_POPUP` handler does nothing
- `src/content/index.ts:262-299` - Sends `WEBRTC_STREAMS_READY` when streams are detected
- `src/content/webrtc-bridge.ts:17-40` - Handles `GET_WEBRTC_STREAMS` message
- `src/injected/webrtc-interceptor.ts:100-115` - Checks and notifies when both streams ready
- `src/offscreen/index.ts:201-244` - WebRTC capture start flow
- `src/popup/Popup.tsx:148-227` - Coaching start button handler

**Supporting Files:**
- `src/content/index.ts:7` - Imports webrtc-bridge module
- `src/background/index.ts:351-360` - `WEBRTC_STREAMS_READY` handler
- `src/background/index.ts:560-618` - `handleWebRTCCaptureStart` function

### Technical Decisions

**Decision 1: Use Request-Response Pattern Instead of Fire-and-Forget**

Current flow relies on background passively waiting for `WEBRTC_STREAMS_READY`. This creates a race condition.

**Solution:** When `START_COACHING_FROM_POPUP` is received:
1. Background actively requests stream status from content script
2. Content script checks `window.__webrtcStreams` and responds immediately
3. If streams exist → proceed with capture
4. If streams don't exist → register a pending capture request and wait for streams

**Decision 2: Add Stream Availability Check Message**

New message type: `CHECK_WEBRTC_STREAMS_STATUS`
- Sent from background to content script (via tab)
- Content script responds with `{ available: boolean, metadata: {...} }`
- Synchronous response using `sendResponse`

**Decision 3: Support Two Initialization Paths**

Path A (Streams First): Call starts → Streams detected → User starts coaching → Use existing streams
Path B (Coaching First): User starts coaching → Request streams → Wait for detection → Use streams when ready

Both paths should work correctly.

## Implementation Plan

### Tasks

- [ ] **Task 1:** Add `CHECK_WEBRTC_STREAMS_STATUS` message handler to content script
  - Check if `window.__webrtcStreams` exists and has both remote + local
  - Return stream availability status synchronously
  - File: `src/content/index.ts`

- [ ] **Task 2:** Update `START_COACHING_FROM_POPUP` handler in background
  - Send `CHECK_WEBRTC_STREAMS_STATUS` to content script tab
  - If streams available → immediately call `handleWebRTCCaptureStart`
  - If streams not available → set pending flag and wait for `WEBRTC_STREAMS_READY`
  - File: `src/background/index.ts:362-367`

- [ ] **Task 3:** Add pending capture state to background
  - New state field: `pendingCaptureRequest: boolean`
  - Set to `true` when coaching starts but streams aren't ready
  - When `WEBRTC_STREAMS_READY` arrives, check if pending and start capture
  - File: `src/background/index.ts`

- [ ] **Task 4:** Update `WEBRTC_STREAMS_READY` handler
  - Check if `pendingCaptureRequest` is true
  - If yes → start capture immediately
  - If no → just update state (streams available for future use)
  - File: `src/background/index.ts:351-360`

- [ ] **Task 5:** Add defensive logging throughout the flow
  - Log when streams are first detected and stored
  - Log when coaching start is requested
  - Log when stream status check is performed
  - Log when capture actually initiates
  - Files: `src/background/index.ts`, `src/content/index.ts`

- [ ] **Task 6:** Handle edge case: coaching started before interceptor ready
  - If `CHECK_WEBRTC_STREAMS_STATUS` fails (interceptor not loaded)
  - Retry with exponential backoff (max 3 attempts)
  - Show error to user if interceptor never loads
  - File: `src/background/index.ts`

### Acceptance Criteria

- [ ] **AC1:** GIVEN a call is active for 10 seconds
  WHEN user clicks "Start AI Coaching"
  THEN WebRTC audio capture starts within 2 seconds
  AND transcription appears in sidepanel

- [ ] **AC2:** GIVEN user clicks "Start AI Coaching" immediately after call starts (< 1 second)
  WHEN WebRTC streams become available
  THEN capture starts automatically without user intervention
  AND transcription appears in sidepanel

- [ ] **AC3:** GIVEN WebRTC interceptor successfully hooks CallTools
  WHEN audio capture is active
  THEN audio levels show > 30% during speech
  AND transcripts contain actual spoken words (not empty)
  AND Deepgram receives dual-channel audio (caller + agent)

- [ ] **AC4:** GIVEN coaching is active on a call
  WHEN viewing browser console logs
  THEN clear trace of: interceptor ready → streams detected → coaching started → capture initiated → audio flowing → transcription received

- [ ] **AC5:** GIVEN CallTools WebRTC connection established
  WHEN checking `window.__webrtcStreams` in DevTools
  THEN both `remote` and `local` MediaStream objects exist
  AND each has at least 1 audio track
  AND tracks are in "live" state (not "ended")

## Additional Context

### Dependencies

- Chrome Extension APIs: `chrome.tabs.sendMessage`, `chrome.runtime.sendMessage`
- WebRTC API: `RTCPeerConnection` proxy pattern (already implemented)
- Deepgram WebSocket API (already configured)

### Testing Strategy

**Unit Testing:**
- Test message handlers in isolation
- Mock `chrome.tabs.sendMessage` responses
- Verify state transitions

**Integration Testing:**
1. Load extension in Chrome with DevTools open
2. Navigate to CallTools.io
3. Start an outbound call
4. Wait 10 seconds (let WebRTC fully establish)
5. Open extension popup → Click "Start AI Coaching"
6. Check console logs for flow trace
7. Verify transcription appears in sidepanel
8. Verify audio levels > 30% during speech

**Edge Case Testing:**
- Start coaching immediately after call starts (< 1 sec)
- Start coaching while call is ringing (before connection)
- Refresh CallTools page during active coaching
- Start multiple calls back-to-back without stopping coaching

### Notes

**Why the bug wasn't caught earlier:**
The architecture assumes a specific ordering: coaching starts → streams detected → capture begins. This works if the user clicks "Start Coaching" before CallTools establishes WebRTC. But in normal usage, calls establish instantly, so streams are ALWAYS ready before coaching starts.

**Alternative approach considered but rejected:**
Remove `WEBRTC_STREAMS_READY` entirely and have background poll content script. Rejected because:
- Polling is inefficient
- Event-driven architecture is cleaner
- Just need to handle both orderings correctly

**Debugging tips:**
- Check `window.__webrtcStreams` in CallTools tab console
- Verify interceptor loaded: `window.__getInterceptedStreams` should exist
- Look for "AUDIO_TRACKS_READY" message in content script logs
- Background should show clear capture initiation logs

---

## Implementation Notes for Developer

**Where to start:**
1. Read background's `START_COACHING_FROM_POPUP` handler (line 362)
2. Add the stream status check message to content script
3. Update background to use request-response pattern
4. Test with DevTools console open to verify flow

**Critical debugging locations:**
- Content script console: WebRTC interceptor logs
- Background service worker console: State transitions
- Offscreen document console: Audio levels and Deepgram responses

**Success looks like:**
Console logs showing this sequence:
```
[Content] AUDIO_TRACKS_READY (both streams detected)
[Popup] Start coaching clicked
[Background] Checking stream availability...
[Content] Streams available: true
[Background] Starting WebRTC capture with existing streams
[Offscreen] WebRTC capture started
[Offscreen] Audio data flowing (caller + agent)
[Offscreen] Deepgram: INTERIM transcription
[Offscreen] Deepgram: FINAL transcription
```
