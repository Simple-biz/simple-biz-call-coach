# Tech-Spec: WebRTC Audio Capture Fix (DEMO/POC)

**Created:** 2025-12-11
**Status:** Implementation Complete - Ready for Testing
**Mode:** DEMO/POC - Prove feasibility, not production-ready

## Overview

### Problem Statement

Call Coach extension is not capturing WebRTC audio from CallTools calls for live transcription.

**Root Cause:** Timing/orchestration bug in message flow between components:

1. CallTools call starts → WebRTC interceptor captures streams → sends `AUDIO_TRACKS_READY` message
2. Background receives message but **does nothing** (coaching hasn't started yet)
3. User clicks "Start AI Coaching" later → Background handler **does nothing** (just starts keep-alive)
4. Background waits for `AUDIO_TRACKS_READY` but that message already fired
5. **Capture never starts** → No audio → Empty transcriptions

**Evidence:**
- WebRTC interceptor correctly captures remote (caller) + local (agent) streams ✅
- Audio processing pipeline (Float32 → Int16) works ✅
- Deepgram connection stable ✅
- Message flow has race condition ❌

### Solution

Fix background to **actively check for existing streams** when coaching starts:

1. User clicks "Start Coaching" → Background sends `CHECK_WEBRTC_STREAMS_STATUS` to content script
2. Content script checks `window.__webrtcStreams` and responds immediately
3. If streams exist → Background starts WebRTC capture with pre-existing streams
4. If streams don't exist → Set pending flag, wait for `AUDIO_TRACKS_READY`, then start capture

**Simplified for Demo:** Assume user waits 5-10 seconds after call starts before clicking "Start Coaching" (streams will always be ready).

### Scope (In/Out)

**In Scope:**
- Fix `START_COACHING_FROM_POPUP` handler to check for existing streams
- Add `CHECK_WEBRTC_STREAMS_STATUS` message to content script
- Update flow to handle streams-ready-first scenario (most common)
- Basic logging to verify flow works

**Out of Scope (Demo Simplifications):**
- ❌ Retry logic if interceptor not ready
- ❌ Page refresh handling
- ❌ Multiple back-to-back calls
- ❌ Graceful error messages (console.log is fine)
- ❌ State persistence across sessions
- ❌ Edge case: coaching started before streams ready (require 10sec wait for demo)

## Context for Development

### Current Architecture (Already Built)

**WebRTC Interception:**
- `src/injected/webrtc-interceptor.ts` - Proxies `RTCPeerConnection` in page context
- Captures remote (caller) + local (agent mic) audio tracks
- Exposes `window.__getInterceptedStreams()` accessor
- Posts `AUDIO_TRACKS_READY` message when both streams detected

**Audio Processing:**
- `src/content/webrtc-bridge.ts` - Handles `GET_WEBRTC_STREAMS` message
- Retrieves streams via `window.__webrtcStreams`
- Creates AudioContext + ScriptProcessor nodes
- Converts Float32 → Int16 PCM
- Streams audio to offscreen via Chrome runtime port with speaker labels

**Message Flow:**
- Port-based: Content script ↔ Background (persistent)
- Runtime messages: Background ↔ Popup/Sidepanel/Offscreen (broadcast)
- Window messages: Interceptor (page context) ↔ Content script (cross-context)

### Files to Modify

**Critical:**
- `src/background/index.ts:362-367` - `START_COACHING_FROM_POPUP` handler (currently does nothing)
- `src/content/index.ts:262-299` - Add `CHECK_WEBRTC_STREAMS_STATUS` handler
- `src/background/index.ts:351-360` - `WEBRTC_STREAMS_READY` handler (optional enhancement)

**Reference Only:**
- `src/injected/webrtc-interceptor.ts` - Already working, no changes
- `src/content/webrtc-bridge.ts` - Already working, no changes
- `src/offscreen/index.ts` - Already working, no changes

## Implementation Plan

### Tasks (Demo-Simplified)

- [x] **Task 1:** Add `CHECK_WEBRTC_STREAMS_STATUS` message handler to content script
  - Check if `window.__webrtcStreams` exists and has both remote + local
  - Return `{ available: boolean, remote: boolean, local: boolean }` synchronously
  - Location: `src/content/index.ts` (add to existing message listener)
  - **COMPLETED:** Handler added at lines 448-466

- [x] **Task 2:** Fix `START_COACHING_FROM_POPUP` handler in background
  - Send `CHECK_WEBRTC_STREAMS_STATUS` to active tab
  - Wait for response (use sendResponse callback)
  - If streams available → call `handleWebRTCCaptureStart()` immediately
  - If streams NOT available → log warning (demo assumes 10sec wait, so this shouldn't happen)
  - Location: `src/background/index.ts:362-367`
  - **COMPLETED:** Handler replaced at lines 362-395 with full stream check logic

- [x] **Task 3:** Add basic logging throughout flow
  - Content script: Log when streams are first detected
  - Background: Log when coaching start requested
  - Background: Log stream availability check result
  - Background: Log when capture initiation called
  - Keep logs emoji-prefixed for easy filtering (🎤, 📞, ✅, ❌)
  - **COMPLETED:** Enhanced logging throughout, including "AUDIO_TRACKS_READY" message at line 263

### Acceptance Criteria (Demo)

**Primary Success:**
- [ ] **AC1:** GIVEN a call is active for 10 seconds
  WHEN user clicks "Start AI Coaching"
  THEN WebRTC audio capture starts within 2 seconds
  AND live transcription appears in sidepanel within 5 seconds

**Validation:**
- [ ] **AC2:** GIVEN WebRTC interceptor successfully hooks CallTools
  WHEN viewing `window.__webrtcStreams` in console
  THEN both `remote` and `local` MediaStream objects exist
  AND each has at least 1 live audio track

**Evidence:**
- [ ] **AC3:** GIVEN coaching is active on a call
  WHEN viewing browser console logs
  THEN see clear sequence:
  ```
  [Content] AUDIO_TRACKS_READY
  [Popup] Start coaching clicked
  [Background] Checking stream availability
  [Content] Streams available: true
  [Background] Starting WebRTC capture
  [Offscreen] Audio data flowing
  [Offscreen] Deepgram transcription received
  ```

## Implementation Steps (Simplified)

### Step 1: Add Stream Status Check to Content Script

In `src/content/index.ts`, add handler to existing message listener:

```typescript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_WEBRTC_STREAMS_STATUS') {
    console.log('🔍 [Content] Checking WebRTC stream availability')

    const streams = (window as any).__webrtcStreams
    const available = !!(streams?.remote && streams?.local)

    console.log(`✅ [Content] Streams available: ${available}`, {
      remote: !!streams?.remote,
      local: !!streams?.local
    })

    sendResponse({
      available,
      remote: !!streams?.remote,
      local: !!streams?.local
    })

    return true // Keep channel open for async response
  }

  // ... existing handlers
})
```

### Step 2: Fix START_COACHING_FROM_POPUP Handler

In `src/background/index.ts`, replace current handler (~line 362-367):

```typescript
if (message.type === 'START_COACHING_FROM_POPUP') {
  console.log('📞 [Background] Coaching start requested from popup')

  // Check if WebRTC streams are already available
  const tabId = sender.tab?.id
  if (!tabId) {
    console.error('❌ [Background] No tab ID available')
    return
  }

  console.log('🔍 [Background] Checking for existing WebRTC streams...')

  chrome.tabs.sendMessage(
    tabId,
    { type: 'CHECK_WEBRTC_STREAMS_STATUS' },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ [Background] Stream check failed:', chrome.runtime.lastError)
        return
      }

      console.log('✅ [Background] Stream status:', response)

      if (response?.available) {
        console.log('🎤 [Background] Streams ready - starting capture')
        handleWebRTCCaptureStart(tabId)
      } else {
        console.warn('⚠️ [Background] Streams not available yet (user should wait 10sec)')
        // For demo: don't implement pending logic, just warn
      }
    }
  )

  // Existing keep-alive logic
  startServiceWorkerKeepAlive()
}
```

### Step 3: Add Diagnostic Logging

**In `src/content/index.ts` (stream detection):**
```typescript
// When AUDIO_TRACKS_READY is received from interceptor
console.log('🎉 [Content] AUDIO_TRACKS_READY - both caller + agent streams detected')
```

**In `src/background/index.ts` (capture start):**
```typescript
// At start of handleWebRTCCaptureStart function
console.log('🚀 [Background] handleWebRTCCaptureStart called for tab:', tabId)
```

## Testing Strategy (Demo)

### Manual Testing Flow

1. **Setup:**
   - Build extension: `npm run build`
   - Load unpacked in Chrome from `dist/` folder
   - Open DevTools (Service Worker + CallTools tab consoles side-by-side)

2. **Test Sequence:**
   ```
   1. Navigate to calltools.io
   2. Start an outbound call
   3. Wait 10 seconds (let WebRTC fully establish)
   4. Check console: should see "AUDIO_TRACKS_READY"
   5. Open extension popup
   6. Click "Start AI Coaching"
   7. Verify console sequence:
      - "Checking stream availability"
      - "Streams available: true"
      - "Starting WebRTC capture"
      - "Audio data flowing"
   8. Open sidepanel
   9. Verify live transcription appears within 5 seconds
   10. Speak during call - verify transcription updates
   ```

3. **Success Criteria:**
   - See live transcription of actual speech (not empty)
   - Audio levels > 30% during speech (not 11-13% ambient noise)
   - Both caller and agent speech transcribed

### Verification Commands

**In CallTools tab console:**
```javascript
// Check if interceptor loaded
window.__getInterceptedStreams

// Check streams
window.__webrtcStreams
// Should show: { remote: MediaStream, local: MediaStream }

// Check tracks
window.__webrtcStreams.remote.getTracks()
window.__webrtcStreams.local.getTracks()
// Should each show at least 1 audio track with readyState: "live"
```

## Demo Constraints & Assumptions

### Required User Actions
1. Wait **10 seconds** after call starts before clicking "Start AI Coaching"
2. Must be on CallTools tab when clicking coaching button
3. Must have Deepgram API key configured in settings

### Known Limitations (OK for Demo)
- No retry if interceptor fails to load
- No handling of page refresh during call
- No support for multiple back-to-back calls without reload
- Console errors instead of user-friendly messages
- No state persistence (refresh = reset)

### Out of Scope
- Production-grade error handling
- Edge case coverage
- Performance optimization
- Security hardening
- Coaching tips generation (focus on transcription only)

## Success Definition

**Demo is successful if:**
1. ✅ Live transcription appears in sidepanel during a 2-minute test call
2. ✅ Transcription contains actual spoken words (not empty)
3. ✅ Both caller and agent speech are captured
4. ✅ Clear console log trail shows the fix working

**Client sees:** "Yes, we can capture CallTools WebRTC audio and transcribe it live using a Chrome extension"

## Next Steps After Demo Success

Once POC proves feasibility:
1. Refactor for production (add error handling, retry logic)
2. Add pending capture state for edge case (coaching before streams ready)
3. Implement coaching tips generation
4. Add state persistence
5. Production-grade logging and error messages
6. Performance optimization (consider AudioWorklet vs ScriptProcessor)

---

## Developer Quick Start

**To implement this spec:**

1. Start with Task 1 (add stream check to content script) - 15 min
2. Then Task 2 (fix background handler) - 20 min
3. Add logging (Task 3) - 10 min
4. Test with real CallTools call - 15 min

**Total estimated time:** ~1 hour for demo-ready fix

**Files to modify:**
- `src/content/index.ts` (~10 lines)
- `src/background/index.ts` (~25 lines)

**Key debugging:**
- Content script console: Look for "AUDIO_TRACKS_READY"
- Background console: Look for "Starting WebRTC capture"
- Offscreen console: Look for "Audio data flowing"
