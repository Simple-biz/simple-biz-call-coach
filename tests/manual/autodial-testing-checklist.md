# Auto-Dial & Call Coach Manual Testing Checklist

## Prerequisites
- Extension built: `npm run build`
- Extension loaded in Chrome: `chrome://extensions` → Load unpacked → `dist/`
- Microphone permissions granted: `chrome-extension://<extension-id>/src/permissions.html`
- Test Campaign (ID: 22278) has AMD disabled
- Test Bucket (ID: 3470) has a contact with +17754068577
- Run `node tests/manual/reload-test-contact.cjs` to add a fresh contact

---

## Test 1: Manual Dial — Basic Flow
1. Open CallTools tab
2. Open side panel (Call Coach)
3. Click "Start AI Coaching" in popup
4. Manual dial +17754068577
5. **Expected:**
   - [ ] `📱 Expected destination set: 17754068577` in service worker console
   - [ ] `📞 Call STARTED detected (via port)` appears
   - [ ] Transcription starts (both agent and caller)
   - [ ] `🧠 Intelligence update received` appears every ~10s
   - [ ] Side panel shows live transcription
   - [ ] Conversation Intelligence section populates (sentiment, entities)

## Test 2: Manual Dial — Call End Detection
1. While on the call from Test 1, hang up
2. **Expected:**
   - [ ] `📞 WebRTC ALL_TRACKS_ENDED` appears in content script console (instant)
   - [ ] `📞 Call ENDED` sent to background
   - [ ] Side panel shows call data (does NOT clear yet)
   - [ ] `🔄 Call ended — keeping coaching armed` in service worker

## Test 3: Back-to-Back Manual Calls (No Re-Arming)
1. After Test 2, manually dial +17754068577 again (do NOT click "Start AI Coaching")
2. **Expected:**
   - [ ] Call detected automatically (coaching was armed from Test 1)
   - [ ] Previous transcripts cleared
   - [ ] New transcription starts fresh
   - [ ] Intelligence updates for new call

## Test 4: Auto-Dial Campaign — Detection
1. Open CallTools → open side panel → click "Start AI Coaching"
2. Join Test Campaign
3. Wait for auto-dialer to connect to +17754068577
4. **Expected:**
   - [ ] Call detected (via DOM or webhook destination match)
   - [ ] Transcription starts
   - [ ] Can talk to AI voice agent
   - [ ] Intelligence populates

## Test 5: Auto-Dial — Call End + Next Call
1. End the call from Test 4 (disposition it)
2. Add another contact to bucket: `node tests/manual/reload-test-contact.cjs`
3. Wait for next auto-dial
4. **Expected:**
   - [ ] Previous call data clears
   - [ ] New call starts coaching automatically
   - [ ] No need to click anything

## Test 6: AI Suggested Line (Golden Scripts)
1. During any active call, click "Next Suggestion" button in side panel
2. **Expected:**
   - [ ] `💡 AI Tip received` in service worker console
   - [ ] `💡 AI Suggested Line` appears in side panel
   - [ ] Tip is from Golden Scripts (matches conversation stage)
   - [ ] Can click "Next Suggestion" multiple times for different tips

## Test 7: Conversation Intelligence Fields
1. During a call, mention specific information:
   - Say a phone number: "(555) 555-1234"
   - Say an email: "send it to john@acme.com"
   - Say a business name: "Acme Plumbing"
   - Say a location: "We are in Sacramento"
   - Say a date: "Let's schedule for tomorrow at 9AM"
   - Say names: "My name is Mark, ask for Bob"
2. Wait 10-20 seconds for intelligence update
3. **Expected:**
   - [ ] Phone shows in Conversation Intelligence
   - [ ] Email shows
   - [ ] Business name shows
   - [ ] Location shows
   - [ ] Date shows
   - [ ] People names show

## Test 8: Sentiment Detection
1. During a call, start positive: "That sounds great! I'm very interested."
2. Check sentiment → should be positive
3. Then say: "Actually never mind. I'm not interested."
4. Wait for intelligence update
5. **Expected:**
   - [ ] Sentiment shifts from positive toward negative/neutral

## Test 9: No False Triggers from Webhook Flood
1. During a call, check service worker console
2. **Expected:**
   - [ ] `STATUS_UPDATE` messages appear (silently, no CALL_STARTED text)
   - [ ] NO `Webhook detected CALL_STARTED` or `triggering call lifecycle`
   - [ ] NO false call starts from other agents' calls

## Test 10: Clean Shutdown
1. End a call
2. **Expected:**
   - [ ] `📞 Call ENDED` detected
   - [ ] `🛑 Disconnecting AI Backend`
   - [ ] `✅ Call ended successfully`
   - [ ] `🛑 Stopped Auto-Analysis Loop`
   - [ ] `🛑 Keep-alive stopped`
   - [ ] No errors in console
   - [ ] Side panel shows "No Active Call" or retains last call data

---

## Reload Test Contact Script
Run this to add a fresh contact to the Test Bucket:
```bash
node tests/manual/reload-test-contact.cjs
```
