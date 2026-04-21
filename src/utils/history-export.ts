/**
 * Call History Export Helpers
 *
 * Shared logic for exporting single calls or bundles of calls as TXT / JSON.
 * Used by TranscriptDetail (single call) and HistoryTab (download all / bulk).
 */

import type { CallHistoryRecord } from './history-store';

export interface BundleMeta {
  dateRange?: string;
  filters?: string[];
}

// ── File download ──

export function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9\-_]/gi, '_').slice(0, 60);
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Label helper (mirrors HistoryTab cascade) ──

export function getCallLabel(record: CallHistoryRecord): string {
  if (record.destination) return record.destination;

  const person = record.entities?.people?.[0];
  if (person) return person;

  const business = record.entities?.businessNames?.[0];
  if (business) return business;

  const d = new Date(record.endedAt);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDurationStr(startedAt: number, endedAt: number): string {
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// ── Single-call TXT section ──

/**
 * Build the TXT representation of a single call.
 * Used standalone (single download) and as a section in bundled exports.
 */
export function buildCallText(record: CallHistoryRecord, label?: string): string {
  const callLabel = label ?? getCallLabel(record);
  const endedDate = new Date(record.endedAt);
  const durationStr = formatDurationStr(record.startedAt, record.endedAt);

  let text = `Call: ${callLabel}\n`;
  text += `Date: ${endedDate.toLocaleString()}\n`;
  text += `Duration: ${durationStr}\n`;
  text += `Total lines: ${record.transcript.length}\n`;

  // Intelligence + entities dashboard
  if (record.intelligence || record.entities) {
    text += `\n${'─'.repeat(50)}\n`;
    text += `CONVERSATION INTELLIGENCE\n`;
    text += `${'─'.repeat(50)}\n\n`;

    const s = record.intelligence?.sentiment;
    if (s?.label) {
      const scoreStr =
        typeof s.score === 'number' ? ` (${Math.round(s.score * 100)}% confidence)` : '';
      text += `Sentiment: ${s.label}${scoreStr}\n`;
    }

    const e = record.entities;
    if (e) {
      if (e.businessNames?.length) text += `Business: ${e.businessNames.join(', ')}\n`;
      if (e.websiteStatus && e.websiteStatus !== 'unknown') {
        text += `Website Status: ${e.websiteStatus === 'has_website' ? 'Has Website' : 'No Website'}\n`;
      }
      if (e.contactInfo?.phoneNumbers?.length)
        text += `Phone: ${e.contactInfo.phoneNumbers.join(', ')}\n`;
      if (e.contactInfo?.emails?.length)
        text += `Email: ${e.contactInfo.emails.join(', ')}\n`;
      if (e.contactInfo?.urls?.length)
        text += `Website: ${e.contactInfo.urls.join(', ')}\n`;
      if (e.locations?.length) text += `Location: ${e.locations.join(', ')}\n`;
      if (e.dates?.length) text += `Dates: ${e.dates.join(', ')}\n`;
      if (e.people?.length) text += `People: ${e.people.join(', ')}\n`;
    }

    if (record.intelligence?.intents?.length) {
      text += `Intents: ${record.intelligence.intents.map((i) => i.intent).join(', ')}\n`;
    }
    if (record.intelligence?.topics?.length) {
      text += `Topics: ${record.intelligence.topics.map((t) => t.topic).join(', ')}\n`;
    }
    if (record.intelligence?.summary) {
      text += `\nSummary: ${record.intelligence.summary}\n`;
    }
  }

  text += `\n${'─'.repeat(50)}\n`;
  text += `TRANSCRIPT\n`;
  text += `${'─'.repeat(50)}\n\n`;

  record.transcript.forEach((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const speaker = entry.speaker === 'agent' ? 'Agent' : 'Customer';
    text += `[${time}] ${speaker}: ${entry.text}\n\n`;
  });

  return text;
}

// ── Single-call download wrappers (used by TranscriptDetail) ──

export function downloadCallAsText(record: CallHistoryRecord, label?: string) {
  const callLabel = label ?? getCallLabel(record);
  const endedDate = new Date(record.endedAt);
  const dateStr = endedDate.toISOString().slice(0, 10);

  let text = `Call Transcript Export\n`;
  text += buildCallText(record, callLabel);

  downloadBlob(text, `call-${safeFilename(callLabel)}-${dateStr}.txt`, 'text/plain');
}

export function downloadCallAsJSON(record: CallHistoryRecord, label?: string) {
  const callLabel = label ?? getCallLabel(record);
  const endedDate = new Date(record.endedAt);
  const dateStr = endedDate.toISOString().slice(0, 10);
  const json = JSON.stringify(record, null, 2);

  downloadBlob(
    json,
    `call-${safeFilename(callLabel)}-${dateStr}.json`,
    'application/json'
  );
}

// ── Bundle builders (multiple calls in one file) ──

export function buildBundleText(records: CallHistoryRecord[], meta?: BundleMeta): string {
  let text = `Call Coach History Export\n`;
  if (meta?.dateRange) text += `Date range: ${meta.dateRange}\n`;
  if (meta?.filters?.length) text += `Filters: ${meta.filters.join(', ')}\n`;
  text += `Exported: ${new Date().toLocaleString()}\n`;
  text += `Total calls: ${records.length}\n`;

  records.forEach((record, idx) => {
    text += `\n${'='.repeat(50)}\n`;
    text += `CALL ${idx + 1} of ${records.length}\n`;
    text += `${'='.repeat(50)}\n\n`;
    text += buildCallText(record);
  });

  return text;
}

// ── Bundle download wrappers ──

export function downloadBundleAsText(
  records: CallHistoryRecord[],
  filenameSuffix: string,
  meta?: BundleMeta
) {
  const text = buildBundleText(records, meta);
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(
    text,
    `call-coach-history-${safeFilename(filenameSuffix)}-${dateStr}.txt`,
    'text/plain'
  );
}

export function downloadBundleAsJSON(records: CallHistoryRecord[], filenameSuffix: string) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ exportedAt: Date.now(), count: records.length, calls: records }, null, 2);
  downloadBlob(
    json,
    `call-coach-history-${safeFilename(filenameSuffix)}-${dateStr}.json`,
    'application/json'
  );
}
