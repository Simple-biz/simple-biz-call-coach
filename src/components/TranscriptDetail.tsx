import { ArrowLeft, Phone, Download } from 'lucide-react';
import type { CallHistoryRecord, HistoryIntelligence, HistoryEntities } from '@/utils/history-store';

interface TranscriptDetailProps {
  record: CallHistoryRecord;
  onBack: () => void;
}

export function TranscriptDetail({ record, onBack }: TranscriptDetailProps) {
  const endedDate = new Date(record.endedAt);
  const durationSec = Math.max(0, Math.round((record.endedAt - record.startedAt) / 1000));
  const m = Math.floor(durationSec / 60);
  const s = durationSec % 60;
  const durationStr = m === 0 ? `${s}s` : `${m}m ${s.toString().padStart(2, '0')}s`;

  // Same priority cascade as history list: phone > customer name > business > date/time
  const label =
    record.destination ||
    record.entities?.people?.[0] ||
    record.entities?.businessNames?.[0] ||
    endedDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-10">
        <button
          onClick={onBack}
          className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          aria-label="Back to history"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            <Phone className="w-4 h-4 text-gray-400" />
            {label}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {endedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {' · '}
            {endedDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            {' · '}
            {durationStr}
          </div>
        </div>
        <button
          onClick={() => downloadAsText(record, label)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-[#1B1F6B] hover:bg-[#14174f] text-white rounded transition-colors"
          title="Download as text"
        >
          <Download className="w-3 h-3" />
          TXT
        </button>
        <button
          onClick={() => downloadAsJSON(record, label)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-[#1B1F6B] hover:bg-[#14174f] text-white rounded transition-colors"
          title="Download as JSON"
        >
          <Download className="w-3 h-3" />
          JSON
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <IntelligencePanel intelligence={record.intelligence} entities={record.entities} />

        <div className="px-4 py-4 space-y-3">
          {record.transcript.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-8">
              No transcript content.
            </div>
          ) : (
            record.transcript.map((entry, idx) => (
              <div
                key={idx}
                className={`flex ${entry.speaker === 'agent' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    entry.speaker === 'agent'
                      ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100'
                      : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                  }`}
                >
                  <div className="text-[10px] uppercase font-semibold opacity-60 mb-0.5">
                    {entry.speaker === 'agent' ? 'Agent' : 'Customer'}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{entry.text}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Intelligence summary (sentiment, entities, intents, topics) ──

function IntelligencePanel({
  intelligence,
  entities,
}: {
  intelligence?: HistoryIntelligence | null;
  entities?: HistoryEntities | null;
}) {
  const sentimentLabel = intelligence?.sentiment?.label ?? 'neutral';
  const sentimentScore = intelligence?.sentiment?.score;

  const businessNames = entities?.businessNames ?? [];
  const websiteStatus = entities?.websiteStatus ?? 'unknown';
  const phones = entities?.contactInfo?.phoneNumbers ?? [];
  const emails = entities?.contactInfo?.emails ?? [];
  const urls = entities?.contactInfo?.urls ?? [];
  const locations = entities?.locations ?? [];
  const dates = entities?.dates ?? [];
  const people = entities?.people ?? [];
  const intents = intelligence?.intents ?? [];
  const topics = intelligence?.topics ?? [];

  // Hide the panel entirely if there's no intelligence data at all
  const hasAny =
    intelligence ||
    businessNames.length ||
    phones.length ||
    emails.length ||
    urls.length ||
    locations.length ||
    dates.length ||
    people.length ||
    intents.length ||
    topics.length;

  if (!hasAny) return null;

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
      <div className="text-xs font-semibold uppercase text-gray-500 mb-2">
        Conversation Intelligence
      </div>

      <Row label="Customer Sentiment" value={sentimentLabel} />
      {typeof sentimentScore === 'number' && (
        <Row label="Confidence" value={sentimentScore.toFixed(2)} />
      )}
      <Row label="Business" value={listOrDash(businessNames)} />
      <Row label="Website Status" value={formatWebsiteStatus(websiteStatus)} />
      <Row label="Phone" value={listOrDash(phones)} />
      <Row label="Email" value={listOrDash(emails)} />
      <Row label="Website" value={listOrDash(urls)} />
      <Row label="Location" value={listOrDash(locations)} />
      <Row label="Dates" value={listOrDash(dates)} />
      <Row label="People" value={listOrDash(people)} />
      <Row label="Customer Intent" value={listOrDash(intents.map(i => i.intent))} />
      <Row label="Discussion Topics" value={listOrDash(topics.map(t => t.topic))} />

      {intelligence?.summary && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="text-[10px] uppercase font-semibold text-gray-500 mb-1">Summary</div>
          <div className="text-sm text-gray-800 dark:text-gray-200">{intelligence.summary}</div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 dark:text-gray-100 text-right break-words">{value}</span>
    </div>
  );
}

function listOrDash(arr: string[]): string {
  if (!arr || arr.length === 0) return '--';
  return arr.join(', ');
}

function formatWebsiteStatus(status: 'has_website' | 'no_website' | 'unknown' | undefined): string {
  if (status === 'has_website') return 'Has website';
  if (status === 'no_website') return 'No website';
  return '--';
}

// ── Downloads ──

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9\-_]/gi, '_').slice(0, 60);
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAsText(record: CallHistoryRecord, label: string) {
  const endedDate = new Date(record.endedAt);
  const durationSec = Math.max(0, Math.round((record.endedAt - record.startedAt) / 1000));
  const m = Math.floor(durationSec / 60);
  const s = durationSec % 60;
  const durationStr = m === 0 ? `${s}s` : `${m}m ${s.toString().padStart(2, '0')}s`;

  let text = `Call Transcript Export\n`;
  text += `Call: ${label}\n`;
  text += `Date: ${endedDate.toLocaleString()}\n`;
  text += `Duration: ${durationStr}\n`;
  text += `Total lines: ${record.transcript.length}\n`;

  // Intelligence + entities dashboard
  if (record.intelligence || record.entities) {
    text += `\n${'='.repeat(50)}\n`;
    text += `CONVERSATION INTELLIGENCE\n`;
    text += `${'='.repeat(50)}\n\n`;

    const s = record.intelligence?.sentiment;
    if (s?.label) {
      const scoreStr = typeof s.score === 'number' ? ` (${Math.round(s.score * 100)}% confidence)` : '';
      text += `Sentiment: ${s.label}${scoreStr}\n`;
    }

    const e = record.entities;
    if (e) {
      if (e.businessNames?.length) text += `Business: ${e.businessNames.join(', ')}\n`;
      if (e.websiteStatus && e.websiteStatus !== 'unknown') {
        text += `Website Status: ${e.websiteStatus === 'has_website' ? 'Has Website' : 'No Website'}\n`;
      }
      if (e.contactInfo?.phoneNumbers?.length) text += `Phone: ${e.contactInfo.phoneNumbers.join(', ')}\n`;
      if (e.contactInfo?.emails?.length) text += `Email: ${e.contactInfo.emails.join(', ')}\n`;
      if (e.contactInfo?.urls?.length) text += `Website: ${e.contactInfo.urls.join(', ')}\n`;
      if (e.locations?.length) text += `Location: ${e.locations.join(', ')}\n`;
      if (e.dates?.length) text += `Dates: ${e.dates.join(', ')}\n`;
      if (e.people?.length) text += `People: ${e.people.join(', ')}\n`;
    }

    if (record.intelligence?.intents?.length) {
      text += `Intents: ${record.intelligence.intents.map(i => i.intent).join(', ')}\n`;
    }
    if (record.intelligence?.topics?.length) {
      text += `Topics: ${record.intelligence.topics.map(t => t.topic).join(', ')}\n`;
    }
    if (record.intelligence?.summary) {
      text += `\nSummary: ${record.intelligence.summary}\n`;
    }
  }

  text += `\n${'='.repeat(50)}\n`;
  text += `TRANSCRIPT\n`;
  text += `${'='.repeat(50)}\n\n`;

  record.transcript.forEach((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const speaker = entry.speaker === 'agent' ? 'Agent' : 'Customer';
    text += `[${time}] ${speaker}: ${entry.text}\n\n`;
  });

  const dateStr = endedDate.toISOString().slice(0, 10);
  downloadBlob(text, `call-${safeFilename(label)}-${dateStr}.txt`, 'text/plain');
}

function downloadAsJSON(record: CallHistoryRecord, label: string) {
  const endedDate = new Date(record.endedAt);
  const json = JSON.stringify(record, null, 2);
  const dateStr = endedDate.toISOString().slice(0, 10);
  downloadBlob(json, `call-${safeFilename(label)}-${dateStr}.json`, 'application/json');
}
