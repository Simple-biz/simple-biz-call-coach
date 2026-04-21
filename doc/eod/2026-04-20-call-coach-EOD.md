# Call Coach Chrome Extension — End of Day Report

**Date:** April 20, 2026
**Developer:** Kayser B
**Project:** DevAssist-Call-Coach

---

## Session Overview

**Focus:** Popup UX fix, local call history storage + viewer, weekly billing request, prior EOD reports.

**Outcome:** 5 commits landed today. 2 PRs shipped and merged (#69), 1 feature branch in review (`feat/local-call-history`). Versions bumped 2.2.6 → 2.2.7 → 2.2.8.

---

## Commits Today

| Commit | Message |
|--------|---------|
| `28494f4` | feat(request): add weekly billing and usage request for April 13-19, 2026 |
| `a8ebf19` | fix(popup): close popup after sidebar opens (v2.2.7) |
| `10c1fab` | fix(popup): close popup after sidebar opens (v2.2.7) (#69) |
| `090674c` | chore: bump version to 2.2.8 and implement call history feature |
| `6b532f0` | feat(history): capture destination, entities, intelligence; add download buttons |

---

## Accomplishments

### 1. ✅ PR #69 — Close popup after sidebar opens (v2.2.7)

**Commits:** `a8ebf19` → merged as `10c1fab`

**Problem:** When an agent clicked "Start Coaching", the sidebar opened but the popup stayed visible with the Start Coaching button still there. Some agents clicked it again, triggering duplicate coaching starts.

**Fix:** Added `window.close()` after `chrome.sidePanel.open()` succeeds so the popup dismisses itself once coaching is underway.

**Files changed:**
- `src/popup/Popup.tsx` — +2 lines
- `package.json`, `vite.config.ts`, `src/background/index.ts` — version bump to 2.2.7

**Edge cases preserved:**
- Sidebar fails to open → popup stays open (user needs to see/retry)
- Validation fails (no tab, wrong URL) → popup stays open with alert
- Exception during start → popup stays open with alert
- Double-click protection (`disabled={isStarting}`) still in place

---

### 2. ✅ EOD reports + weekly billing request doc

**Commit:** `28494f4`

Added three documentation files:
- `doc/eod/2026-04-15-call-coach-EOD.md` — backfill EOD for Wed (trim window, identity framing, hostile detection)
- `doc/eod/2026-04-17-call-coach-EOD.md` — backfill EOD for Fri (OpenAI failover shipped as PR #65)
- `doc/requests/2026-04-20-weekly-billing-usage-request.md` — request for Cobb for weekly cost & usage breakdown (April 13–19) at 12-15 active users

---

### 3. 🔨 Local Call History Feature (v2.2.8) — `feat/local-call-history` branch

Two commits on the feature branch, pushed to origin, awaiting PR.

#### Commit `090674c` — Initial implementation

- **Data layer:** `src/utils/history-store.ts` — IndexedDB wrapper with `saveTranscript`, `listTranscripts`, `getTranscript`, `pruneOldTranscripts`, `deleteTranscript`, `countTranscripts`
- **Background hooks:** On `CALL_ENDED` (port-based, runtime-message, webhook paths), snapshot transcript and save to IndexedDB
- **Call start tracking:** `currentCallStartedAt` module variable set on `CALL_STARTED` to record duration
- **UI — History tab:** `src/components/HistoryTab.tsx` — list view grouped by day with refresh button and empty state
- **UI — Transcript detail:** `src/components/TranscriptDetail.tsx` — chat-bubble style transcript with back navigation
- **SidePanel integration:** Added Live / History toggle at top, conditional rendering based on view mode
- **Retention:** Auto-prune transcripts older than 90 days on extension startup
- **Per-agent scoping:** Records keyed by `conversationId`, filtered by `agentEmail` in the list view
- **Plan doc:** `doc/plans/2026-04-20-local-call-history-storage.md`

#### Commit `6b532f0` — Capture more data + download buttons

**Destination capture:**
- Hooked `message.destination` from CALL_STARTED (port + runtime handlers)
- Added `currentCallDestination` module variable alongside `currentCallStartedAt`
- Captures destination from content script DOM scrape OR webhook `payload.destination`

**Intelligence + entities in records:**
- Stashed `latestIntelligence` and `latestEntities` on `ExtensionState` during `INTELLIGENCE_UPDATE`
- Included in `CallHistoryRecord` via `saveTranscript()` call
- Cleared on each new `CALL_STARTED` so records don't inherit stale data
- Extended `CallHistoryRecord` schema with `intelligence` and `entities` fields

**Smarter labels in list:**
- Label priority: phone number → customer name → business name → date/time
- Removed "Unknown number" text entirely
- Secondary row shows outcome (derived from top intent) + sentiment (color-coded: green/red/gray)

**Transcript detail enhancements:**
- Intelligence panel at top showing: Customer Sentiment, Confidence, Business, Website Status, Phone, Email, Website, Location, Dates, People, Customer Intent, Discussion Topics, Summary
- TXT download button — matches live export format (includes intelligence dashboard + full transcript)
- JSON download button — full `CallHistoryRecord` for archival/import

---

### 4. ✅ Cost audit

Ran comprehensive cost-spike audit on the codebase. Findings:

- ✅ No DynamoDB Scan operations anywhere (the original $500 culprit)
- ✅ TTL on all DynamoDB tables (2h connections, 24h events)
- ✅ Lambda timeouts properly set
- ✅ PostgreSQL connection pool bounded (max: 2)
- ✅ WebSocket reconnect with exponential backoff + 5-attempt max
- ✅ CloudWatch log retention at 1 week
- 🟡 No client-side throttle on `getIntelligence` — flagged as future mitigation (UI has 4 layers of button protection so risk is low; only real attack vector is external scripting)

No immediate action taken. Fix queued for future session.

---

## PRs

| PR | Title | Version | Status |
|----|-------|---------|--------|
| [#69](https://github.com/Simple-biz/simple-biz-call-coach/pull/69) | fix(popup): close popup after sidebar opens | 2.2.7 | Merged |
| [#71](https://github.com/Simple-biz/simple-biz-call-coach/pull/71) | feat(history): local call history storage with IndexedDB + sidebar viewer | 2.2.8 | Open |

---

## Files Changed Today

| File | Commits |
|------|---------|
| `src/popup/Popup.tsx` | `a8ebf19` |
| `src/utils/history-store.ts` | `090674c` (new) |
| `src/components/HistoryTab.tsx` | `090674c` (new), `6b532f0` |
| `src/components/TranscriptDetail.tsx` | `090674c` (new), `6b532f0` |
| `src/sidepanel/SidePanel.tsx` | `090674c` |
| `src/background/index.ts` | `a8ebf19`, `090674c`, `6b532f0` |
| `doc/plans/2026-04-20-local-call-history-storage.md` | `090674c` (new) |
| `doc/eod/2026-04-15-call-coach-EOD.md` | `28494f4` (new) |
| `doc/eod/2026-04-17-call-coach-EOD.md` | `28494f4` (new) |
| `doc/requests/2026-04-20-weekly-billing-usage-request.md` | `28494f4` (new) |
| `package.json`, `vite.config.ts` | Version bumps to 2.2.7, then 2.2.8 |
