# Manual Test Plan - 3-Option AI Coaching Feature

**Version:** 1.0
**Date:** 2025-12-24
**Tester:** _____________
**Test Environment:**
- Browser: Chrome (latest)
- Backend: http://localhost:3000
- Database: PostgreSQL (local)
- Extension Version: 1.0.0

---

## Pre-Test Setup

### 1. Backend Setup
```bash
# Terminal 1: Start backend server
cd backend
npm run dev

# Verify backend is running
curl http://localhost:3000/health
# Expected: {"status":"ok", ...}
```

### 2. Extension Setup
```bash
# Terminal 2: Build extension
npm run build

# Load extension in Chrome
1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select dist/ folder
5. Note extension ID for later
```

### 3. Database Verification
```bash
# Verify migrations are applied
psql -d devassist_coaching -c "SELECT * FROM pgmigrations;"
```

---

## Test Cases

### TC-001: Happy Path - Full Call Flow with AI Coaching

**Objective:** Verify complete end-to-end flow from call start to AI tip selection

**Prerequisites:**
- [ ] Backend running
- [ ] Extension loaded
- [ ] CallTools page open

**Steps:**
1. Navigate to CallTools in Chrome
2. Open DevTools Console (for debugging)
3. Start a call in CallTools
4. Open Extension Popup
5. Click "Start AI Coaching" button
6. Open Extension Side Panel
7. Wait for warmup period (3 minutes)
8. Observe first AI tip appears
9. Read all 3 dialogue options
10. Click option 2 (Explanative)
11. Wait 30 seconds
12. Observe next AI tip appears
13. Verify tip history shows previous selection
14. End the call
15. Verify AI backend disconnects

**Expected Results:**
- [ ] Popup button shows "Start AI Coaching"
- [ ] After clicking, button disabled during call
- [ ] Side panel shows "🧠 AI Analyzing..." during warmup
- [ ] After 3 minutes, status changes to "✅ AI Ready"
- [ ] First AI tip displays with:
  - 2-word heading (e.g., "Ask Discovery")
  - Stage badge (e.g., "DISCOVERY")
  - Context explanation
  - 3 option buttons with labels and scripts
- [ ] Selected option (2) highlighted purple with checkmark
- [ ] Other options (1, 3) grayed out and disabled
- [ ] After 30 seconds, new AI tip appears
- [ ] Expandable history shows "Explanative: [script text]"
- [ ] On call end, status changes to "AI Coaching Offline"
- [ ] No JavaScript errors in console
- [ ] Backend logs show conversation ended

**Pass/Fail:** ___________
**Notes:**

---

### TC-002: Connection Status States

**Objective:** Verify all AI backend connection states display correctly

**Steps:**

**2.1 Disconnected State:**
1. Load extension (backend not running)
2. Open side panel
3. Observe status indicator

**Expected:**
- [ ] Shows "○ Disconnected" badge
- [ ] Shows "AI Coaching Offline" message
- [ ] Shows "Connect to backend to receive AI tips"

**2.2 Connecting State:**
1. Start backend
2. Start call
3. Click "Start AI Coaching"
4. Immediately observe status

**Expected:**
- [ ] Shows "◐ Connecting..." badge with animation
- [ ] Shows "Establishing connection to AI backend"
- [ ] Spinner visible

**2.3 Ready State:**
1. Wait for connection to complete
2. Observe status after 3-min warmup

**Expected:**
- [ ] Shows "● AI Ready" badge
- [ ] Green color indicator
- [ ] Shows "Next update in ~30 seconds"

**2.4 Error State:**
1. During call, stop backend (`killall node`)
2. Observe status change

**Expected:**
- [ ] Shows "✕ Error" badge
- [ ] Red color indicator
- [ ] Shows "Connection error. Check backend server."

**2.5 Reconnecting State:**
1. Restart backend
2. Observe auto-reconnect

**Expected:**
- [ ] Shows "⟳ Reconnecting..." badge
- [ ] Orange color indicator
- [ ] Attempts reconnect with backoff (1s, 2s, 4s)
- [ ] Eventually connects and shows "Ready"

**Pass/Fail:** ___________
**Notes:**

---

### TC-003: AI Tip Display & Formatting

**Objective:** Verify AI tips display correctly with proper formatting

**Steps:**
1. Start call with AI coaching enabled
2. Wait for first AI tip
3. Inspect tip formatting

**Expected:**
- [ ] Heading is max 2 words, uppercase, bold
- [ ] Stage badge displays (GREETING, DISCOVERY, VALUE_PROP, etc.)
- [ ] Context explains why this tip makes sense
- [ ] 3 options displayed as buttons
- [ ] Each option has:
  - Label (Minimal, Explanative, Contextual)
  - Script text in quotes
- [ ] Buttons have hover effect (purple border)
- [ ] Timestamp shows "Updated Xs ago"
- [ ] "Next update in ~30 seconds" countdown visible

**Pass/Fail:** ___________
**Notes:**

---

### TC-004: Option Selection Behavior

**Objective:** Verify option selection works correctly

**Steps:**
1. Receive AI tip with 3 options
2. Hover over each option (don't click yet)
3. Click option 1 (Minimal)
4. Try clicking option 2 (should be disabled)
5. Wait for next tip
6. Verify previous selection tracked

**Expected:**
- [ ] Hover shows purple border and shadow
- [ ] After clicking option 1:
  - Option 1 turns purple with checkmark
  - Options 2 and 3 turn gray and disabled
  - Cursor changes to not-allowed on disabled
- [ ] Cannot click disabled options
- [ ] Console log shows: "✅ Selected option 1"
- [ ] Backend receives OPTION_SELECTED event
- [ ] Database stores selected_option = 1
- [ ] Next AI tip context considers previous choice

**Pass/Fail:** ___________
**Notes:**

---

### TC-005: Tips History Expansion

**Objective:** Verify tips history shows all previous tips

**Steps:**
1. Receive at least 3 AI tips
2. Select different options for each
3. Click "X tips ▼" button
4. Inspect history display
5. Click "X tips ▲" to collapse

**Expected:**
- [ ] Badge shows correct count (e.g., "3 tips")
- [ ] History expands smoothly
- [ ] Shows tips in reverse chronological order
- [ ] Each historical tip shows:
  - Heading
  - Timestamp
  - Selected option with label and script
  - OR "No option selected" if not chosen
- [ ] Max height 264px with scrollbar if needed
- [ ] Collapse works smoothly

**Pass/Fail:** ___________
**Notes:**

---

### TC-006: Warmup Period Behavior

**Objective:** Verify 3-minute warmup period works correctly

**Steps:**
1. Start call at **exactly** T=0:00
2. Enable AI coaching immediately
3. Note time
4. Observe status at T=1:00, T=2:00, T=3:00, T=3:30

**Expected:**
- [ ] T=0:00 - 3:00: Shows "🧠 AI Analyzing... First tip in ~30s"
- [ ] T=3:00: Status changes to "✅ AI Ready"
- [ ] T=3:00 - 3:30: First AI tip appears
- [ ] T=4:00: Second AI tip appears
- [ ] Backend logs show analysis triggered at T=3:00

**Pass/Fail:** ___________
**Notes:**

---

### TC-007: Network Disconnect Recovery

**Objective:** Verify auto-reconnect on network loss

**Steps:**
1. Start call with AI coaching (after warmup)
2. Receive 1-2 AI tips
3. Disconnect WiFi
4. Wait 5 seconds
5. Reconnect WiFi
6. Observe recovery

**Expected:**
- [ ] On disconnect: Status shows "Reconnecting..."
- [ ] Extension attempts reconnect (1s, 2s, 4s backoff)
- [ ] On WiFi reconnect: Connection restored within 4s
- [ ] Conversation resumes with same conversation_id
- [ ] Next AI tip appears on schedule
- [ ] No data lost

**Pass/Fail:** ___________
**Notes:**

---

### TC-008: Backend Restart During Call

**Objective:** Verify resilience when backend restarts

**Steps:**
1. Start call with AI coaching
2. Wait for first AI tip
3. Stop backend server (`killall node`)
4. Observe error state (5 seconds)
5. Restart backend (`npm run dev`)
6. Observe reconnection
7. Continue call

**Expected:**
- [ ] On backend stop: Status shows "Error"
- [ ] Transcription continues (Deepgram unaffected)
- [ ] On backend restart: Auto-reconnect within 10s
- [ ] NEW conversation created (old one lost)
- [ ] AI tips resume after warmup
- [ ] User notified of reconnection

**Pass/Fail:** ___________
**Notes:**

---

### TC-009: Multiple Tabs Behavior

**Objective:** Verify only one active AI session per call

**Steps:**
1. Open CallTools in Tab A
2. Start call
3. Enable AI coaching
4. Open CallTools in Tab B (same call)
5. Try enabling AI coaching in Tab B

**Expected:**
- [ ] Tab A: AI coaching working normally
- [ ] Tab B: Should show "AI already active on another tab" OR
- [ ] Backend rejects duplicate conversation for same call
- [ ] No conflicts or duplicate tips

**Pass/Fail:** ___________
**Notes:**

---

### TC-010: Long Call (30+ minutes)

**Objective:** Verify AI coaching works for extended calls

**Steps:**
1. Start call
2. Enable AI coaching
3. Simulate 30-minute conversation (or run real call)
4. Count AI tips received
5. Monitor memory usage
6. Verify cost estimate

**Expected:**
- [ ] ~54 AI tips received (1 every 30s after 3-min warmup)
- [ ] All tips display correctly
- [ ] No memory leaks (check Chrome Task Manager)
- [ ] Extension memory < 50MB
- [ ] Backend memory stable
- [ ] Database has ~60+ transcripts
- [ ] Database has ~54 recommendations
- [ ] Estimated cost: ~$0.0264 per call

**Pass/Fail:** ___________
**Notes:**

---

### TC-011: UI Responsiveness

**Objective:** Verify UI remains responsive during AI operations

**Steps:**
1. Start call with AI coaching
2. While AI tips are appearing:
   - Scroll transcription
   - Expand/collapse tips history
   - Click export buttons
   - Switch between popup and side panel
3. Measure UI lag

**Expected:**
- [ ] No UI freezing
- [ ] Smooth scrolling
- [ ] Instant button responses
- [ ] AI tip appearance doesn't interrupt user actions
- [ ] Frame rate stays above 30fps

**Pass/Fail:** ___________
**Notes:**

---

### TC-012: Cost Verification

**Objective:** Verify actual cost matches estimate ($0.02637/call)

**Steps:**
1. Run full 30-minute call with AI coaching
2. Check OpenAI usage dashboard
3. Calculate actual cost

**Cost Breakdown:**
- Input tokens per analysis: ~1,500
- Output tokens per analysis: ~400
- Number of analyses: ~54 (30 min / 30s after warmup)
- GPT-4o-mini pricing:
  - Input: $0.150 per 1M tokens
  - Output: $0.600 per 1M tokens

**Calculation:**
```
Input cost  = (1,500 × 54) / 1,000,000 × $0.150 = $0.01215
Output cost = (400 × 54) / 1,000,000 × $0.600 = $0.01296
Total       = $0.02511
```

**Expected:**
- [ ] Actual cost within 10% of estimate
- [ ] Total cost < $0.05 (budget target)
- [ ] Cost per call: ~$0.025

**Pass/Fail:** ___________
**Actual Cost:** $_________
**Notes:**

---

## Test Summary

**Total Test Cases:** 12
**Passed:** _____
**Failed:** _____
**Blocked:** _____
**Pass Rate:** _____%

**Critical Bugs Found:**
1. _________________________________
2. _________________________________
3. _________________________________

**Non-Critical Issues:**
1. _________________________________
2. _________________________________
3. _________________________________

**Recommendations:**
_____________________________________________
_____________________________________________
_____________________________________________

**Tester Signature:** _____________  **Date:** _________
**Approved By:** _____________  **Date:** _________
