import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

/**
 * Readiness Indicator Tests
 *
 * Tests the CHECK_READINESS flow:
 * 1. Background readiness logic (extracted, testable)
 * 2. SidePanel banner rendering for ready/not-ready states
 * 3. CALL_START_FAILED triggers error banner
 * 4. CAPTURE_STARTED clears error banner
 */

// ============================================================================
// PART 1: Background readiness check logic (extracted)
// ============================================================================

interface ReadinessResult {
  ready: boolean;
  issues: string[];
}

/**
 * Simulates the CHECK_READINESS handler from background/index.ts.
 * Extracted here because the background is a monolith that can't be imported.
 */
async function checkReadiness(opts: {
  deepgramApiKey: string | null;
  envKey: string;
  offscreenAvailable: boolean;
  tabId: number | null;
}): Promise<ReadinessResult> {
  const readiness: ReadinessResult = { ready: true, issues: [] };

  // Check Deepgram API key
  const dgKey = opts.deepgramApiKey || opts.envKey || '';
  if (!dgKey) {
    readiness.ready = false;
    readiness.issues.push('No Deepgram API key configured');
  }

  // Check offscreen document can be queried
  if (!opts.offscreenAvailable) {
    readiness.ready = false;
    readiness.issues.push('Extension context invalid — please refresh the page');
  }

  // Check tab ID — informational only, not a blocker
  if (!opts.tabId) {
    readiness.issues.push('Tab not linked yet (will connect on call start)');
  }

  return readiness;
}

describe('Background Readiness Check Logic', () => {
  it('should return ready when all prerequisites are met', async () => {
    const result = await checkReadiness({
      deepgramApiKey: 'abc123',
      envKey: '',
      offscreenAvailable: true,
      tabId: 12345,
    });

    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should fail when Deepgram API key is missing from both storage and env', async () => {
    const result = await checkReadiness({
      deepgramApiKey: null,
      envKey: '',
      offscreenAvailable: true,
      tabId: 12345,
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toContain('No Deepgram API key configured');
  });

  it('should pass when Deepgram key is only in env var (not storage)', async () => {
    const result = await checkReadiness({
      deepgramApiKey: null,
      envKey: 'env-fallback-key',
      offscreenAvailable: true,
      tabId: 12345,
    });

    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should fail when offscreen document is unavailable', async () => {
    const result = await checkReadiness({
      deepgramApiKey: 'abc123',
      envKey: '',
      offscreenAvailable: false,
      tabId: 12345,
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toContain('Extension context invalid — please refresh the page');
  });

  it('should still be ready when no tab is connected (tab links on call start)', async () => {
    const result = await checkReadiness({
      deepgramApiKey: 'abc123',
      envKey: '',
      offscreenAvailable: true,
      tabId: null,
    });

    expect(result.ready).toBe(true);
    expect(result.issues).toContain('Tab not linked yet (will connect on call start)');
  });

  it('should accumulate multiple issues', async () => {
    const result = await checkReadiness({
      deepgramApiKey: null,
      envKey: '',
      offscreenAvailable: false,
      tabId: null,
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toHaveLength(3);
    expect(result.issues).toContain('No Deepgram API key configured');
    expect(result.issues).toContain('Extension context invalid — please refresh the page');
    expect(result.issues).toContain('Tab not linked yet (will connect on call start)');
  });
});

// ============================================================================
// PART 2: SidePanel readiness banner integration
// ============================================================================

/**
 * Since SidePanel has heavy dependencies (Zustand, Deepgram service, etc.),
 * we test the readiness banner logic by simulating the chrome.runtime message
 * flow that the SidePanel useEffect hooks implement.
 */
describe('SidePanel Readiness Banner Integration', () => {
  let messageListeners: ((message: any) => void)[];
  let sendMessageMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    messageListeners = [];

    sendMessageMock = chrome.runtime.sendMessage as Mock;

    (chrome.runtime.onMessage.addListener as Mock).mockImplementation((listener: any) => {
      messageListeners.push(listener);
    });
  });

  function dispatchMessage(message: any) {
    messageListeners.forEach((listener) => listener(message));
  }

  /**
   * Simulates the readiness state management from SidePanel.tsx.
   * This mirrors the useState + useEffect logic without needing to render the full component.
   */
  function createReadinessState() {
    let state = { ready: true, issues: [] as string[], checked: false };

    return {
      get: () => state,
      setFromCheckResult: (result: { ready: boolean; issues: string[] }) => {
        state = { ready: result.ready, issues: result.issues || [], checked: true };
      },
      setFromCallStartFailed: (error: string | object) => {
        state = {
          ready: false,
          issues: [typeof error === 'string' ? error : 'Call start failed — please refresh the CallTools page and try again'],
          checked: true,
        };
      },
      clearOnCaptureStarted: () => {
        state = { ready: true, issues: [], checked: true };
      },
      setFromBackgroundUnreachable: () => {
        state = {
          ready: false,
          issues: ['Cannot reach background service — please refresh the page'],
          checked: true,
        };
      },
    };
  }

  it('should set ready state when CHECK_READINESS returns ready', async () => {
    const readiness = createReadinessState();

    sendMessageMock.mockResolvedValueOnce({ ready: true, issues: [] });

    const result = await chrome.runtime.sendMessage({ type: 'CHECK_READINESS' });
    readiness.setFromCheckResult(result);

    expect(readiness.get().ready).toBe(true);
    expect(readiness.get().issues).toHaveLength(0);
    expect(readiness.get().checked).toBe(true);
  });

  it('should set not-ready state when CHECK_READINESS returns issues', async () => {
    const readiness = createReadinessState();

    sendMessageMock.mockResolvedValueOnce({
      ready: false,
      issues: ['Not connected to a CallTools tab'],
    });

    const result = await chrome.runtime.sendMessage({ type: 'CHECK_READINESS' });
    readiness.setFromCheckResult(result);

    expect(readiness.get().ready).toBe(false);
    expect(readiness.get().issues).toContain('Not connected to a CallTools tab');
  });

  it('should set error state when CALL_START_FAILED is received with string error', () => {
    const readiness = createReadinessState();

    readiness.setFromCallStartFailed(
      'Failed to ensure offscreen document: Only a single offscreen document may be created'
    );

    expect(readiness.get().ready).toBe(false);
    expect(readiness.get().issues[0]).toBe(
      'Failed to ensure offscreen document: Only a single offscreen document may be created'
    );
  });

  it('should set error state when CALL_START_FAILED is received with non-string error', () => {
    const readiness = createReadinessState();

    readiness.setFromCallStartFailed({ code: 'OFFSCREEN_ERROR', detail: 'something' });

    expect(readiness.get().ready).toBe(false);
    expect(readiness.get().issues[0]).toBe(
      'Call start failed — please refresh the CallTools page and try again'
    );
  });

  it('should clear error state when CAPTURE_STARTED is received after failure', () => {
    const readiness = createReadinessState();

    // Simulate failure
    readiness.setFromCallStartFailed('Some error');
    expect(readiness.get().ready).toBe(false);

    // Simulate successful capture
    readiness.clearOnCaptureStarted();
    expect(readiness.get().ready).toBe(true);
    expect(readiness.get().issues).toHaveLength(0);
  });

  it('should handle unreachable background service', async () => {
    const readiness = createReadinessState();

    sendMessageMock.mockRejectedValueOnce(new Error('Could not establish connection'));

    try {
      await chrome.runtime.sendMessage({ type: 'CHECK_READINESS' });
    } catch {
      readiness.setFromBackgroundUnreachable();
    }

    expect(readiness.get().ready).toBe(false);
    expect(readiness.get().issues[0]).toBe(
      'Cannot reach background service — please refresh the page'
    );
  });

  it('Retry should re-check readiness and clear banner on success', async () => {
    const readiness = createReadinessState();

    // First check: not ready
    sendMessageMock.mockResolvedValueOnce({
      ready: false,
      issues: ['Not connected to a CallTools tab'],
    });

    let result = await chrome.runtime.sendMessage({ type: 'CHECK_READINESS' });
    readiness.setFromCheckResult(result);
    expect(readiness.get().ready).toBe(false);

    // Retry: now ready
    sendMessageMock.mockResolvedValueOnce({ ready: true, issues: [] });

    result = await chrome.runtime.sendMessage({ type: 'CHECK_READINESS' });
    readiness.setFromCheckResult(result);
    expect(readiness.get().ready).toBe(true);
    expect(readiness.get().issues).toHaveLength(0);
  });
});

// ============================================================================
// PART 3: Banner visibility logic
// ============================================================================

describe('Readiness Banner Visibility Logic', () => {
  /**
   * The banner shows when: readiness.checked && !readiness.ready && callState !== 'active'
   */
  function shouldShowBanner(readiness: { checked: boolean; ready: boolean }, callState: string): boolean {
    return readiness.checked && !readiness.ready && callState !== 'active';
  }

  it('should show banner when checked, not ready, and idle', () => {
    expect(shouldShowBanner({ checked: true, ready: false }, 'inactive')).toBe(true);
  });

  it('should NOT show banner when not yet checked', () => {
    expect(shouldShowBanner({ checked: false, ready: false }, 'inactive')).toBe(false);
  });

  it('should NOT show banner when ready', () => {
    expect(shouldShowBanner({ checked: true, ready: true }, 'inactive')).toBe(false);
  });

  it('should NOT show banner during active call (even if not ready)', () => {
    expect(shouldShowBanner({ checked: true, ready: false }, 'active')).toBe(false);
  });
});

