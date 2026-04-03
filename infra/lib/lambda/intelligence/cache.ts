// v2 — cache TTL reduced for fresher context
import { IntelligenceResult } from '../shared/intelligence-client';

/**
 * In-memory intelligence cache for Lambda.
 *
 * Auto-analysis (every 10s) refreshes the cache.
 * Manual tip requests reuse cached intelligence to skip a redundant Claude call.
 */

interface CachedIntelligence {
  conversationId: string;
  intelligence: IntelligenceResult;
  timestamp: number;
}

let intelligenceCache: CachedIntelligence | null = null;
const CACHE_MAX_AGE_MS = 5_000; // 5s max staleness (keep fresh for accurate context)

export function getCachedIntelligence(conversationId: string): IntelligenceResult | null {
  if (!intelligenceCache) return null;
  if (intelligenceCache.conversationId !== conversationId) return null;
  if (Date.now() - intelligenceCache.timestamp > CACHE_MAX_AGE_MS) return null;
  return intelligenceCache.intelligence;
}

export function setCachedIntelligence(conversationId: string, intelligence: IntelligenceResult): void {
  intelligenceCache = {
    conversationId,
    intelligence,
    timestamp: Date.now(),
  };
}

export function clearCache(): void {
  intelligenceCache = null;
}

// Exposed for testing
export function getCacheState(): CachedIntelligence | null {
  return intelligenceCache;
}
