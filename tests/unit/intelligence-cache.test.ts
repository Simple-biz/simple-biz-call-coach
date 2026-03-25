/**
 * Tests for intelligence caching logic.
 *
 * Tests the cache module directly (no AWS dependencies).
 * Verifies: cache hit, cache miss, expiry, conversation invalidation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedIntelligence,
  setCachedIntelligence,
  clearCache,
  getCacheState,
} from '../../infra/lib/lambda/intelligence/cache';

const mockIntelligence = {
  sentiment: { label: 'neutral' as const, score: 0.1, averageScore: 0.1 },
  intents: [{ intent: 'sales_pitch', confidence: 0.9, segment: 'agent' }],
  topics: [{ topic: 'business website', confidence: 0.85, segment: 'agent' }],
  summary: 'Agent is pitching web design services to a curious prospect.',
  entities: {
    businessNames: ['SimpleBiz'],
    contactInfo: { emails: [], phoneNumbers: [], urls: [] },
    locations: [],
    dates: [],
    people: ['Kayser'],
  },
  model: 'claude-haiku-4-5',
};

const mockIntelligenceUpdated = {
  ...mockIntelligence,
  summary: 'Prospect is now asking about pricing.',
  sentiment: { label: 'positive' as const, score: 0.6, averageScore: 0.4 },
};

describe('Intelligence Cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns null when cache is empty', () => {
    const result = getCachedIntelligence('conv-123');
    expect(result).toBeNull();
  });

  it('returns cached intelligence for matching conversation', () => {
    setCachedIntelligence('conv-123', mockIntelligence);
    const result = getCachedIntelligence('conv-123');
    expect(result).toEqual(mockIntelligence);
    expect(result!.summary).toBe('Agent is pitching web design services to a curious prospect.');
  });

  it('returns null for different conversation ID (cache miss)', () => {
    setCachedIntelligence('conv-123', mockIntelligence);
    const result = getCachedIntelligence('conv-OTHER');
    expect(result).toBeNull();
  });

  it('returns null when cache is expired (>30s)', () => {
    setCachedIntelligence('conv-123', mockIntelligence);

    // Advance time past 30s expiry
    const state = getCacheState();
    state!.timestamp = Date.now() - 31_000;

    const result = getCachedIntelligence('conv-123');
    expect(result).toBeNull();
  });

  it('returns cached data when within 30s window', () => {
    setCachedIntelligence('conv-123', mockIntelligence);

    // Set timestamp to 20s ago (within 30s window)
    const state = getCacheState();
    state!.timestamp = Date.now() - 20_000;

    const result = getCachedIntelligence('conv-123');
    expect(result).toEqual(mockIntelligence);
  });

  it('overwrites cache when setCachedIntelligence is called again', () => {
    setCachedIntelligence('conv-123', mockIntelligence);
    setCachedIntelligence('conv-123', mockIntelligenceUpdated);

    const result = getCachedIntelligence('conv-123');
    expect(result!.summary).toBe('Prospect is now asking about pricing.');
    expect(result!.sentiment.label).toBe('positive');
  });

  it('overwrites cache when conversation changes', () => {
    setCachedIntelligence('conv-123', mockIntelligence);
    setCachedIntelligence('conv-456', mockIntelligenceUpdated);

    // Old conversation should miss
    expect(getCachedIntelligence('conv-123')).toBeNull();
    // New conversation should hit
    expect(getCachedIntelligence('conv-456')).toEqual(mockIntelligenceUpdated);
  });

  it('clearCache removes all cached data', () => {
    setCachedIntelligence('conv-123', mockIntelligence);
    expect(getCachedIntelligence('conv-123')).not.toBeNull();

    clearCache();
    expect(getCachedIntelligence('conv-123')).toBeNull();
    expect(getCacheState()).toBeNull();
  });

  it('simulates auto-analysis → manual tip flow (the key optimization)', () => {
    // Step 1: Auto-analysis (skipTip=true) runs and caches intelligence
    setCachedIntelligence('conv-abc', mockIntelligence);

    // Step 2: Manual tip request checks cache — should HIT
    const cached = getCachedIntelligence('conv-abc');
    expect(cached).not.toBeNull();
    expect(cached!.summary).toBe('Agent is pitching web design services to a curious prospect.');

    // This means we skip the redundant Claude intelligence call
    // and go straight to generateAITip with cached.summary
  });

  it('simulates manual tip without prior auto-analysis (cache MISS → fallback)', () => {
    // No auto-analysis has run yet, cache is empty
    const cached = getCachedIntelligence('conv-abc');
    expect(cached).toBeNull();

    // Handler would fall back to running full analysis here
  });

  it('cache timestamp is fresh after each set', () => {
    const before = Date.now();
    setCachedIntelligence('conv-123', mockIntelligence);
    const after = Date.now();

    const state = getCacheState();
    expect(state!.timestamp).toBeGreaterThanOrEqual(before);
    expect(state!.timestamp).toBeLessThanOrEqual(after);
  });
});
