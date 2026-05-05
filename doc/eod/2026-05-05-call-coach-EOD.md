# Call Coach Chrome Extension — End of Day Report

**Date:** May 5, 2026
**Developer:** Kayser B
**Project:** DevAssist-Call-Coach
**Version:** 2.2.11 → **2.2.12**

---

## Session Overview

**Focus:** Bug fix — Call Coach auto-recording on idle CallTools pages after v2.2.11 Deepgram key fix.

**Outcome:** 1 PR shipped and merged to `main` (#90). Version bumped to 2.2.12.

---

## Commits Today

| Commit | Message |
|--------|---------|
| `db767f7` | fix: prevent auto-recording on idle CallTools page (v2.2.12) (#90) |

---

## Accomplishments

### ✅ PR #90 — False call detection fix (v2.2.12)

**Problem:** After v2.2.11 went live with the rotated Deepgram key, agents reported that Call Coach started auto-recording and transcribing immediately on page load — even when not on a call.

**Root cause (two bugs combining):**

1. **Overly broad DOM selector (Method 3):** Call detection used `button[color="warn"]` to check for a visible hangup button. The CallTools UI has a "Decline" button (`color="warn"`, class `dyn-phone-hangup`) inside an `<incoming-call hidden="">` component that is present in the DOM at all times. Angular's `hidden` attribute on a custom component element does not make `offsetParent` null in JavaScript, so our visibility check saw the button as "visible" on every page load — even with no call active.

2. **`coachingPending=true` restored from storage:** After every call ends, the background sets `coachingPending=true` and persists it to `chrome.storage.local` so coaching auto-arms for the next call. On service worker restart, this flag is restored. Combined with the false `CALL_STARTED` from Bug #1, coaching auto-started on every page load.

**Why it wasn't visible before v2.2.11:** The same false detection was happening all along, but the broken Deepgram key caused every Deepgram WebSocket to immediately error and disconnect — so no transcription occurred. The v2.2.11 key fix made Deepgram work correctly, which exposed the pre-existing detection bug.

**Fix (`src/content/index.ts`):**

1. **Tightened call detection logic** — Method 3 (hangup button) is no longer sufficient alone to declare a call active. Only Method 1 (call timer in `HH:MM:SS` format) or Method 2 (status text containing "on a call") can confirm a call. The hangup button now only acts as corroborating evidence.

2. **Removed the 1-second initial check debounce bypass** — A `setTimeout` at page load was calling `isCallActive()` once and immediately firing `CALL_STARTED` if it returned true, bypassing the 3-confirmation debounce entirely. Removed this block; real call detection now goes through the polling loop (2s interval, 3 confirmations), with WebRTC track events (`AUDIO_TRACKS_READY`) handling instant detection for actual calls.

**Files touched (4):** `src/content/index.ts` (logic fix) + version bump in `package.json`, `vite.config.ts`, `src/background/index.ts`.

---

## Deployment Notes

- **CI/CD:** Deploy workflow fires on push to `main` — version bump in the squash commit triggered a full rebuild + Chrome Web Store upload + publish.
- **PR #90 merged:** 2026-05-05.

---

## Agent Update Message

> Call Coach v2.2.12 is live! Reload the extension to get the update.
>
> What's new:
>
> 🔧 Fixed — Call Coach was automatically starting to record when you opened it, even without an active call. It will now only activate when a real call begins.
>
> To update:
>
> Go to Manage extensions.
> On the upper left click the 'Update' Button.
> Once the popup message on the lower left says 'Extensions Updated' then you're good to go. Happy call-coachin everyone!
