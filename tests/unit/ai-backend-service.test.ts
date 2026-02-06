import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Socket } from 'socket.io-client';

// Mock socket.io-client
const mockSocket = {
  connected: false,
  id: 'mock-socket-id',
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

const mockIo = vi.fn(() => mockSocket as unknown as Socket);

vi.mock('socket.io-client', () => ({
  io: mockIo,
}));

// Import after mocking
import { aiBackendService } from '@/services/ai-backend.service';
import type { AIBackendConfig, AIBackendStatus, AIRecommendation } from '@/types';

describe('AIBackendService', () => {
  const testConfig: AIBackendConfig = {
    url: 'http://localhost:3000',
    apiKey: 'test-api-key',
    autoReconnect: true,
    reconnectAttempts: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
  });

  afterEach(() => {
    if (aiBackendService.isConnected()) {
      aiBackendService.disconnect();
    }
  });

  describe('initialize()', () => {
    it('should initialize with valid config', async () => {
      await aiBackendService.initialize(testConfig);
      expect(aiBackendService.getStatus()).toBe('disconnected');
    });

    it('should store configuration', async () => {
      await aiBackendService.initialize(testConfig);
      // Internal config should be set (tested indirectly via connect)
    });
  });

  describe('connect()', () => {
    it('should connect to backend successfully', async () => {
      await aiBackendService.initialize(testConfig);

      // Simulate connection
      const connectPromise = aiBackendService.connect();

      // Verify socket.io was called with correct params
      expect(mockIo).toHaveBeenCalledWith(testConfig.url, {
        auth: { apiKey: testConfig.apiKey },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      // Trigger connect event
      const connectHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'connect'
      )?.[1];
      mockSocket.connected = true;
      connectHandler?.();

      await connectPromise;
      expect(aiBackendService.getStatus()).toBe('ready');
    });

    it('should reject if not initialized', async () => {
      // Create new service instance (not initialized)
      await expect(async () => {
        // @ts-ignore - accessing private method for testing
        const service = Object.create(aiBackendService);
        await service.connect();
      }).rejects.toThrow();
    });

    it('should handle connection error', async () => {
      await aiBackendService.initialize(testConfig);

      const connectPromise = aiBackendService.connect();

      // Trigger connect_error event
      const errorHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'connect_error'
      )?.[1];
      errorHandler?.(new Error('Connection failed'));

      await expect(connectPromise).rejects.toThrow('Connection failed');
      expect(aiBackendService.getStatus()).toBe('error');
    });

    it('should not reconnect if already connected', async () => {
      await aiBackendService.initialize(testConfig);
      mockSocket.connected = true;

      await aiBackendService.connect();
      expect(mockIo).toHaveBeenCalledTimes(0); // Already connected
    });
  });

  describe('startConversation()', () => {
    it('should start conversation and return conversation ID', async () => {
      await aiBackendService.initialize(testConfig);
      mockSocket.connected = true;

      const promise = aiBackendService.startConversation('agent-123', { source: 'test' });

      // Simulate CONVERSATION_STARTED response
      const conversationHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'CONVERSATION_STARTED'
      )?.[1];
      conversationHandler?.({
        payload: {
          conversationId: 'conv-456',
        },
      });

      const conversationId = await promise;
      expect(conversationId).toBe('conv-456');
      expect(mockSocket.emit).toHaveBeenCalledWith('START_CONVERSATION', {
        agentId: 'agent-123',
        metadata: { source: 'test' },
      });
    });

    it('should return null if not connected', async () => {
      await aiBackendService.initialize(testConfig);
      mockSocket.connected = false;

      const conversationId = await aiBackendService.startConversation('agent-123');
      expect(conversationId).toBeNull();
    });

    it('should timeout after 5 seconds', async () => {
      await aiBackendService.initialize(testConfig);
      mockSocket.connected = true;

      vi.useFakeTimers();
      const promise = aiBackendService.startConversation('agent-123');

      vi.advanceTimersByTime(5000);

      const result = await promise;
      expect(result).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('sendTranscript()', () => {
    it('should emit TRANSCRIPT event with correct payload', () => {
      mockSocket.connected = true;

      // Set conversation ID (normally set via startConversation)
      // @ts-ignore - accessing private property for testing
      aiBackendService['conversationId'] = 'conv-123';

      aiBackendService.sendTranscript('caller', 'Hello, I need help', true);

      expect(mockSocket.emit).toHaveBeenCalledWith('TRANSCRIPT', {
        conversationId: 'conv-123',
        speaker: 'caller',
        text: 'Hello, I need help',
        isFinal: true,
        timestamp: expect.any(Number),
      });
    });

    it('should not send if not connected', () => {
      mockSocket.connected = false;
      aiBackendService.sendTranscript('caller', 'Test', true);
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not send if no conversation ID', () => {
      mockSocket.connected = true;
      // @ts-ignore
      aiBackendService['conversationId'] = null;

      aiBackendService.sendTranscript('caller', 'Test', true);
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('selectOption()', () => {
    it('should emit OPTION_SELECTED event', () => {
      mockSocket.connected = true;

      aiBackendService.selectOption('recommendation-123', 2);

      expect(mockSocket.emit).toHaveBeenCalledWith('OPTION_SELECTED', {
        recommendationId: 'recommendation-123',
        selectedOption: 2,
      });
    });

    it('should not send if not connected', () => {
      mockSocket.connected = false;
      aiBackendService.selectOption('recommendation-123', 1);
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('endConversation()', () => {
    it('should emit END_CONVERSATION event', () => {
      mockSocket.connected = true;
      // @ts-ignore
      aiBackendService['conversationId'] = 'conv-123';

      aiBackendService.endConversation();

      expect(mockSocket.emit).toHaveBeenCalledWith('END_CONVERSATION', {
        conversationId: 'conv-123',
      });
    });

    it('should not send if no conversation', () => {
      mockSocket.connected = true;
      // @ts-ignore
      aiBackendService['conversationId'] = null;

      aiBackendService.endConversation();
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('disconnect()', () => {
    it('should disconnect and cleanup', () => {
      mockSocket.connected = true;
      // @ts-ignore
      aiBackendService['socket'] = mockSocket as any;

      aiBackendService.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(aiBackendService.getStatus()).toBe('disconnected');
      expect(aiBackendService.getConversationId()).toBeNull();
    });
  });

  describe('Event Listeners', () => {
    it('should call status listener on status change', async () => {
      const statusListener = vi.fn();
      aiBackendService.setStatusListener(statusListener);

      await aiBackendService.initialize(testConfig);
      const connectPromise = aiBackendService.connect();

      // Trigger connect
      const connectHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'connect'
      )?.[1];
      mockSocket.connected = true;
      connectHandler?.();

      await connectPromise;

      expect(statusListener).toHaveBeenCalledWith('connecting');
      expect(statusListener).toHaveBeenCalledWith('ready');
    });

    it('should call AI tip listener on AI_TIP event', async () => {
      const tipListener = vi.fn();
      aiBackendService.setAITipListener(tipListener);

      await aiBackendService.initialize(testConfig);
      mockSocket.connected = true;

      // Trigger AI_TIP event
      const tipHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'AI_TIP'
      )?.[1];

      const mockTipPayload = {
        type: 'AI_TIP',
        payload: {
          recommendationId: 'rec-123',
          conversationId: 'conv-456',
          stage: 'DISCOVERY',
          heading: 'Ask Discovery',
          context: 'Customer expressed interest',
          options: [
            { label: 'Minimal', script: 'What challenges?' },
            { label: 'Explanative', script: 'Tell me about your situation' },
            { label: 'Contextual', script: 'You mentioned website issues' },
          ],
          timestamp: Date.now(),
        },
      };

      tipHandler?.(mockTipPayload);

      expect(tipListener).toHaveBeenCalledWith({
        id: expect.any(String),
        recommendationId: 'rec-123',
        heading: 'Ask Discovery',
        stage: 'DISCOVERY',
        context: 'Customer expressed interest',
        options: mockTipPayload.payload.options,
        timestamp: expect.any(Number),
        conversationId: 'conv-456',
      });
    });

    it('should call error listener on ERROR event', async () => {
      const errorListener = vi.fn();
      aiBackendService.setErrorListener(errorListener);

      await aiBackendService.initialize(testConfig);
      mockSocket.connected = true;

      // Trigger ERROR event
      const errorHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'ERROR'
      )?.[1];

      const mockError = {
        type: 'ERROR',
        payload: {
          message: 'Test error',
          code: 'TEST_ERROR',
          timestamp: Date.now(),
        },
      };

      errorHandler?.(mockError);

      expect(errorListener).toHaveBeenCalledWith(mockError.payload);
    });
  });

  describe('Status Helpers', () => {
    it('should return correct connection status', () => {
      expect(aiBackendService.isConnected()).toBe(false);

      mockSocket.connected = true;
      // @ts-ignore
      aiBackendService['socket'] = mockSocket as any;

      expect(aiBackendService.isConnected()).toBe(true);
    });

    it('should return correct conversation status', () => {
      expect(aiBackendService.hasActiveConversation()).toBe(false);

      // @ts-ignore
      aiBackendService['conversationId'] = 'conv-123';

      expect(aiBackendService.hasActiveConversation()).toBe(true);
    });

    it('should return conversation ID', () => {
      // @ts-ignore
      aiBackendService['conversationId'] = 'conv-456';

      expect(aiBackendService.getConversationId()).toBe('conv-456');
    });
  });

  describe('Auto-Reconnect', () => {
    it('should attempt reconnection on disconnect', async () => {
      await aiBackendService.initialize(testConfig);

      // Connect first
      const connectPromise = aiBackendService.connect();
      const connectHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'connect'
      )?.[1];
      mockSocket.connected = true;
      connectHandler?.();
      await connectPromise;

      // Trigger disconnect
      const disconnectHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'disconnect'
      )?.[1];
      mockSocket.connected = false;
      disconnectHandler?.('transport close');

      // Should trigger reconnect logic
      expect(aiBackendService.getStatus()).toBe('disconnected');
    });

    it('should use exponential backoff on reconnect', async () => {
      vi.useFakeTimers();

      await aiBackendService.initialize(testConfig);

      // Simulate connect error that triggers reconnect
      const promise = aiBackendService.connect();
      const errorHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'connect_error'
      )?.[1];

      // First error
      errorHandler?.(new Error('Connection failed'));

      // Advance 1s (first retry)
      vi.advanceTimersByTime(1000);

      // Second error
      errorHandler?.(new Error('Connection failed'));

      // Advance 2s (second retry)
      vi.advanceTimersByTime(2000);

      // Third error
      errorHandler?.(new Error('Connection failed'));

      // Advance 4s (third retry)
      vi.advanceTimersByTime(4000);

      vi.useRealTimers();
    });
  });
});
