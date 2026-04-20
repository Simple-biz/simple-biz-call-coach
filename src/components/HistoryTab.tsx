import { useEffect, useState } from 'react';
import { Phone, ChevronRight, RefreshCw } from 'lucide-react';
import { listTranscripts, type CallHistoryRecord } from '@/utils/history-store';
import { TranscriptDetail } from './TranscriptDetail';

interface HistoryTabProps {
  agentEmail?: string | null;
}

export function HistoryTab({ agentEmail }: HistoryTabProps) {
  const [calls, setCalls] = useState<CallHistoryRecord[]>([]);
  const [selected, setSelected] = useState<CallHistoryRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCalls = async () => {
    setLoading(true);
    try {
      const results = await listTranscripts({
        agentEmail: agentEmail || undefined,
        limit: 200,
      });
      setCalls(results);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalls();
  }, [agentEmail]);

  if (selected) {
    return (
      <TranscriptDetail
        record={selected}
        onBack={() => setSelected(null)}
      />
    );
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

  const grouped = groupByDay(calls);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Call History
        </h2>
        <button
          onClick={loadCalls}
          className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1">
        {grouped.map(({ label, items }) => (
          <div key={label}>
            <div className="sticky top-0 px-4 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 uppercase">
              {label}
            </div>
            {items.map(call => {
              const label = getCallLabel(call);
              const outcome = getOutcomeLabel(call);
              const sentiment = call.intelligence?.sentiment?.label;

              return (
                <button
                  key={call.conversationId}
                  onClick={() => setSelected(call)}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
                >
                  <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {label}
                    </div>
                    {(outcome || sentiment) && (
                      <div className="flex items-center gap-2 mt-0.5">
                        {outcome && (
                          <span className="text-xs font-medium text-[#1B1F6B] dark:text-blue-300">
                            {outcome}
                          </span>
                        )}
                        {sentiment && (
                          <span className={`text-xs font-medium ${getSentimentClass(sentiment)}`}>
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
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──

function groupByDay(calls: CallHistoryRecord[]) {
  const groups = new Map<string, CallHistoryRecord[]>();
  for (const c of calls) {
    const label = dayLabel(c.endedAt);
    const bucket = groups.get(label) ?? [];
    bucket.push(c);
    groups.set(label, bucket);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function dayLabel(ts: number): string {
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

// ── Call labeling helpers ──

function getCallLabel(call: CallHistoryRecord): string {
  // Priority: phone > customer name > business > date/time fallback
  if (call.destination) return call.destination;

  const person = call.entities?.people?.[0];
  if (person) return person;

  const business = call.entities?.businessNames?.[0];
  if (business) return business;

  // Final fallback: date/time
  const d = new Date(call.endedAt);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Derive a short outcome label from intents + website status.
 * Returns null if there's nothing meaningful to show.
 */
function getOutcomeLabel(call: CallHistoryRecord): string | null {
  const intents = call.intelligence?.intents || [];
  if (intents.length === 0) return null;

  // Sort by confidence, pick top
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
