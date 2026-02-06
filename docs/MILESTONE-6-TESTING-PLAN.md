# Milestone 6: Testing & Polish

**Started:** 2025-12-24
**Target Completion:** 2025-12-24
**Status:** In Progress

---

## 📋 **Testing Objectives**

1. **Unit Testing** - Test individual components and services
2. **Integration Testing** - Test WebSocket flow end-to-end
3. **Manual Testing** - Verify 3-option feature with live backend
4. **Error Handling** - Test failure scenarios and recovery
5. **Cost Verification** - Confirm $0.02637 per call
6. **UI/UX Polish** - Improve animations, states, messages

---

## ✅ **Task Checklist**

### 1. Unit Tests for AIBackendService
**Priority:** HIGH
**File:** `tests/unit/ai-backend-service.test.ts`

**Test Cases:**
- [ ] Connection initialization with valid config
- [ ] Connection initialization with invalid config (should throw error)
- [ ] Auto-reconnect on disconnect (exponential backoff: 1s, 2s, 4s)
- [ ] startConversation() returns conversation ID
- [ ] sendTranscript() emits TRANSCRIPT event
- [ ] selectOption() emits OPTION_SELECTED event
- [ ] Status listener receives updates
- [ ] AI tip listener receives tips
- [ ] Error listener receives errors
- [ ] disconnect() cleans up properly

**Mock Strategy:**
- Mock Socket.io client with `jest.mock('socket.io-client')`
- Mock event emitters and listeners
- Test timeout scenarios

---

### 2. Integration Test for WebSocket Flow
**Priority:** HIGH
**File:** `tests/integration/websocket-flow.test.ts`

**Test Scenario:**
```
1. Extension connects to backend
2. Extension starts conversation
3. Backend creates conversation in database
4. Extension sends transcript
5. Backend stores transcript
6. Backend generates AI tip (after warmup)
7. Extension receives AI_TIP event
8. Extension displays tip with 3 options
9. User clicks option
10. Extension sends OPTION_SELECTED
11. Backend updates selected_option
12. Next AI tip uses selection history
```

**Requirements:**
- [ ] Set up test backend server (localhost:3001)
- [ ] Set up test PostgreSQL database
- [ ] Seed test data
- [ ] Run full flow with assertions
- [ ] Clean up after test

---

### 3. Manual Test Plan
**Priority:** HIGH
**File:** `tests/manual-test-plan.md`

**Test Environment:**
- Browser: Chrome (latest)
- Backend: http://localhost:3000
- Database: PostgreSQL local

**Test Cases:**

**3.1 Happy Path - Full Call Flow**
- [ ] Load extension in Chrome
- [ ] Navigate to CallTools
- [ ] Start a call
- [ ] Click "Start AI Coaching" in popup
- [ ] Verify SidePanel shows warmup state
- [ ] Wait 3 minutes
- [ ] Verify first AI tip appears with 3 options
- [ ] Click option 2 (Explanative)
- [ ] Verify option 2 highlighted with checkmark
- [ ] Wait 30 seconds
- [ ] Verify next AI tip appears
- [ ] Verify tip history shows previous selection
- [ ] End call
- [ ] Verify AI backend disconnects

**3.2 Connection Status States**
- [ ] Disconnected: Shows "AI Coaching Offline"
- [ ] Connecting: Shows "Connecting..." with spinner
- [ ] Ready: Shows "AI Ready" badge
- [ ] Error: Shows "AI temporarily unavailable"
- [ ] Reconnecting: Shows "Reconnecting..." with retry count

**3.3 Edge Cases**
- [ ] Start coaching before call begins (should wait for WEBRTC_STREAMS_READY)
- [ ] Start coaching mid-call (should join existing conversation)
- [ ] Network disconnect during call (should auto-reconnect)
- [ ] Backend restart during call (should reconnect and resume)
- [ ] Multiple AI tips arrive quickly (should display latest only)

---

### 4. Error Scenario Testing
**Priority:** HIGH

**4.1 Network Disconnect**
- [ ] Start call with AI coaching
- [ ] Disconnect WiFi
- [ ] Verify "Reconnecting..." status
- [ ] Reconnect WiFi
- [ ] Verify connection restores within 4 seconds
- [ ] Verify conversation resumes with same conversation_id

**4.2 Backend Failure**
- [ ] Start call with AI coaching
- [ ] Stop backend server (`killall node`)
- [ ] Verify error status shown
- [ ] Restart backend
- [ ] Verify auto-reconnect works
- [ ] Verify transcription continues (graceful degradation)

**4.3 Database Timeout**
- [ ] Simulate slow database query (add pg.query delay)
- [ ] Verify backend doesn't crash
- [ ] Verify timeout error returned to extension
- [ ] Verify retry logic attempts 3 times
- [ ] Verify friendly error message shown to user

**4.4 OpenAI Rate Limit**
- [ ] Simulate OpenAI 429 rate limit error
- [ ] Verify analysis pauses
- [ ] Verify fallback message shown
- [ ] Verify retry after cooldown period
- [ ] Verify transcription continues

**4.5 Invalid API Key**
- [ ] Set invalid OpenAI API key in backend .env
- [ ] Start call
- [ ] Verify error logged
- [ ] Verify fallback tips shown (if implemented)
- [ ] Verify user notified of AI unavailability

---

### 5. Cost Verification
**Priority:** MEDIUM

**Test Scenario:**
- [ ] Run 30-minute simulated call
- [ ] Count OpenAI API calls
- [ ] Calculate total tokens used
- [ ] Verify cost calculation:
  - Input tokens: ~1,500 per analysis
  - Output tokens: ~400 per analysis
  - Analyses: ~54 per 30-min call (1 every 30s after 3-min warmup)
  - Cost: $0.02637 per call
- [ ] Confirm cost is < $0.05 target (47% margin)

**Files to Create:**
- [ ] `backend/tests/cost-verification.test.ts`
- [ ] `backend/src/utils/cost-calculator.ts` (token counter)

---

### 6. UI/UX Polish
**Priority:** MEDIUM

**6.1 Loading States**
- [ ] Add skeleton loaders for AI tips during warmup
- [ ] Add smooth fade-in animation when tip appears
- [ ] Add pulse animation on status indicator

**6.2 Error Messages**
- [ ] Replace generic "Error" with specific messages:
  - "Connection lost. Retrying..."
  - "AI temporarily unavailable. Transcription continues."
  - "Rate limit reached. Analysis paused."
- [ ] Add retry button for manual reconnect

**6.3 Visual Feedback**
- [ ] Add hover effects on option buttons
- [ ] Add ripple effect on button click
- [ ] Add checkmark animation when option selected
- [ ] Add progress bar for "Next update in X seconds"

**6.4 Accessibility**
- [ ] Add ARIA labels to buttons
- [ ] Add keyboard navigation (Tab, Enter, Space)
- [ ] Add screen reader announcements for new tips
- [ ] Test with ChromeVox

**Files to Update:**
- [ ] `src/components/AITipsSection.tsx` (add animations)
- [ ] `src/components/AIStatusIndicator.tsx` (improve states)
- [ ] Add Framer Motion for animations

---

### 7. End-to-End Test with Live Backend
**Priority:** HIGH

**Setup:**
```bash
# Terminal 1: Start backend
cd backend && npm run dev

# Terminal 2: Build extension
npm run build

# Terminal 3: Monitor logs
tail -f backend/logs/app.log
```

**Test Procedure:**
1. Load extension from `dist/` folder
2. Navigate to live CallTools instance
3. Start real sales call
4. Enable AI coaching
5. Talk for 5+ minutes
6. Verify AI tips are contextually relevant
7. Select different options
8. Verify next tips reflect selections
9. Check backend logs for errors
10. Verify database has correct data

**Success Criteria:**
- [ ] No JavaScript errors in console
- [ ] No backend errors in logs
- [ ] AI tips appear within 3 minutes
- [ ] Tips relevant to conversation
- [ ] Option selection works smoothly
- [ ] Database has all transcripts and recommendations

---

## 📊 **Test Coverage Goals**

**Target Coverage:** 80%+

**Unit Tests:**
- AIBackendService: 90%+
- call-store (AI actions): 85%+
- AITipsSection component: 75%+

**Integration Tests:**
- WebSocket flow: 100% (critical path)
- Error scenarios: 80%+

**E2E Tests:**
- Full call flow: 100% (manual)

---

## 🐛 **Known Issues to Fix**

1. **TTS Hook Permission Denied** (Low Priority)
   - Error: `/Users/cob/.claude/hooks/play-tts.sh: Permission denied`
   - Fix: `chmod +x /Users/cob/.claude/hooks/play-tts.sh`
   - Impact: Non-critical, TTS optional

2. **TypeScript Strict Mode Warnings** (Medium Priority)
   - Review and enable strict type checking
   - Fix any `any` types with proper interfaces

3. **Console Log Cleanup** (Low Priority)
   - Remove debug console.logs before production
   - Use Winston logger in backend
   - Use structured logging in extension

---

## 🎨 **UI/UX Improvements**

### Current State
- ✅ 3-option buttons display correctly
- ✅ Selected option highlighted
- ✅ Connection status indicator
- ✅ Tips history expandable

### Improvements Needed
- [ ] Add smooth animations (Framer Motion)
- [ ] Add loading skeleton during warmup
- [ ] Add progress countdown timer (30s)
- [ ] Improve error messages (more specific)
- [ ] Add retry button for failed connections
- [ ] Add tooltip explanations for stages
- [ ] Add keyboard shortcuts (optional)

---

## 📈 **Performance Benchmarks**

**Target Metrics:**
- WebSocket connection time: < 500ms
- AI tip generation latency: < 1s after 30s interval
- UI render time: < 100ms
- Memory usage: < 50MB (extension)
- Backend response time: < 200ms P95

**Test Tools:**
- Chrome DevTools Performance tab
- Lighthouse audit
- `artillery` for load testing backend
- `@testing-library/react` for component tests

---

## 🚀 **Next Steps After Testing**

1. **Fix all failing tests**
2. **Achieve 80%+ code coverage**
3. **Polish UI based on feedback**
4. **Update documentation with test results**
5. **Prepare for Milestone 7: Production Deployment**

---

**Testing Plan Created:** 2025-12-24
**Estimated Time:** 8-12 hours
**Status:** Ready to begin
