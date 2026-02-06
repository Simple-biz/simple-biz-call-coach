# Quick Start: Load & Test Extension

**Goal:** Load the extension and verify animations are working

---

## 1️⃣ Load Extension (2 minutes)

### Open Chrome Extensions
```
In Chrome address bar, type:
chrome://extensions
```

### Enable Developer Mode
- Look for toggle in **top-right corner**
- Switch "Developer mode" to **ON**

### Load Unpacked Extension
1. Click **"Load unpacked"** button (top-left)
2. Navigate to:
   ```
   /Users/cob/DevAssist/Projects/DevAssist-Call-Coach/dist
   ```
3. Click **"Select"**

### Verify Loaded
- ✅ Extension appears in list
- ✅ Icon shows "Simple.biz Call Coach"
- ✅ No errors shown

---

## 2️⃣ Start Backend (1 minute)

### Terminal 1: Start Backend Server
```bash
cd /Users/cob/DevAssist/Projects/DevAssist-Call-Coach/backend
npm run dev
```

### Verify Backend Running
```bash
curl http://localhost:3000/health
# Expected: {"status":"ok", "database":"connected", ...}
```

---

## 3️⃣ Quick Animation Test (5 minutes)

### Open Extension
1. Click extension icon in Chrome toolbar
2. Click **"Open Side Panel"** (or use Chrome side panel)

### Test 1: Warmup Animations
**What to do:** Just observe the extension right after opening

**What to see:**
- ✅ Timer emoji (⏱️) **rotating smoothly**
- ✅ **3 pulsing skeleton bars** below text
- ✅ Blue gradient background
- ✅ Text says "AI Analyzing Conversation..."

**Duration:** Immediate (visible right away)

---

### Test 2: Connecting State (Optional)
**What to do:**
1. Stop backend: `killall node`
2. Start backend again: `npm run dev`
3. Observe status indicator

**What to see:**
- ✅ **Sync icon (⟳) rotating**
- ✅ Yellow animated progress bar
- ✅ Text says "Connecting to AI..."

---

### Test 3: Error State
**What to do:**
1. Stop backend: `killall node`
2. Wait 5 seconds

**What to see:**
- ✅ **Robot icon (🤖) bounces in** with spring animation
- ✅ Title: "Connection Lost"
- ✅ Green box appears with: "✓ Your transcription will continue..."

---

### Test 4: Button Hover (Requires AI Tip)

**Setup Required:**
1. Start backend
2. Navigate to CallTools in Chrome
3. Start a call
4. Open extension popup
5. Click "Start AI Coaching"
6. Wait 3 minutes for first tip

**What to see:**
- ✅ **3 option buttons slide in** one after another
- ✅ **Hover over button:** grows slightly, slides right, shadow appears
- ✅ **Click button:** checkmark **spins in** with rotation
- ✅ **Other buttons disabled:** turn gray

---

### Test 5: Countdown Timer

**When:** After first AI tip appears

**What to see:**
- ✅ **Sync icon (🔄) rotates** continuously
- ✅ **Number counts down:** 30 → 29 → 28...
- ✅ **Purple progress bar** fills from right to left
- ✅ Bar width matches countdown

---

## 4️⃣ Full Test (Follow Complete Checklist)

If you want to test everything thoroughly:
```
Open: tests/manual/ANIMATION-TEST-CHECKLIST.md
Follow all 15 test cases
```

---

## 🐛 Troubleshooting

### Extension Won't Load
- **Issue:** "Manifest file is missing or unreadable"
- **Fix:** Make sure you selected the `dist/` folder, not the root folder
- **Verify:** `dist/manifest.json` should exist

### No Animations Showing
- **Issue:** Buttons don't animate, no smooth transitions
- **Check:** Open DevTools Console (F12)
- **Look for:** Any red errors
- **Common:** Framer Motion import errors

### Backend Connection Fails
- **Issue:** Status shows "Disconnected" or "Error"
- **Check:** Backend is running: `curl http://localhost:3000/health`
- **Check:** Port 3000 not blocked by firewall
- **Check:** Backend logs for errors

### Skeleton Bars Not Pulsing
- **Issue:** Loading skeleton shows but bars don't animate
- **Check:** GPU acceleration enabled in Chrome
- **Try:** chrome://gpu (verify GPU processes running)
- **Fix:** Restart Chrome

---

## ✅ Success Criteria

**You'll know animations are working if:**

1. **Warmup state:** Timer rotates, bars pulse
2. **Buttons:** Grow on hover, shrink on click
3. **Checkmark:** Spins in when option selected
4. **Countdown:** Updates every second with bar
5. **Transitions:** Smooth, no jank

**Looks good?** ✨ Animations are working!

**Issues?** Check the troubleshooting section above or review:
- `tests/manual/ANIMATION-TEST-CHECKLIST.md` (comprehensive)
- `docs/UI-UX-POLISH-SUMMARY.md` (technical details)

---

## 🎥 What You Should See (Quick Reference)

### Warmup (0-3 min)
```
┌─────────────────────────────────┐
│ ● AI Ready                      │
│                                 │
│         ⏱️ (rotating)            │
│   AI Analyzing Conversation...  │
│    First tip in ~30 seconds     │
│                                 │
│    ████░░░░░ (pulse 1)          │
│    ████████░░░ (pulse 2)        │
│    ███████░░░░ (pulse 3)        │
│                                 │
└─────────────────────────────────┘
```

### AI Tip (after 3 min)
```
┌─────────────────────────────────┐
│ ● AI Ready                      │
│                                 │
│  💡 ASK DISCOVERY    [DISCOVERY]│
│                                 │
│  💭 Customer expressed interest │
│                                 │
│  Choose your response:          │
│                                 │
│  ┌─────────────────────────────┐│
│  │ Minimal          (hover: →) ││ ← Grows on hover
│  │ "What challenges?"          ││
│  └─────────────────────────────┘│
│                                 │
│  ┌─────────────────────────────┐│
│  │ ✓ Explanative    [SELECTED] ││ ← Checkmark rotates in
│  │ "Tell me about..."          ││
│  └─────────────────────────────┘│
│                                 │
│  ┌─────────────────────────────┐│
│  │ Contextual       (disabled) ││ ← Grayed out
│  │ "You mentioned..."          ││
│  └─────────────────────────────┘│
│                                 │
│  🔄 Next update in 23s          │ ← Rotating icon
│  ██████████████░░░░░░░░         │ ← Animated bar
│                                 │
└─────────────────────────────────┘
```

---

**Ready to test?** Follow steps 1-3 above! 🚀
