import { useEffect, useMemo, useRef, useState } from 'react';
import { Phone, ChevronRight, RefreshCw, Trash2, Download, X, Check } from 'lucide-react';
import {
  listTranscripts,
  deleteTranscript,
  type CallHistoryRecord,
} from '@/utils/history-store';
import {
  downloadBundleAsText,
  downloadBundleAsJSON,
  getCallLabel,
} from '@/utils/history-export';
import { TranscriptDetail } from './TranscriptDetail';

interface HistoryTabProps {
  agentEmail?: string | null;
}

type DateRange = 'today' | '7d' | '30d' | 'all';
type Sentiment = 'positive' | 'negative';
type IntentFilter = 'interested' | 'not_interested' | 'request_callback';

const INTENT_LABELS: Record<IntentFilter, string> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  request_callback: 'Callback agreed',
};

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
};

export function HistoryTab({ agentEmail }: HistoryTabProps) {
  const [calls, setCalls] = useState<CallHistoryRecord[]>([]);
  const [selected, setSelected] = useState<CallHistoryRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [sentimentFilters, setSentimentFilters] = useState<Set<Sentiment>>(new Set());
  const [intentFilters, setIntentFilters] = useState<Set<IntentFilter>>(new Set());
  const [dateMenuOpen, setDateMenuOpen] = useState(false);

  // Multi-select
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadCalls = async () => {
    setLoading(true);
    try {
      const results = await listTranscripts({
        agentEmail: agentEmail || undefined,
        limit: 500,
      });
      setCalls(results);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalls();
  }, [agentEmail]);

  // ── Filtering ──
  const filtered = useMemo(
    () => calls.filter(c => matchesFilter(c, { dateRange, sentimentFilters, intentFilters })),
    [calls, dateRange, sentimentFilters, intentFilters]
  );

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    sentimentFilters.forEach(s => labels.push(capitalize(s)));
    intentFilters.forEach(i => labels.push(INTENT_LABELS[i]));
    return labels;
  }, [sentimentFilters, intentFilters]);

  const hasActiveFilters = dateRange !== 'all' || sentimentFilters.size > 0 || intentFilters.size > 0;

  const clearFilters = () => {
    setDateRange('all');
    setSentimentFilters(new Set());
    setIntentFilters(new Set());
  };

  // ── Multi-select helpers ──
  const enterMultiSelect = () => {
    setMultiSelect(true);
    setSelectedIds(new Set());
  };
  const exitMultiSelect = () => {
    setMultiSelect(false);
    setSelectedIds(new Set());
  };
  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allVisibleSelected =
    filtered.length > 0 && filtered.every(c => selectedIds.has(c.conversationId));
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.conversationId)));
    }
  };

  const selectedRecords = useMemo(
    () => filtered.filter(c => selectedIds.has(c.conversationId)),
    [filtered, selectedIds]
  );

  // ── Delete handlers ──
  const handleDeleteSingle = async (id: string) => {
    if (!confirm('Delete this call transcript? This cannot be undone.')) return;
    await deleteTranscript(id);
    setCalls(prev => prev.filter(c => c.conversationId !== id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} transcript${count === 1 ? '' : 's'}? This cannot be undone.`)) return;

    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id => deleteTranscript(id)));
    setCalls(prev => prev.filter(c => !selectedIds.has(c.conversationId)));
    exitMultiSelect();
  };

  // ── Download handlers ──
  const filenameSuffix = () => {
    const parts: string[] = [];
    if (dateRange !== 'all') parts.push(DATE_RANGE_LABELS[dateRange].toLowerCase().replace(/\s+/g, '-'));
    sentimentFilters.forEach(s => parts.push(s));
    intentFilters.forEach(i => parts.push(i.replace(/_/g, '-')));
    if (parts.length === 0) return 'all';
    return parts.join('_');
  };

  const handleDownloadAll = () => {
    if (filtered.length === 0) return;
    downloadBundleAsText(filtered, filenameSuffix(), {
      dateRange: DATE_RANGE_LABELS[dateRange],
      filters: activeFilterLabels,
    });
  };

  const handleBulkDownloadText = () => {
    if (selectedRecords.length === 0) return;
    downloadBundleAsText(selectedRecords, `selected-${selectedRecords.length}`, {
      filters: activeFilterLabels,
    });
    exitMultiSelect();
  };

  const handleBulkDownloadJSON = () => {
    if (selectedRecords.length === 0) return;
    downloadBundleAsJSON(selectedRecords, `selected-${selectedRecords.length}`);
    exitMultiSelect();
  };

  // ── Detail view takeover ──
  if (selected) {
    return <TranscriptDetail record={selected} onBack={() => setSelected(null)} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading history...
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-8 text-gray-500">
        <Phone className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm">No calls saved yet.</p>
        <p className="text-xs mt-1">Your completed calls will appear here.</p>
      </div>
    );
  }

  const grouped = groupByDay(filtered);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Call History
        </h2>
        <div className="flex items-center gap-2">
          {!multiSelect ? (
            <>
              <button
                onClick={enterMultiSelect}
                className="text-xs font-medium text-[#1B1F6B] hover:underline"
              >
                Select
              </button>
              <button
                onClick={handleDownloadAll}
                disabled={filtered.length === 0}
                className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Download all visible calls"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={loadCalls}
                className="p-1 text-gray-500 hover:text-gray-700"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={exitMultiSelect}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Filter bar: date button kept outside scrollable chip row so its dropdown isn't clipped */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <DateRangeButton
          dateRange={dateRange}
          open={dateMenuOpen}
          onToggle={() => setDateMenuOpen(v => !v)}
          onSelect={range => {
            setDateRange(range);
            setDateMenuOpen(false);
          }}
        />
        <div className="flex items-center gap-2 overflow-x-auto">
          <Chip
            active={sentimentFilters.has('positive')}
            onClick={() => toggleInSet(sentimentFilters, setSentimentFilters, 'positive')}
          >
            Positive
          </Chip>
          <Chip
            active={sentimentFilters.has('negative')}
            onClick={() => toggleInSet(sentimentFilters, setSentimentFilters, 'negative')}
          >
            Negative
          </Chip>
          <Chip
            active={intentFilters.has('interested')}
            onClick={() => toggleInSet(intentFilters, setIntentFilters, 'interested')}
          >
            Interested
          </Chip>
          <Chip
            active={intentFilters.has('not_interested')}
            onClick={() => toggleInSet(intentFilters, setIntentFilters, 'not_interested')}
          >
            Not interested
          </Chip>
          <Chip
            active={intentFilters.has('request_callback')}
            onClick={() => toggleInSet(intentFilters, setIntentFilters, 'request_callback')}
          >
            Callback agreed
          </Chip>
        </div>
      </div>

      {/* Select-all row (multi-select mode) */}
      {multiSelect && filtered.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300">
          <button
            onClick={toggleSelectAll}
            className={`flex items-center justify-center w-4 h-4 rounded border ${
              allVisibleSelected
                ? 'bg-[#1B1F6B] border-[#1B1F6B]'
                : 'border-gray-400 bg-white'
            }`}
          >
            {allVisibleSelected && <Check className="w-3 h-3 text-white" />}
          </button>
          <span>
            {allVisibleSelected ? 'Deselect all' : 'Select all'} ({filtered.length} call{filtered.length === 1 ? '' : 's'})
          </span>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-8 text-gray-500">
            <p className="text-sm">No calls match these filters.</p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs font-medium text-[#1B1F6B] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          grouped.map(({ label: dayLabel, items }) => (
            <div key={dayLabel}>
              <div className="sticky top-0 px-4 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 uppercase z-[1]">
                {dayLabel}
              </div>
              {items.map(call => {
                const callLabel = getCallLabel(call);
                const outcome = getOutcomeLabel(call);
                const sentiment = call.intelligence?.sentiment?.label;
                const checked = selectedIds.has(call.conversationId);

                return (
                  <div
                    key={call.conversationId}
                    className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                  >
                    {multiSelect ? (
                      <button
                        onClick={() => toggleId(call.conversationId)}
                        className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                          checked
                            ? 'bg-[#1B1F6B] border-[#1B1F6B]'
                            : 'border-gray-400 bg-white'
                        }`}
                        aria-label={checked ? 'Deselect' : 'Select'}
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </button>
                    ) : (
                      <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                    )}

                    <button
                      onClick={() =>
                        multiSelect ? toggleId(call.conversationId) : setSelected(call)
                      }
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {callLabel}
                      </div>
                      {(outcome || sentiment) && (
                        <div className="flex items-center gap-2 mt-0.5">
                          {outcome && (
                            <span className="text-xs font-medium text-[#1B1F6B] dark:text-blue-300">
                              {outcome}
                            </span>
                          )}
                          {sentiment && (
                            <span
                              className={`text-xs font-medium ${getSentimentClass(sentiment)}`}
                            >
                              · {capitalize(sentiment)}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        <span>{formatTime(call.endedAt)}</span>
                        <span>·</span>
                        <span>{formatDuration(call.startedAt, call.endedAt)}</span>
                        <span>·</span>
                        <span>{call.transcript.length} lines</span>
                      </div>
                    </button>

                    {!multiSelect && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSingle(call.conversationId);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          title="Delete"
                          aria-label="Delete call"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Floating action bar (multi-select) */}
      {multiSelect && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#1B1F6B] text-white shrink-0">
          <span className="text-xs font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600 hover:bg-red-700 rounded"
              title="Delete selected"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
            <button
              onClick={handleBulkDownloadText}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-white/20 hover:bg-white/30 rounded"
              title="Download selected as text"
            >
              <Download className="w-3 h-3" />
              TXT
            </button>
            <button
              onClick={handleBulkDownloadJSON}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-white/20 hover:bg-white/30 rounded"
              title="Download selected as JSON"
            >
              <Download className="w-3 h-3" />
              JSON
            </button>
            <button
              onClick={exitMultiSelect}
              className="p-1 hover:bg-white/20 rounded"
              title="Cancel"
              aria-label="Cancel multi-select"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small sub-components ──

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
        active
          ? 'bg-[#1B1F6B] text-white border border-[#1B1F6B]'
          : 'bg-white dark:bg-gray-800 text-[#333333] dark:text-gray-300 border border-[#dddddd] dark:border-gray-600 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function DateRangeButton({
  dateRange,
  open,
  onToggle,
  onSelect,
}: {
  dateRange: DateRange;
  open: boolean;
  onToggle: () => void;
  onSelect: (r: DateRange) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onToggle]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-white dark:bg-gray-800 text-[#333333] dark:text-gray-300 border border-[#dddddd] dark:border-gray-600 hover:bg-gray-50 whitespace-nowrap"
      >
        {DATE_RANGE_LABELS[dateRange]}
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg z-50 min-w-[140px]">
          {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => onSelect(r)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${
                r === dateRange ? 'font-semibold text-[#1B1F6B]' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {DATE_RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pure helpers ──

function toggleInSet<T>(set: Set<T>, setter: (s: Set<T>) => void, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  setter(next);
}

function matchesFilter(
  call: CallHistoryRecord,
  filters: {
    dateRange: DateRange;
    sentimentFilters: Set<Sentiment>;
    intentFilters: Set<IntentFilter>;
  }
): boolean {
  // Date range
  if (filters.dateRange !== 'all') {
    const now = Date.now();
    let cutoff: number;
    if (filters.dateRange === 'today') {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      cutoff = t.getTime();
    } else if (filters.dateRange === '7d') {
      cutoff = now - 7 * 24 * 60 * 60 * 1000;
    } else {
      cutoff = now - 30 * 24 * 60 * 60 * 1000;
    }
    if (call.endedAt < cutoff) return false;
  }

  // Sentiment (OR within group)
  if (filters.sentimentFilters.size > 0) {
    const label = call.intelligence?.sentiment?.label as Sentiment | undefined;
    if (!label || !filters.sentimentFilters.has(label)) return false;
  }

  // Intent (OR within group)
  if (filters.intentFilters.size > 0) {
    const callIntents = new Set(call.intelligence?.intents?.map(i => i.intent) ?? []);
    let match = false;
    filters.intentFilters.forEach(f => {
      if (callIntents.has(f)) match = true;
    });
    if (!match) return false;
  }

  return true;
}

function groupByDay(calls: CallHistoryRecord[]) {
  const groups = new Map<string, CallHistoryRecord[]>();
  for (const c of calls) {
    const label = dayLabelFn(c.endedAt);
    const bucket = groups.get(label) ?? [];
    bucket.push(c);
    groups.set(label, bucket);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function dayLabelFn(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const callDay = new Date(d);
  callDay.setHours(0, 0, 0, 0);

  if (callDay.getTime() === today.getTime()) return 'Today';
  if (callDay.getTime() === yesterday.getTime()) return 'Yesterday';

  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(startedAt: number, endedAt: number): string {
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function getOutcomeLabel(call: CallHistoryRecord): string | null {
  const intents = call.intelligence?.intents || [];
  if (intents.length === 0) return null;

  const top = [...intents].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (!top) return null;

  const map: Record<string, string> = {
    request_callback: 'Callback agreed',
    not_interested: 'Not interested',
    interested: 'Interested',
    pricing_inquiry: 'Asked pricing',
    objection: 'Objection',
    purchase_intent: 'Buying signal',
    information_seeking: 'Info gathering',
  };

  return map[top.intent] || capitalize(top.intent.replace(/_/g, ' '));
}

function getSentimentClass(sentiment: string): string {
  switch (sentiment.toLowerCase()) {
    case 'positive':
      return 'text-green-600 dark:text-green-400';
    case 'negative':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-gray-500';
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
