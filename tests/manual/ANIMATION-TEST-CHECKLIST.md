# Animation Test Checklist

**Date:** _____________
**Tester:** _____________
**Browser:** Chrome _____________
**Extension Version:** 1.0.0

---

## Pre-Test Setup

- [ ] Extension loaded from `dist/` folder
- [ ] Backend running (`cd backend && npm run dev`)
- [ ] Backend health check passes: `curl http://localhost:3000/health`
- [ ] DevTools Console open (for debugging)

---

## Test 1: Warmup State Animations

**Trigger:** Start call, enable AI coaching, observe during first 3 minutes

### ✅ Expected Animations

- [ ] **Container fade-in**
  - Starts at opacity 0
  - Fades to opacity 1 over 0.5s
  - Slight upward slide (y: 20 → 0)

- [ ] **Timer emoji rotation**
  - ⏱️ emoji rotates continuously
  - 360° rotation every 2 seconds
  - Smooth, constant speed

- [ ] **Skeleton bars pulsing**
  - 3 horizontal bars visible
  - Pulse between 30% and 60% opacity
  - Each bar has staggered timing (0s, 0.2s, 0.4s delay)
  - Different widths (75%, 50%, 67%)

- [ ] **Gradient background**
  - Blue-to-indigo gradient visible
  - Smooth color transition

**Pass/Fail:** _______
**Notes:**

---

## Test 2: First AI Tip Appearance

**Trigger:** Wait 3 minutes for first AI tip

### ✅ Expected Animations

- [ ] **Tip container slide-up**
  - Fades in from opacity 0
  - Slides up 20px with spring physics
  - Duration: 0.5s
  - Spring stiffness: 100

- [ ] **Heading animation (200ms delay)**
  - Slides in from left (x: -20 → 0)
  - Fades in opacity 0 → 1

- [ ] **Lightbulb pulse**
  - 💡 scales: 1 → 1.2 → 1
  - 2-second duration
  - Repeats every 3 seconds (with delay)

- [ ] **Stage badge pop (300ms delay)**
  - Scales from 0 to 1
  - Spring animation (bounces slightly)

- [ ] **Context box (400ms delay)**
  - Fades in (opacity 0 → 1)
  - Slides down slightly (y: 10 → 0)

- [ ] **"Choose your response" text (500ms delay)**
  - Fades in smoothly

**Pass/Fail:** _______
**Notes:**

---

## Test 3: Option Buttons Staggered Entrance

**Trigger:** Observe buttons when tip appears

### ✅ Expected Animations

- [ ] **Option 1 (600ms delay)**
  - Slides in from left (x: -20 → 0)
  - Fades in (opacity 0 → 1)

- [ ] **Option 2 (700ms delay)**
  - Same animation as Option 1
  - Appears 0.1s after Option 1

- [ ] **Option 3 (800ms delay)**
  - Same animation as Option 2
  - Appears 0.1s after Option 2

- [ ] **Sequential effect**
  - Buttons appear one after another
  - Smooth cascade effect

**Pass/Fail:** _______
**Notes:**

---

## Test 4: Button Hover Effects

**Trigger:** Hover mouse over each unselected option button

### ✅ Expected Animations

- [ ] **Hover on Option 1**
  - Scales to 102% (1.02x)
  - Slides 4px to the right
  - Border changes to purple-500
  - Background changes to purple-50
  - Shadow increases (shadow-lg)
  - Transition smooth (~200ms)

- [ ] **Hover on Option 2**
  - Same as Option 1

- [ ] **Hover on Option 3**
  - Same as Option 1

- [ ] **Cursor changes**
  - Cursor shows pointer (clickable)

**Pass/Fail:** _______
**Notes:**

---

## Test 5: Button Click/Tap Feedback

**Trigger:** Click (don't release) on an option button

### ✅ Expected Animation

- [ ] **On mouse down**
  - Button scales to 98% (0.98x)
  - Quick, responsive feedback

- [ ] **On mouse up**
  - Button returns to normal size
  - Immediate transition

**Pass/Fail:** _______
**Notes:**

---

## Test 6: Option Selection Animation

**Trigger:** Click Option 2 (Explanative)

### ✅ Expected Animations

- [ ] **Checkmark entrance**
  - ✓ appears with rotation
  - Starts at scale 0, rotate -180°
  - Ends at scale 1, rotate 0°
  - Spring animation (bouncy)
  - Duration: ~0.5s

- [ ] **Selected button state**
  - Background changes to purple-600
  - Border changes to purple-700
  - Text changes to white
  - Shadow appears (shadow-md)

- [ ] **Other buttons disabled**
  - Options 1 and 3 turn gray
  - Opacity reduced to 60%
  - Cursor changes to not-allowed
  - No hover effects on disabled buttons

**Pass/Fail:** _______
**Notes:**

---

## Test 7: Countdown Timer

**Trigger:** Observe countdown after first tip appears

### ✅ Expected Animations

- [ ] **Container fade-in (900ms delay)**
  - Entire countdown section fades in
  - Appears below tip history button

- [ ] **Sync icon rotation**
  - 🔄 rotates continuously
  - 360° every 3 seconds
  - Smooth, constant speed

- [ ] **Countdown text updates**
  - Number decreases every second
  - 30 → 29 → 28 → ... → 1 → 30 (loops)
  - Updates smoothly

- [ ] **Progress bar animation**
  - Purple bar (bg-purple-400)
  - Width changes based on countdown
  - Smooth 1-second transitions
  - Full width at 30s, empty at 0s

**Pass/Fail:** _______
**Notes:**

---

## Test 8: Next Tip Transition

**Trigger:** Wait 30 seconds for next AI tip

### ✅ Expected Animations

- [ ] **Old tip slides out**
  - Entire component refreshes
  - Key prop changes (re-renders)

- [ ] **New tip slides in**
  - Same entrance animation as Test 2
  - Slide-up with spring
  - All elements animate in sequence

- [ ] **Options reset**
  - All 3 options clickable again
  - No checkmarks visible
  - Hover effects work

**Pass/Fail:** _______
**Notes:**

---

## Test 9: Connecting State

**Trigger:** Start call, observe status during connection

### ✅ Expected Animations

- [ ] **Container fade-in**
  - Fades in over 0.4s

- [ ] **Sync icon rotation**
  - ⟳ rotates continuously
  - 360° every 1.5 seconds

- [ ] **Progress bar animation**
  - Yellow bar (bg-yellow-400)
  - Width animates 0% → 60%
  - Loops infinitely (2s duration)
  - Smooth transitions

- [ ] **Gradient background**
  - Yellow-to-orange gradient

**Pass/Fail:** _______
**Notes:**

---

## Test 10: Error State

**Trigger:** Stop backend while call is active

### ✅ Expected Animations

- [ ] **Container animation**
  - Scales from 0.95 to 1.0
  - Fades in (opacity 0 → 1)
  - Duration: 0.3s

- [ ] **Robot icon bounce**
  - 🤖 scales from 0 to 1
  - Spring animation (0.2s delay)
  - Bounces slightly (stiffness: 200)

- [ ] **Reassurance box (0.5s delay)**
  - Green box fades in
  - "✓ Your transcription will continue..."
  - Delayed appearance creates hierarchy

**Pass/Fail:** _______
**Notes:**

---

## Test 11: Reconnecting State

**Trigger:** Restart backend after error

### ✅ Expected Animations

- [ ] **Status changes**
  - Error → Reconnecting transition
  - Background changes to yellow/orange gradient

- [ ] **Same animations as Test 9**
  - Rotating sync icon
  - Looping progress bar

**Pass/Fail:** _______
**Notes:**

---

## Test 12: Disconnected State

**Trigger:** End call, observe status

### ✅ Expected Animations

- [ ] **Container animation**
  - Same as error state (scale + fade)

- [ ] **Robot icon spring**
  - Same bounce animation

- [ ] **Different messaging**
  - "AI Coaching Offline"
  - "Start a call and enable..."
  - No reassurance box

**Pass/Fail:** _______
**Notes:**

---

## Test 13: Tips History Expansion

**Trigger:** Click "X tips ▼" button

### ✅ Expected Behavior (No animation)

- [ ] History expands smoothly
- [ ] Shows previous tips in reverse order
- [ ] Selected options highlighted
- [ ] Collapse works smoothly

**Note:** History expansion not animated (just CSS transition)

**Pass/Fail:** _______
**Notes:**

---

## Test 14: Performance Check

**Trigger:** Observe during all animations

### ✅ Performance Metrics

- [ ] **Frame rate**
  - DevTools Performance tab
  - Record during animations
  - FPS stays above 30 (target: 60)

- [ ] **No janky animations**
  - All transitions smooth
  - No stuttering or lag
  - No layout shifts

- [ ] **Memory usage**
  - Chrome Task Manager
  - Extension memory < 100MB
  - No memory leaks over time

**Pass/Fail:** _______
**FPS Average:** _______
**Memory Usage:** _______
**Notes:**

---

## Test 15: Console Errors

**Trigger:** Check throughout all tests

### ✅ Expected

- [ ] **No JavaScript errors**
  - Console shows no red errors
  - Only info/log messages

- [ ] **No animation warnings**
  - No Framer Motion warnings
  - No React warnings

**Pass/Fail:** _______
**Errors Found:**

---

## Summary

**Total Tests:** 15
**Passed:** _____
**Failed:** _____
**Pass Rate:** _____%

### Issues Found

**Critical (blocks functionality):**
1. _________________________________
2. _________________________________

**Major (UX significantly impacted):**
1. _________________________________
2. _________________________________

**Minor (cosmetic issues):**
1. _________________________________
2. _________________________________

### Overall Assessment

**Animation Quality:** ☐ Excellent ☐ Good ☐ Fair ☐ Poor

**Performance:** ☐ Smooth ☐ Acceptable ☐ Sluggish ☐ Broken

**User Experience:** ☐ Delightful ☐ Professional ☐ Functional ☐ Needs work

### Recommendations

_____________________________________________
_____________________________________________
_____________________________________________

---

**Tester Signature:** _____________  **Date:** _________
**Approved By:** _____________  **Date:** _________
