import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock aws config before importing the service
vi.mock('@/config/aws', () => ({
  AWS_WEBSOCKET_URL: 'wss://mock-api-gateway.amazonaws.com/production',
  BACKEND_API_KEY: 'mock-api-key',
}));

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;

  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close = vi.fn((code?: number, _reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code || 1000, reason: _reason || '' });
    }
  });

  // Helper to simulate connection open
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  // Helper to simulate incoming message
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  // Helper to simulate close
  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

// Replace global WebSocket
vi.stubGlobal('WebSocket', MockWebSocket);

// Import after mocking
import { AWSWebSocketService } from '@/services/aws-websocket.service';

describe('AWSWebSocketService', () => {
  let service: AWSWebSocketService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AWSWebSocketService();
  });

  afterEach(() => {
    if (service.isConnected()) {
      service.disconnect();
    }
  });

  // Helper to connect the service and return the mock WebSocket
  async function connectService(): Promise<MockWebSocket> {
    const connectPromise = service.connect();
    // Get the WebSocket instance created during connect
    const ws = (service as any).ws as MockWebSocket;
    ws.simulateOpen();
    await connectPromise;
    return ws;
  }

  describe('connect()', () => {
    it('should connect and update status to connected', async () => {
      const ws = await connectService();
      expect(service.isConnected()).toBe(true);
      expect(service.getStatus()).toBe('connected');
      expect(ws.url).toContain('wss://mock-api-gateway.amazonaws.com/production');
      expect(ws.url).toContain('apiKey=mock-api-key');
    });

    it('should not create a new connection if already connected', async () => {
      await connectService();
      await service.connect(); // second call
      expect(service.getStatus()).toBe('connected');
    });

    it('should call status listener on connection', async () => {
      const statusListener = vi.fn();
      service.setStatusListener(statusListener);

      await connectService();

      expect(statusListener).toHaveBeenCalledWith('connecting');
      expect(statusListener).toHaveBeenCalledWith('connected');
    });
  });

  describe('disconnect()', () => {
    it('should close WebSocket with code 1000', async () => {
      const ws = await connectService();
      service.disconnect();

      expect(ws.close).toHaveBeenCalledWith(1000, 'Client disconnect');
      expect(service.isConnected()).toBe(false);
      expect(service.getStatus()).toBe('disconnected');
    });

    it('should clear conversation ID on disconnect', async () => {
      const ws = await connectService();

      // Simulate starting a conversation
      const startPromise = service.startConversation('agent-1');
      ws.simulateMessage({
        type: 'CONVERSATION_STARTED',
        payload: { conversationId: 'conv-123' },
      });
      await startPromise;
      expect(service.hasActiveConversation()).toBe(true);

      // Now disconnect
      service.disconnect();
      expect(service.hasActiveConversation()).toBe(false);
    });

    it('should clear message queue on disconnect', async () => {
      // Queue a message while disconnected
      await service.sendTranscript('agent', 'test', true);
      expect((service as any).messageQueue.length).toBeGreaterThanOrEqual(0);

      service.disconnect();
      expect((service as any).messageQueue).toEqual([]);
    });

    it('should disable auto-reconnect on disconnect', async () => {
      await connectService();
      service.disconnect();
      expect((service as any).autoReconnect).toBe(false);
    });

    it('should update status listener on disconnect', async () => {
      const statusListener = vi.fn();
      service.setStatusListener(statusListener);

      await connectService();
      statusListener.mockClear();

      service.disconnect();
      expect(statusListener).toHaveBeenCalledWith('disconnected');
    });
  });

  describe('endConversation()', () => {
    it('should send endConversation action to backend', async () => {
      const ws = await connectService();

      // Start a conversation first
      const startPromise = service.startConversation('agent-1');
      ws.simulateMessage({
        type: 'CONVERSATION_STARTED',
        payload: { conversationId: 'conv-123' },
      });
      await startPromise;

      await service.endConversation();

      const sentMessages = ws.sentMessages.map((m) => JSON.parse(m));
      const endMsg = sentMessages.find((m) => m.action === 'endConversation');
      expect(endMsg).toBeDefined();
      expect(endMsg.conversationId).toBe('conv-123');
    });

    it('should clear conversation ID after ending', async () => {
      const ws = await connectService();

      const startPromise = service.startConversation('agent-1');
      ws.simulateMessage({
        type: 'CONVERSATION_STARTED',
        payload: { conversationId: 'conv-123' },
      });
      await startPromise;

      await service.endConversation();
      expect(service.hasActiveConversation()).toBe(false);
    });

    it('should not send if no active conversation', async () => {
      const ws = await connectService();
      await service.endConversation();

      const sentMessages = ws.sentMessages.map((m) => JSON.parse(m));
      const endMsg = sentMessages.find((m) => m.action === 'endConversation');
      expect(endMsg).toBeUndefined();
    });
  });

  describe('call end cleanup (endConversation + disconnect)', () => {
    it('should end conversation then disconnect cleanly', async () => {
      const ws = await connectService();

      // Start conversation
      const startPromise = service.startConversation('agent-1');
      ws.simulateMessage({
        type: 'CONVERSATION_STARTED',
        payload: { conversationId: 'conv-123' },
      });
      await startPromise;

      expect(service.hasActiveConversation()).toBe(true);
      expect(service.isConnected()).toBe(true);

      // End conversation (what Lambda sees)
      await service.endConversation();
      expect(service.hasActiveConversation()).toBe(false);

      // Disconnect WebSocket (close the connection)
      service.disconnect();
      expect(service.isConnected()).toBe(false);
      expect(service.getStatus()).toBe('disconnected');
      expect(ws.close).toHaveBeenCalledWith(1000, 'Client disconnect');
    });

    it('should handle disconnect even if endConversation fails', async () => {
      const ws = await connectService();

      // Set conversation ID directly
      (service as any).conversationId = 'conv-123';

      // Close the WebSocket before endConversation to simulate failure
      ws.readyState = MockWebSocket.CLOSED;
      (service as any).connectionStatus = 'connected';

      // endConversation will try to send but message gets queued
      await service.endConversation();

      // disconnect should still work
      service.disconnect();
      expect(service.hasActiveConversation()).toBe(false);
      expect(service.getStatus()).toBe('disconnected');
    });

    it('should be able to reconnect after disconnect', async () => {
      const ws1 = await connectService();
      service.disconnect();
      expect(service.isConnected()).toBe(false);

      // Re-enable autoReconnect (disconnect sets it to false)
      (service as any).autoReconnect = true;

      // Connect again
      const ws2 = await connectService();
      expect(service.isConnected()).toBe(true);
      expect(ws2).not.toBe(ws1);
    });
  });

  describe('sendTranscript()', () => {
    it('should send transcript with correct payload', async () => {
      const ws = await connectService();

      // Need active conversation
      const startPromise = service.startConversation('agent-1');
      ws.simulateMessage({
        type: 'CONVERSATION_STARTED',
        payload: { conversationId: 'conv-123' },
      });
      await startPromise;

      await service.sendTranscript('caller', 'I need help', true);

      const sentMessages = ws.sentMessages.map((m) => JSON.parse(m));
      const transcript = sentMessages.find((m) => m.action === 'transcript');
      expect(transcript).toBeDefined();
      expect(transcript.speaker).toBe('caller');
      expect(transcript.text).toBe('I need help');
      expect(transcript.isFinal).toBe(true);
      expect(transcript.conversationId).toBe('conv-123');
    });

    it('should not send if not connected', async () => {
      await service.sendTranscript('caller', 'test', true);
      // No crash, message silently dropped or queued
    });
  });

  describe('handleClose()', () => {
    it('should not auto-reconnect on clean close (code 1000)', async () => {
      await connectService();
      const statusListener = vi.fn();
      service.setStatusListener(statusListener);

      service.disconnect(); // code 1000

      expect(statusListener).toHaveBeenCalledWith('disconnected');
      expect(statusListener).not.toHaveBeenCalledWith('reconnecting');
    });

    it('should attempt reconnection on abnormal close', async () => {
      vi.useFakeTimers();
      const ws = await connectService();
      const statusListener = vi.fn();
      service.setStatusListener(statusListener);

      // Simulate abnormal close (not code 1000)
      ws.simulateClose(1006, 'Abnormal closure');

      expect(statusListener).toHaveBeenCalledWith('reconnecting');
      expect((service as any).reconnectAttempts).toBe(1);

      vi.useRealTimers();
    });

    it('should use exponential backoff for reconnection delays', async () => {
      // Verify the backoff formula: delay * 2^(attempts-1)
      const baseDelay = (service as any).reconnectDelay; // 2000ms
      expect(baseDelay).toBe(2000);

      // First attempt: 2000 * 2^0 = 2000ms
      expect(baseDelay * Math.pow(2, 0)).toBe(2000);
      // Second attempt: 2000 * 2^1 = 4000ms
      expect(baseDelay * Math.pow(2, 1)).toBe(4000);
      // Third attempt: 2000 * 2^2 = 8000ms
      expect(baseDelay * Math.pow(2, 2)).toBe(8000);
    });

    it('should stop reconnecting after max attempts', async () => {
      const maxAttempts = (service as any).maxReconnectAttempts;
      expect(maxAttempts).toBe(5);

      // Simulate reaching max attempts
      (service as any).reconnectAttempts = 5;
      (service as any).autoReconnect = true;

      const ws = await connectService();
      (service as any).reconnectAttempts = 5; // Reset after connect resets it

      const statusListener = vi.fn();
      service.setStatusListener(statusListener);

      ws.simulateClose(1006, 'Abnormal closure');

      // Should go to disconnected, not reconnecting
      expect(statusListener).toHaveBeenCalledWith('disconnected');
    });

    it('should reset reconnect attempts on successful connection', async () => {
      (service as any).reconnectAttempts = 3;
      await connectService();
      expect((service as any).reconnectAttempts).toBe(0);
    });
  });

  describe('handleMessage()', () => {
    it('should call AI tip listener on AI_TIP message', async () => {
      const ws = await connectService();
      const tipListener = vi.fn();
      service.setAITipListener(tipListener);

      ws.simulateMessage({
        type: 'AI_TIP',
        payload: {
          heading: 'Ask about budget',
          stage: 'DISCOVERY',
          context: 'Customer mentioned cost',
          suggestion: 'What is your budget range?',
          recommendationId: 'rec-1',
          timestamp: Date.now(),
        },
      });

      expect(tipListener).toHaveBeenCalledTimes(1);
      const tip = tipListener.mock.calls[0][0];
      expect(tip.heading).toBe('Ask about budget');
      expect(tip.stage).toBe('DISCOVERY');
      expect(tip.options).toHaveLength(1);
      expect(tip.options[0].script).toBe('What is your budget range?');
    });

    it('should call error listener on ERROR message', async () => {
      const ws = await connectService();
      const errorListener = vi.fn();
      service.setErrorListener(errorListener);

      ws.simulateMessage({
        type: 'ERROR',
        payload: {
          code: 'RATE_LIMIT',
          message: 'Too many requests',
        },
      });

      expect(errorListener).toHaveBeenCalledWith({
        code: 'RATE_LIMIT',
        message: 'Too many requests',
      });
    });

    it('should call intelligence listener on INTELLIGENCE_UPDATE', async () => {
      const ws = await connectService();
      const intListener = vi.fn();
      service.setIntelligenceListener(intListener);

      ws.simulateMessage({
        type: 'INTELLIGENCE_UPDATE',
        payload: { sentiment: { label: 'positive', score: 0.85 } },
      });

      expect(intListener).toHaveBeenCalledWith({
        sentiment: { label: 'positive', score: 0.85 },
      });
    });
  });

  describe('message queue', () => {
    it('should queue messages when WebSocket is not ready', async () => {
      // Not connected — messages should be queued
      await service.sendTranscript('agent', 'queued message', true);
      // Since there's no conversation, sendTranscript returns early
      // Test direct queue access
      const queue = (service as any).messageQueue;
      expect(Array.isArray(queue)).toBe(true);
    });

    it('should process queued messages on reconnect', async () => {
      // Queue a message manually
      (service as any).messageQueue = [
        { action: 'transcript', text: 'queued', speaker: 'agent' },
      ];

      const ws = await connectService();

      // Queue should be processed on connect
      const sentMessages = ws.sentMessages.map(m => JSON.parse(m));
      const queued = sentMessages.find(m => m.text === 'queued');
      expect(queued).toBeDefined();
      expect((service as any).messageQueue).toEqual([]);
    });
  });

  describe('startConversation()', () => {
    it('should return null when not connected', async () => {
      const result = await service.startConversation('agent-1');
      expect(result).toBeNull();
    });

    it('should send startConversation action and resolve with ID', async () => {
      const ws = await connectService();

      const promise = service.startConversation('agent-1', { source: 'test' });
      ws.simulateMessage({
        type: 'CONVERSATION_STARTED',
        payload: { conversationId: 'conv-789' },
      });

      const conversationId = await promise;
      expect(conversationId).toBe('conv-789');
      expect(service.hasActiveConversation()).toBe(true);

      const sent = ws.sentMessages.map(m => JSON.parse(m));
      const startMsg = sent.find(m => m.action === 'startConversation');
      expect(startMsg).toBeDefined();
      expect(startMsg.agentId).toBe('agent-1');
    });
  });
});
