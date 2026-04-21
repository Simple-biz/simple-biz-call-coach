# Plan: Call History Management — Filters, Multi-Select, Bulk Actions

**Date:** April 21, 2026
**Author:** Kayser B
**Status:** Draft — pending review
**Target version:** v2.2.9
**Depends on:** v2.2.8 — PR #71 (feat/local-call-history) merged

---

## Goal

Add full-featured history management to the Call History tab:

1. **Single-call delete** — trash icon per row with confirmation
2. **Filter chips** — multi-select: Positive / Negative / Interested / Not interested / Callback agreed
3. **Date range filter** — Today / Last 7 days / Last 30 days / All
4. **Multi-select mode** — checkboxes, select all, bulk actions
5. **Bulk actions** — delete selected, download selected as TXT / JSON
6. **Download all (filtered)** — single-click export of everything currently visible

**Non-goals for this PR:**
- Search by customer/business name (future)
- Custom date range picker (presets only)
- Cloud sync or S3 export

**Zero cloud cost** — all operations are local (IndexedDB + browser download).

---

## Features

### 1. Single-call delete

Trash icon on each row in the history list.

```
John Doe                                    🗑️
Callback agreed · Positive
Today · 4:00 PM · 3m 28s
```

- Click trash → native `confirm()` dialog: *"Delete this call transcript?"*
- On confirm: `deleteTranscript(conversationId)` → remove from list optimistically
- Icon has `stopPropagation` so it doesn't also open the detail view

---

### 2. Filter bar — sentiment + intent (multi-select)

Horizontal chip bar at the top of the list. **Multiple chips can be active at once** (combines with AND across categories, OR within a category).

```
┌─────────────────────────────────────────────────┐
│  [Today ▾]  [ Positive ]  [ Negative ]          │
│  [ Interested ]  [ Not interested ]              │
│  [ Callback agreed ]                             │
└─────────────────────────────────────────────────┘
```

**Filter groups:**

| Group | Chips | Mode |
|-------|-------|:----:|
| Sentiment | Positive, Negative | Multi (OR) |
| Intent | Interested, Not interested, Callback agreed | Multi (OR) |

**Logic:** `(any active sentiment matches) AND (any active intent matches)`.
If no chips are active in a group, that group doesn't filter.

**Example:**
- `Positive` + `Interested` + `Callback agreed` active
- Shows calls where sentiment is positive AND (interested OR callback agreed)

**Styling:**
- Active chip: solid `bg-[#1B1F6B] text-white`
- Inactive chip: outlined `border border-[#dddddd] text-[#333333]`

---

### 3. Date range filter

Dropdown/button at the far left of the filter bar.

```
[ Today ▾ ]
  └─ Today
     Last 7 days
     Last 30 days
     All time
```

**Logic:**

| Option | Filter |
|--------|--------|
| Today | `endedAt >= todayStart` |
| Last 7 days | `endedAt >= now - 7 days` |
| Last 30 days | `endedAt >= now - 30 days` |
| All time | No filter (default) |

Starts on **All time** by default on mount.

---

### 4. Multi-select mode

Toggleable mode. When OFF: rows are clickable to open details. When ON: checkboxes appear, clicks toggle selection.

**Entering multi-select:**
Small "Select" link in the header toggles it.

```
Call History        [Select]  🔄  📥
```

**In multi-select mode:**
```
Call History                    [Cancel]
  ┌─────────────────────────────────────┐
  │ ☑️  Select all (12 calls)           │
  └─────────────────────────────────────┘

  ☑️  📞 John Doe
     Callback agreed · Positive

  ☐  📞 Mickey Smith
     Not interested · Neutral
```

When at least 1 item is selected, a **floating action bar** appears at the bottom:

```
┌────────────────────────────────────────┐
│ 3 selected                              │
│ [🗑️ Delete] [📥 TXT] [📥 JSON] [Cancel]│
└────────────────────────────────────────┘
```

**Behavior:**
- Delete: native `confirm("Delete 3 transcripts?")` → batch `deleteTranscript()` calls
- Download TXT: one bundled TXT file with all selected calls
- Download JSON: one JSON file containing an array of selected records
- Cancel: exits multi-select, clears selection

---

### 5. "Download all (filtered)" shortcut

The 📥 button in the header (not multi-select mode) downloads all currently-visible (i.e., filtered) calls into one TXT file.

```
Call Coach History Export
Date range: Last 7 days
Filters: Positive, Callback agreed
Exported: Apr 20, 2026 5:45 PM
Total calls: 12

=====================================
CALL 1 of 12
=====================================
[full transcript with intelligence dashboard]

=====================================
CALL 2 of 12
=====================================
...
```

**Filename:** `call-coach-history-{date-range}-{YYYY-MM-DD}.txt`
e.g. `call-coach-history-last-7-days-2026-04-20.txt`

---

## Files to Change

### Modified

| File | Change |
|------|--------|
| `src/components/HistoryTab.tsx` | Complete overhaul — adds filter bar, multi-select state, checkboxes, floating action bar, delete handlers, bulk download |
| `package.json`, `vite.config.ts`, `src/background/index.ts` | Version bump 2.2.8 → 2.2.9 |

### No changes to

- `src/utils/history-store.ts` — `deleteTranscript()` already exists, maybe add `deleteTranscripts(ids[])` for bulk
- `src/components/TranscriptDetail.tsx` — unchanged
- Background lambda / infra — all client-side

### Possibly new (helper module)

- `src/utils/history-export.ts` — extracts the TXT bundling logic so it's reusable between per-call download, "download all", and bulk multi-select download

---

## State Shape

```typescript
// HistoryTab component state
const [calls, setCalls]         = useState<CallHistoryRecord[]>([]);
const [selected, setSelected]   = useState<CallHistoryRecord | null>(null); // detail view
const [loading, setLoading]     = useState(true);

// NEW
const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('all');
const [sentimentFilters, setSentimentFilters] = useState<Set<'positive' | 'negative'>>(new Set());
const [intentFilters, setIntentFilters]       = useState<Set<string>>(new Set());
const [multiSelectMode, setMultiSelectMode]   = useState(false);
const [selectedIds, setSelectedIds]           = useState<Set<string>>(new Set());
```

Filter is derived (no re-fetch needed):
```typescript
const filtered = useMemo(
  () => calls.filter(c => matchesFilter(c, { dateRange, sentimentFilters, intentFilters })),
  [calls, dateRange, sentimentFilters, intentFilters]
);
```

---

## Data Flow

### Single delete
```
Click trash → confirm() → deleteTranscript(id) →
  setCalls(calls => calls.filter(c => c.conversationId !== id))
```

### Batch delete
```
Enter multi-select → select IDs → click Delete →
  confirm(`Delete ${n} transcripts?`) →
  Promise.all(ids.map(deleteTranscript)) →
  setCalls(calls => calls.filter(c => !selectedIds.has(c.conversationId))) →
  exit multi-select
```

### Batch download (TXT)
```
Click TXT in action bar →
  buildBundleText(selectedRecords, { dateRange, filters }) →
  downloadBlob(text, filename, 'text/plain') →
  exit multi-select
```

---

## Effort

| Task | Time |
|------|:----:|
| Extract `history-export.ts` helper (reuse across 3 download actions) | 1 hr |
| Date range dropdown + filter logic | 45 min |
| Sentiment + intent chip bar (multi-select) | 1 hr |
| Single delete button + confirm | 45 min |
| Multi-select mode (toggle, checkboxes, select all) | 1.5 hrs |
| Floating action bar (delete / TXT / JSON / cancel) | 1 hr |
| "Download all (filtered)" header button | 30 min |
| Empty states ("No calls match filters", "No calls to select") | 30 min |
| Styling polish + mobile-narrow layout testing | 1 hr |
| Version bump + commit + PR | 30 min |
| **Total** | **~8 hrs (1 day)** |

---

## Testing

Manual:
1. Complete 6+ calls with varied outcomes (positive/negative, different intents, spread over several days)
2. Open History → all calls visible
3. Apply Date Range "Today" → verify list narrows
4. Toggle "Positive" chip → combines with date filter
5. Toggle "Interested" chip → combines further
6. Click trash on one call → confirm → call disappears
7. Tap "Select" → checkboxes appear → select 3 → action bar shows "3 selected"
8. Click "Delete" in action bar → confirm → 3 calls removed
9. Re-enter multi-select → select all → "Download TXT" → verify bundled TXT
10. Click "Download JSON" → verify valid JSON array
11. Exit multi-select → Download all (header 📥) → verify respects active filters
12. Clear filters → verify all records return

---

## Open Questions

1. **Multi-select toggle — explicit button or long-press?** Recommend: **explicit "Select" button** — discoverable and keyboard-friendly. Long-press is hidden.

2. **Delete confirmation — native `confirm()` or custom modal?** Recommend: **native for v2.2.9**. Can polish to a styled modal later if ugly.

3. **Filter chips — multi-select or single-select?** Recommend: **multi-select** (as drafted) — more powerful for manager reviews. Default state is "none active" = show all.

4. **Date range presets — include custom date picker?** Recommend: **presets only for v2.2.9**. Custom range picker is a future PR.

5. **Selection persists when switching filters?** E.g., select 3 calls → toggle filter → some are now hidden. Are they still selected? Recommend: **yes, selection persists but only visible items show in "X selected" count**. Simpler state model.

6. **Download scope in multi-select — only selected, or all filtered?** Recommend: **only selected**. Header 📥 button handles "all filtered" scenario. Keeps each button's purpose clear.

---

## Rollback

Pure frontend, additive. `git revert` + rebuild. No data migration needed.

---

## Summary

- **1 file overhauled** (`HistoryTab.tsx`) + 1 new helper
- **6 new behaviors** (delete, sentiment filter, intent filter, date range filter, multi-select, bulk actions)
- **~1 day of work**
- **Zero cloud cost**
- **Reversible** via simple revert

If you approve, I'll implement in this order:
1. `history-export.ts` helper
2. Date range dropdown
3. Sentiment + intent chips
4. Single delete
5. Multi-select mode
6. Bulk action bar + batch downloads
7. Download all shortcut

Each step buildable + testable independently.
