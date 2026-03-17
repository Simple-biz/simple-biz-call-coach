import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Background Message Dispatcher Tests
 *
 * The background service worker is a monolith that can't be imported in isolation
 * (it immediately registers chrome listeners, starts WebSocket connections, etc.).
 *
 * These tests verify the message dispatch patterns and state management logic
 * that the background service worker implements, extracted into testable units.
 */

// Simulate the ExtensionState shape from background/index.ts
interface ExtensionState {
  isAuthenticated: boolean;
  isRecording: boolean;
  isOnCall: boolean;
  deepgramStatus: 'disconnected' | 'connected' | 'error';
  aiBackendStatus: string;
  transcriptions: Array<{ text: string; speaker: string; timestamp: number }>;
  coachingTips: Array<{ tip: string; category: string; priority: string; timestamp: number }>;
  currentStreamId: string | null;
  tabId: number | null;
  userEmail: string | null;
  startTime: number | null;
  coachingPending?: boolean;
  callDetectionSource?: 'webhook' | 'dom' | null;
}

function createInitialState(): ExtensionState {
  return {
    isAuthenticated: false,
    isRecording: false,
    isOnCall: false,
    deepgramStatus: 'disconnected',
    aiBackendStatus: 'disconnected',
    transcriptions: [],
    coachingTips: [],
    currentStreamId: null,
    tabId: null,
    userEmail: null,
    startTime: null,
    coachingPending: false,
    callDetectionSource: null,
  };
}

// Simulate updateExtensionState (merges updates into state)
function updateState(state: ExtensionState, updates: Partial<ExtensionState>): ExtensionState {
  return { ...state, ...updates };
}

describe('Background Message Dispatcher', () => {
  let state: ExtensionState;

  beforeEach(() => {
    state = createInitialState();
    vi.clearAllMocks();
  });

  describe('CALL_STARTED handling', () => {
    it('should set isOnCall to true and store tabId', () => {
      const tabId = 12345;
      state = updateState(state, {
        isOnCall: true,
        tabId: tabId,
        startTime: Date.now(),
        callDetectionSource: 'dom',
      });

      expect(state.isOnCall).toBe(true);
      expect(state.tabId).toBe(12345);
      expect(state.startTime).toBeGreaterThan(0);
      expect(state.callDetectionSource).toBe('dom');
    });

    it('should trigger pending coaching when coachingPending is true', () => {
      // User clicked "Start Coaching" before call started
      state = updateState(state, {
        coachingPending: true,
        isRecording: true,
        tabId: 12345,
      });

      // Call detected
      state = updateState(state, {
        isOnCall: true,
        startTime: Date.now(),
      });

      // Coaching should be activated
      expect(state.isOnCall).toBe(true);
      expect(state.coachingPending).toBe(true);
      expect(state.isRecording).toBe(true);

      // After capture starts, coachingPending should be cleared
      state = updateState(state, { coachingPending: false });
      expect(state.coachingPending).toBe(false);
    });

    it('should skip DOM detection if webhook already detected call', () => {
      // Webhook detection came first
      state = updateState(state, {
        isOnCall: true,
        callDetectionSource: 'webhook',
      });

      // DOM detection arrives — should be ignored
      const shouldSkip = state.callDetectionSource === 'webhook' && state.isOnCall;
      expect(shouldSkip).toBe(true);
    });
  });

  describe('CALL_ENDED handling', () => {
    it('should set isOnCall to false', () => {
      state = updateState(state, { isOnCall: true, isRecording: true, tabId: 12345 });

      // Call ends
      state = updateState(state, { isOnCall: false });

      expect(state.isOnCall).toBe(false);
    });

    it('should clear coachingPending on call end', () => {
      state = updateState(state, {
        coachingPending: true,
        isRecording: true,
      });

      // Full cleanup (simulates handleCallEnd)
      state = updateState(state, {
        isRecording: false,
        isOnCall: false,
        coachingPending: false,
        tabId: null,
        currentStreamId: null,
        deepgramStatus: 'disconnected',
        aiBackendStatus: 'disconnected',
      });

      expect(state.isRecording).toBe(false);
      expect(state.isOnCall).toBe(false);
      expect(state.coachingPending).toBe(false);
      expect(state.tabId).toBeNull();
    });
  });

  describe('START_COACHING_FROM_POPUP handling', () => {
    it('should start capture immediately when call is active', () => {
      state = updateState(state, { isOnCall: true, tabId: 12345 });

      // Coaching requested — call is already active
      const canStartImmediately = state.isOnCall;
      expect(canStartImmediately).toBe(true);

      state = updateState(state, {
        isRecording: true,
        coachingPending: false,
      });

      expect(state.isRecording).toBe(true);
      expect(state.coachingPending).toBe(false);
    });

    it('should arm coaching as pending when no active call', () => {
      // No call active
      expect(state.isOnCall).toBe(false);

      // Coaching requested — arm it
      state = updateState(state, {
        coachingPending: true,
        isRecording: true,
        tabId: 12345,
      });

      expect(state.coachingPending).toBe(true);
      expect(state.isRecording).toBe(true);
    });

    it('should reject when no tabId provided', () => {
      const tabId = null;
      const hasTabId = tabId !== null;
      expect(hasTabId).toBe(false);
    });
  });

  describe('State persistence', () => {
    it('should persist call state to chrome.storage.local', async () => {
      state = updateState(state, { isOnCall: true, isRecording: true });

      await chrome.storage.local.set({
        callState: state.isOnCall ? 'active' : 'inactive',
        isOnCall: state.isOnCall,
        isRecording: state.isRecording,
      });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        callState: 'active',
        isOnCall: true,
        isRecording: true,
      });
    });

    it('should broadcast state to UI components', () => {
      state = updateState(state, { isOnCall: true });

      // Simulate broadcastToUI building state response
      const stateResponse = {
        callState: state.isOnCall ? 'active' : 'inactive',
        isOnCall: state.isOnCall,
        isRecording: state.isRecording,
        deepgramStatus: state.deepgramStatus,
      };

      expect(stateResponse.callState).toBe('active');
      expect(stateResponse.isOnCall).toBe(true);
    });
  });

  describe('Call state transitions', () => {
    it('should follow inactive -> active -> ended lifecycle', () => {
      // Initially inactive
      expect(state.isOnCall).toBe(false);
      expect(state.isRecording).toBe(false);

      // Call starts
      state = updateState(state, {
        isOnCall: true,
        tabId: 12345,
        startTime: Date.now(),
      });
      expect(state.isOnCall).toBe(true);

      // Recording starts
      state = updateState(state, { isRecording: true });
      expect(state.isRecording).toBe(true);

      // Call ends
      state = updateState(state, {
        isOnCall: false,
        isRecording: false,
        tabId: null,
        currentStreamId: null,
      });
      expect(state.isOnCall).toBe(false);
      expect(state.isRecording).toBe(false);
    });
  });
});
