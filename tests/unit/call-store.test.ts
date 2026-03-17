import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock import.meta.env before store import
vi.stubGlobal('import', { meta: { env: {} } });

import { useCallStore } from '@/stores/call-store';

describe('CallStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useCallStore.setState({
      session: null,
      callState: 'inactive',
      audioState: 'idle',
      audioLevel: 0,
      transcriptions: [],
      coachingTips: [],
      deepgramStatus: 'disconnected',
      aiBackendStatus: 'disconnected',
      aiTips: [],
      aiConversationId: null,
      lastAIUpdate: null,
      intelligence: null,
      entities: null,
      environment: 'production',
      currentScriptOptions: [],
    });
  });

  describe('Initial state', () => {
    it('should have correct default values', () => {
      const state = useCallStore.getState();
      expect(state.session).toBeNull();
      expect(state.callState).toBe('inactive');
      expect(state.audioState).toBe('idle');
      expect(state.audioLevel).toBe(0);
      expect(state.transcriptions).toEqual([]);
      expect(state.coachingTips).toEqual([]);
      expect(state.deepgramStatus).toBe('disconnected');
      expect(state.aiBackendStatus).toBe('disconnected');
      expect(state.aiTips).toEqual([]);
      expect(state.aiConversationId).toBeNull();
      expect(state.intelligence).toBeNull();
      expect(state.entities).toBeNull();
      expect(state.environment).toBe('production');
    });
  });

  describe('startCall()', () => {
    it('should create a new session with active state', () => {
      useCallStore.getState().startCall();
      const state = useCallStore.getState();

      expect(state.session).not.toBeNull();
      expect(state.session!.id).toMatch(/^call-\d+$/);
      expect(state.session!.callState).toBe('active');
      expect(state.session!.audioState).toBe('capturing');
      expect(state.session!.startTime).toBeGreaterThan(0);
      expect(state.callState).toBe('active');
      expect(state.audioState).toBe('capturing');
    });

    it('should clear previous transcriptions and tips', () => {
      // Add some data first
      useCallStore.getState().addTranscription({
        text: 'old transcript',
        speaker: 'agent',
        timestamp: Date.now(),
        confidence: 0.9,
        isFinal: true,
      });

      useCallStore.getState().startCall();
      const state = useCallStore.getState();

      expect(state.transcriptions).toEqual([]);
      expect(state.coachingTips).toEqual([]);
    });

    it('should persist state to chrome.storage', () => {
      useCallStore.getState().startCall();
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('endCall()', () => {
    it('should set callState to ended', () => {
      useCallStore.getState().startCall();
      useCallStore.getState().endCall();
      const state = useCallStore.getState();

      expect(state.callState).toBe('ended');
      expect(state.audioState).toBe('idle');
      expect(state.deepgramStatus).toBe('disconnected');
    });

    it('should set endTime on session', () => {
      useCallStore.getState().startCall();
      useCallStore.getState().endCall();
      const state = useCallStore.getState();

      expect(state.session).not.toBeNull();
      expect(state.session!.endTime).toBeGreaterThan(0);
      expect(state.session!.callState).toBe('ended');
    });

    it('should handle endCall when no session exists', () => {
      useCallStore.getState().endCall();
      const state = useCallStore.getState();
      expect(state.session).toBeNull();
      expect(state.callState).toBe('ended');
    });
  });

  describe('addTranscription()', () => {
    const mockTranscription = {
      text: 'Hello, how can I help?',
      speaker: 'agent' as const,
      timestamp: Date.now(),
      confidence: 0.95,
      isFinal: true,
    };

    it('should add transcription to the list', () => {
      useCallStore.getState().addTranscription(mockTranscription);
      const state = useCallStore.getState();

      expect(state.transcriptions).toHaveLength(1);
      expect(state.transcriptions[0].text).toBe('Hello, how can I help?');
      expect(state.transcriptions[0].speaker).toBe('agent');
    });

    it('should append multiple transcriptions in order', () => {
      useCallStore.getState().addTranscription(mockTranscription);
      useCallStore.getState().addTranscription({
        ...mockTranscription,
        text: 'Second message',
        speaker: 'customer',
      });
      const state = useCallStore.getState();

      expect(state.transcriptions).toHaveLength(2);
      expect(state.transcriptions[0].text).toBe('Hello, how can I help?');
      expect(state.transcriptions[1].text).toBe('Second message');
    });

    it('should persist after adding transcription', () => {
      useCallStore.getState().addTranscription(mockTranscription);
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('addCoachingTip()', () => {
    const mockTip = {
      id: 'tip-1',
      tip: 'Ask about their budget',
      category: 'suggestion' as const,
      priority: 'normal' as const,
      timestamp: Date.now(),
    };

    it('should add coaching tip to the list', () => {
      useCallStore.getState().addCoachingTip(mockTip);
      const state = useCallStore.getState();

      expect(state.coachingTips).toHaveLength(1);
      expect(state.coachingTips[0].tip).toBe('Ask about their budget');
    });

    it('should append multiple tips', () => {
      useCallStore.getState().addCoachingTip(mockTip);
      useCallStore.getState().addCoachingTip({
        ...mockTip,
        id: 'tip-2',
        tip: 'Mention the promotion',
      });
      const state = useCallStore.getState();

      expect(state.coachingTips).toHaveLength(2);
    });
  });

  describe('addAITip()', () => {
    const mockAITip = {
      id: 'ai-tip-1',
      heading: 'Discovery Question',
      stage: 'DISCOVERY',
      context: 'Customer expressed interest',
      options: [
        { label: 'Option A', script: 'What challenges are you facing?' },
      ],
      recommendationId: 'rec-1',
      timestamp: Date.now(),
    };

    it('should add AI tip and set lastAIUpdate', () => {
      useCallStore.getState().addAITip(mockAITip);
      const state = useCallStore.getState();

      expect(state.aiTips).toHaveLength(1);
      expect(state.aiTips[0].heading).toBe('Discovery Question');
      expect(state.lastAIUpdate).toBeGreaterThan(0);
    });
  });

  describe('selectAIOption()', () => {
    it('should store selected option on the correct tip', () => {
      const tip = {
        id: 'ai-tip-1',
        heading: 'Test',
        stage: 'DISCOVERY',
        options: [{ label: 'A', script: 'Script A' }],
        recommendationId: 'rec-1',
        timestamp: Date.now(),
      };

      useCallStore.getState().addAITip(tip);
      useCallStore.getState().selectAIOption('ai-tip-1', 2);

      const state = useCallStore.getState();
      expect((state.aiTips[0] as any).selectedOption).toBe(2);
    });
  });

  describe('clearSession()', () => {
    it('should reset all state to defaults', () => {
      // Set up some state
      useCallStore.getState().startCall();
      useCallStore.getState().addTranscription({
        text: 'test',
        speaker: 'agent',
        timestamp: Date.now(),
        confidence: 0.9,
        isFinal: true,
      });

      useCallStore.getState().clearSession();
      const state = useCallStore.getState();

      expect(state.session).toBeNull();
      expect(state.callState).toBe('inactive');
      expect(state.audioState).toBe('idle');
      expect(state.transcriptions).toEqual([]);
      expect(state.coachingTips).toEqual([]);
      expect(state.aiTips).toEqual([]);
      expect(state.aiConversationId).toBeNull();
      expect(state.intelligence).toBeNull();
      expect(state.entities).toBeNull();
    });
  });

  describe('setCallState()', () => {
    it('should update callState', () => {
      useCallStore.getState().setCallState('active');
      expect(useCallStore.getState().callState).toBe('active');

      useCallStore.getState().setCallState('paused');
      expect(useCallStore.getState().callState).toBe('paused');
    });
  });

  describe('setDeepgramStatus()', () => {
    it('should update deepgramStatus', () => {
      useCallStore.getState().setDeepgramStatus('connected');
      expect(useCallStore.getState().deepgramStatus).toBe('connected');
    });
  });

  describe('setAIBackendStatus()', () => {
    it('should update aiBackendStatus', () => {
      useCallStore.getState().setAIBackendStatus('connected');
      expect(useCallStore.getState().aiBackendStatus).toBe('connected');
    });
  });

  describe('setAIConversationId()', () => {
    it('should set and clear conversation ID', () => {
      useCallStore.getState().setAIConversationId('conv-123');
      expect(useCallStore.getState().aiConversationId).toBe('conv-123');

      useCallStore.getState().setAIConversationId(null);
      expect(useCallStore.getState().aiConversationId).toBeNull();
    });
  });

  describe('setEnvironment()', () => {
    it('should switch to sandbox with local WebSocket URL', () => {
      useCallStore.getState().setEnvironment('sandbox');
      const state = useCallStore.getState();

      expect(state.environment).toBe('sandbox');
      expect(state.websocketUrl).toBe('ws://localhost:8080');
    });

    it('should switch to production', () => {
      useCallStore.getState().setEnvironment('sandbox');
      useCallStore.getState().setEnvironment('production');
      const state = useCallStore.getState();

      expect(state.environment).toBe('production');
      expect(state.websocketUrl).not.toBe('ws://localhost:8080');
    });
  });

  describe('loadFromStorage()', () => {
    it('should load persisted state from chrome.storage', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        callStoreState: {
          session: null,
          callState: 'active',
          audioState: 'capturing',
          transcriptions: [
            { text: 'persisted', speaker: 'agent', timestamp: 1, confidence: 0.9, isFinal: true },
          ],
          coachingTips: [],
          deepgramStatus: 'connected',
          aiBackendStatus: 'disconnected',
          aiTips: [],
          aiConversationId: null,
          lastAIUpdate: null,
          intelligence: null,
          entities: null,
          environment: 'production',
          websocketUrl: 'wss://test.com',
        },
      });

      await useCallStore.getState().loadFromStorage();
      const state = useCallStore.getState();

      expect(state.callState).toBe('active');
      expect(state.audioState).toBe('capturing');
      expect(state.transcriptions).toHaveLength(1);
      expect(state.transcriptions[0].text).toBe('persisted');
      expect(state.deepgramStatus).toBe('connected');
    });

    it('should handle missing storage data', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({});

      await useCallStore.getState().loadFromStorage();
      // Should not crash, state unchanged
      expect(useCallStore.getState().callState).toBe('inactive');
    });

    it('should handle storage errors', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
        new Error('Storage error')
      );

      await useCallStore.getState().loadFromStorage();
      // Should not crash
      expect(useCallStore.getState().callState).toBe('inactive');
    });
  });

  describe('clearAITips()', () => {
    it('should clear AI tips and lastAIUpdate', () => {
      useCallStore.getState().addAITip({
        id: 'tip-1',
        heading: 'Test',
        stage: 'DISCOVERY',
        options: [],
        recommendationId: 'rec-1',
        timestamp: Date.now(),
      });

      useCallStore.getState().clearAITips();
      const state = useCallStore.getState();

      expect(state.aiTips).toEqual([]);
      expect(state.lastAIUpdate).toBeNull();
    });
  });
});
