# Plan: Save Transcripts Locally + History Viewer

**Date:** April 20, 2026
**Author:** Kayser B
**Status:** Draft — pending review
**Target version:** v2.2.8

---

## Goal

1. Save each completed call's **transcript** locally on the agent's machine (IndexedDB)
2. Add a **"History" button/tab in the sidebar** so the agent can see and review past call transcripts

**Non-goals:**
- No AI tips or intelligence saved (transcripts only)
- No cloud changes
- No export/search/star/edit features yet — just view

---

## Two parts to this

### Part 1 — Data layer (save transcripts locally)

When a call ends, snapshot the transcript to IndexedDB.

### Part 2 — UI (view past transcripts)

Add a "History" tab to the sidebar that lists past calls and shows the transcript when one is selected.

---

## Data Layer

### What gets saved

One record per completed call:

```typescript
{
  conversationId: string;
  agentEmail: string;
  startedAt: number;       // epoch ms
  endedAt: number;         // epoch ms
  destination?: string;    // phone dialed (from CALL_ENDED webhook, if available)
  transcript: Array<{
    speaker: 'agent' | 'caller';
    text: string;
    timestamp: number;
  }>;
}
```

Only `isFinal: true` transcript entries are kept (skip interim chunks).

### Storage

- **IndexedDB** database: `call-coach-history`
- **Object store:** `transcripts`
- **Key:** `conversationId`
- **Indices:** `agentEmail`, `endedAt`
- **Retention:** auto-prune >90 days old, on extension startup

### When it saves

On `CALL_ENDED`, the background service worker snapshots `extensionState.transcriptions`, assembles the record, and fires `saveTranscript(record)` — fire-and-forget.

If save fails, log and continue. Never block normal cleanup.

---

## UI Layer

### Where it lives

**Inside the sidebar.** Agents already use the sidebar for live coaching — natural extension.

### How it looks

**Top-of-sidebar view toggle:**

```
┌─────────────────────────────────┐
│  [ Live ]   [ History ]         │   ← toggle at top
├─────────────────────────────────┤
│                                  │
│  (current live view OR           │
│   history list, depending        │
│   on toggle)                     │
│                                  │
└─────────────────────────────────┘
```

When `Live` is selected (default): existing coaching UI — unchanged.

When `History` is selected: new list view showing past calls.

### History list view

```
┌─────────────────────────────────┐
│  [ Live ]   [ History* ]        │
├─────────────────────────────────┤
│  Today                           │
│  ─────────────────               │
│  📞 +1 (555) 234-1234   3m 22s  │
│  11:42 AM                        │
│                                  │
│  📞 +1 (555) 890-7654   1m 05s  │
│  10:18 AM                        │
│                                  │
│  Yesterday                       │
│  ─────────────────               │
│  📞 +1 (555) 444-9999   5m 48s  │
│  4:32 PM                         │
│                                  │
│  ...                             │
└─────────────────────────────────┘
```

Each row shows:
- Phone number dialed (if captured)
- Duration
- Time of day

Grouped by day (Today / Yesterday / MMM DD).

### Transcript detail view

Tap a row → expand/drill into full transcript:

```
┌─────────────────────────────────┐
│  ← Back to History               │
├─────────────────────────────────┤
│  +1 (555) 234-1234               │
│  Today at 11:42 AM · 3m 22s     │
├─────────────────────────────────┤
│                                  │
│  AGENT: Hi, is this John?        │
│  CALLER: Yeah, who's this?       │
│  AGENT: Bob and I are local web… │
│  CALLER: Oh, we already have…    │
│  ...                             │
│                                  │
└─────────────────────────────────┘
```

Scrollable. Plain text. No fancy formatting.

### Empty states

- **No calls yet:** `"No calls saved yet. Your completed calls will appear here."`
- **IndexedDB unavailable:** `"History unavailable — please reload the extension."`

---

## Files

### New files

| File | Purpose |
|------|---------|
| `src/utils/history-store.ts` | IndexedDB wrapper (`saveTranscript`, `listTranscripts`, `getTranscript`, `pruneOldTranscripts`) |
| `src/sidepanel/components/HistoryTab.tsx` | List view of past calls |
| `src/sidepanel/components/TranscriptDetail.tsx` | Full transcript display |

### Modified files

| File | Change |
|------|--------|
| `src/background/index.ts` | On `CALL_ENDED`, save transcript + run prune on startup |
| `src/sidepanel/SidePanel.tsx` | Add Live / History toggle at top; conditionally render HistoryTab |
| `package.json`, `vite.config.ts`, `src/background/index.ts` | Version bump 2.2.7 → 2.2.8 |

---

## Effort

| Task | Time |
|------|:----:|
| `history-store.ts` (IndexedDB wrapper) | 2 hrs |
| Hook into `CALL_ENDED` + prune logic | 1 hr |
| `HistoryTab` list component | 2 hrs |
| `TranscriptDetail` view + back navigation | 1 hr |
| Live/History toggle in SidePanel | 1 hr |
| Manual test + commit | 1 hr |
| **Total** | **~8 hrs (1 day)** |

---

## Testing

Manual:
1. Build + reload extension
2. Complete 2-3 real calls
3. Open sidebar → click **History** toggle
4. Verify list shows all completed calls with right dates/durations
5. Click a call → verify full transcript displays
6. Click back → verify returns to list
7. DevTools → IndexedDB → confirm records persist across browser restart

---

## Cost Impact

**Zero.**

- IndexedDB lives on the agent's browser — no AWS, no APIs, no network
- No new Lambda invocations
- No new database bills
- Agent disk usage: ~30-50 KB per call, 90-day auto-prune keeps total well under 100 MB

---

## Rollback

Pure frontend, additive:

```bash
git revert <commit>
npm run build
# Reload extension
```

Stale IndexedDB records on agent machines are harmless — future versions can clear or migrate them.

---

## Summary

- **Data:** 1 new utility file, 1 hook in background service worker
- **UI:** 2 new components + a toggle in the existing sidebar
- **~1 day of work**
- **Zero cloud cost**

Ship as one PR for a cohesive feature (data + viewer together), or split into two PRs (data-only first, UI second) — your call.
