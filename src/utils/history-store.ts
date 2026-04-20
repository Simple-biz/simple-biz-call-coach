/**
 * Call History Store — IndexedDB wrapper
 *
 * Persists completed call transcripts locally on the agent's machine.
 * Fire-and-forget: never throws to the caller; logs warnings on failure.
 * Zero cloud cost — everything stays in the browser.
 */

export interface HistoryTranscriptEntry {
  speaker: 'agent' | 'customer';
  text: string;
  timestamp: number;
}

export interface HistoryIntelligence {
  sentiment?: {
    label?: string;
    score?: number;
    averageScore?: number;
  };
  intents?: Array<{ intent: string; confidence?: number; segment?: string }>;
  topics?: Array<{ topic: string; confidence?: number; segment?: string }>;
  summary?: string;
}

export interface HistoryEntities {
  businessNames?: string[];
  contactInfo?: {
    emails?: string[];
    phoneNumbers?: string[];
    urls?: string[];
  };
  locations?: string[];
  dates?: string[];
  people?: string[];
  websiteStatus?: 'has_website' | 'no_website' | 'unknown';
}

export interface CallHistoryRecord {
  conversationId: string;
  agentEmail: string;
  startedAt: number;
  endedAt: number;
  destination?: string;
  transcript: HistoryTranscriptEntry[];
  intelligence?: HistoryIntelligence | null;
  entities?: HistoryEntities | null;
  savedAt: number;
  schemaVersion: number;
}

const DB_NAME = 'call-coach-history';
const STORE_NAME = 'transcripts';
const DB_VERSION = 1;
const CURRENT_SCHEMA = 1;

const PRUNE_OLDER_THAN_DAYS = 90;
const PRUNE_OLDER_THAN_MS = PRUNE_OLDER_THAN_DAYS * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or create) the history database. Idempotent — safe to call repeatedly.
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const promise: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'conversationId' });
        store.createIndex('agentEmail', 'agentEmail', { unique: false });
        store.createIndex('endedAt', 'endedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });

  // Clear cache on failure so future calls can retry
  promise.catch(() => {
    dbPromise = null;
  });

  dbPromise = promise;
  return promise;
}

/**
 * Save a completed call's transcript.
 * Never throws — logs and returns false on failure.
 */
export async function saveTranscript(params: {
  conversationId: string;
  agentEmail: string;
  startedAt: number;
  endedAt: number;
  destination?: string;
  transcript: HistoryTranscriptEntry[];
  intelligence?: HistoryIntelligence | null;
  entities?: HistoryEntities | null;
}): Promise<boolean> {
  try {
    if (!params.conversationId) {
      console.warn('[HistoryStore] saveTranscript skipped — no conversationId');
      return false;
    }
    if (!params.transcript || params.transcript.length === 0) {
      console.warn('[HistoryStore] saveTranscript skipped — empty transcript');
      return false;
    }

    const db = await openDB();
    const record: CallHistoryRecord = {
      conversationId: params.conversationId,
      agentEmail: params.agentEmail || 'unknown',
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      destination: params.destination,
      transcript: params.transcript,
      intelligence: params.intelligence ?? null,
      entities: params.entities ?? null,
      savedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('put failed'));
    });

    console.log(`[HistoryStore] Saved transcript for conversation ${params.conversationId.slice(0, 8)}... (${params.transcript.length} entries)`);
    return true;
  } catch (err) {
    console.warn('[HistoryStore] saveTranscript failed:', err);
    return false;
  }
}

/**
 * Get a single call transcript by conversationId.
 */
export async function getTranscript(conversationId: string): Promise<CallHistoryRecord | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(conversationId);
      req.onsuccess = () => resolve((req.result as CallHistoryRecord) || null);
      req.onerror = () => reject(req.error || new Error('get failed'));
    });
  } catch (err) {
    console.warn('[HistoryStore] getTranscript failed:', err);
    return null;
  }
}

/**
 * List calls for an agent, newest first.
 */
export async function listTranscripts(params?: {
  agentEmail?: string;
  limit?: number;
}): Promise<CallHistoryRecord[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('endedAt');

      const results: CallHistoryRecord[] = [];
      const limit = params?.limit;
      const filterEmail = params?.agentEmail;

      // Cursor in descending order (newest first)
      const cursorRequest = index.openCursor(null, 'prev');

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve(results);
          return;
        }

        const record = cursor.value as CallHistoryRecord;
        if (!filterEmail || record.agentEmail === filterEmail) {
          results.push(record);
        }

        if (limit && results.length >= limit) {
          resolve(results);
          return;
        }

        cursor.continue();
      };

      cursorRequest.onerror = () => reject(cursorRequest.error || new Error('cursor failed'));
    });
  } catch (err) {
    console.warn('[HistoryStore] listTranscripts failed:', err);
    return [];
  }
}

/**
 * Delete a specific call transcript.
 */
export async function deleteTranscript(conversationId: string): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(conversationId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('delete failed'));
    });
    return true;
  } catch (err) {
    console.warn('[HistoryStore] deleteTranscript failed:', err);
    return false;
  }
}

/**
 * Delete calls older than the retention window. Returns count removed.
 */
export async function pruneOldTranscripts(): Promise<number> {
  try {
    const cutoff = Date.now() - PRUNE_OLDER_THAN_MS;
    const db = await openDB();

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('endedAt');

      let removed = 0;
      const range = IDBKeyRange.upperBound(cutoff);
      const cursorRequest = index.openCursor(range);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          if (removed > 0) {
            console.log(`[HistoryStore] Pruned ${removed} call(s) older than ${PRUNE_OLDER_THAN_DAYS} days`);
          }
          resolve(removed);
          return;
        }
        cursor.delete();
        removed++;
        cursor.continue();
      };

      cursorRequest.onerror = () => reject(cursorRequest.error || new Error('prune cursor failed'));
    });
  } catch (err) {
    console.warn('[HistoryStore] pruneOldTranscripts failed:', err);
    return 0;
  }
}

/**
 * Count total records (optionally per agent). For diagnostics.
 */
export async function countTranscripts(agentEmail?: string): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      if (agentEmail) {
        const req = store.index('agentEmail').count(IDBKeyRange.only(agentEmail));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } else {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }
    });
  } catch (err) {
    console.warn('[HistoryStore] countTranscripts failed:', err);
    return 0;
  }
}
