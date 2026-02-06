/**
 * AWS WebSocket Service
 *
 * Manages WebSocket connection to AWS API Gateway WebSocket API.
 * Handles connection lifecycle, message routing, and automatic reconnection.
 *
 * WebSocket Routes:
 * - $connect: Authenticate and initialize connection
 * - startConversation: Begin AI coaching session
 * - transcript: Send transcription for AI processing
 * - endConversation: End AI coaching session
 * - $disconnect: Clean up connection
 */

import { AWS_WEBSOCKET_URL, BACKEND_API_KEY } from '@/config/aws';
import type { IntelligenceUpdatePayload } from '@/types/ai-coaching.types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface AIRecommendation {
  heading: string;
  stage: string;
  context?: string;
  options: Array<{
    label: string;
    script: string;
  }>;
  recommendationId: string;
  timestamp: number;
}

interface WebSocketMessage {
  action: string;
  [key: string]: any;
}

export class AWSWebSocketService {
  private ws: WebSocket | null = null;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private conversationId: string | null = null;
  private autoReconnect = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Start with 2 seconds
  private heartbeatInterval: any | null = null;
  private messageQueue: WebSocketMessage[] = [];

  // Promise resolvers for async operations
  private conversationStartResolver: ((conversationId: string) => void) | null = null;
  private conversationStartRejecter: ((error: Error) => void) | null = null;

  // Event listeners
  private statusListener: ((status: ConnectionStatus) => void) | null = null;
  private aiTipListener: ((tip: AIRecommendation) => void) | null = null;
  private intelligenceListener: ((data: IntelligenceUpdatePayload) => void) | null = null;
  private errorListener: ((error: { code: string; message: string }) => void) | null = null;

  constructor() {
    console.log('🚀 [AWSWebSocket] Service initialized');
  }

  /**
   * Set connection status change listener
   */
  setStatusListener(listener: (status: ConnectionStatus) => void): void {
    this.statusListener = listener;
  }

  /**
   * Set AI recommendation listener
   */
  setAITipListener(listener: (tip: AIRecommendation) => void): void {
    this.aiTipListener = listener;
  }

  /**
   * Set Intelligence update listener
   */
  setIntelligenceListener(listener: (data: IntelligenceUpdatePayload) => void): void {
    this.intelligenceListener = listener;
  }

  /**
   * Set error listener
   */
  setErrorListener(listener: (error: { code: string; message: string }) => void): void {
    this.errorListener = listener;
  }

  /**
   * Connect to AWS WebSocket API Gateway
   */
  async connect(): Promise<void> {
    if (this.ws && this.connectionStatus === 'connected') {
      console.log('ℹ️ [AWSWebSocket] Already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.updateStatus('connecting');

        // Include API key as query parameter for authentication
        const wsUrl = `${AWS_WEBSOCKET_URL}?apiKey=${encodeURIComponent(BACKEND_API_KEY)}`;
        console.log(`🔌 [AWSWebSocket] Connecting to ${AWS_WEBSOCKET_URL}`);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.handleOpen();
          resolve();
        };

        this.ws.onmessage = (event) => this.handleMessage(event);

        this.ws.onerror = (event) => {
          this.handleError(event);
          // Only reject if we're still connecting
          if (this.connectionStatus === 'connecting') {
            reject(new Error('WebSocket connection error'));
          }
        };

        this.ws.onclose = (event) => {
          this.handleClose(event);
          // Only reject if we're still connecting (connection failed before open)
          if (this.connectionStatus === 'connecting') {
            reject(new Error(`WebSocket closed before open: ${event.code}`));
          }
        };

      } catch (error: any) {
        console.error('❌ [AWSWebSocket] Connection failed:', error);
        this.updateStatus('error');
        this.notifyError('CONNECTION_FAILED', error.message);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    console.log('🛑 [AWSWebSocket] Disconnecting...');
    this.autoReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.conversationId = null;
    this.messageQueue = [];
    this.updateStatus('disconnected');
  }

  /**
   * Start a new conversation session
   */
  async startConversation(agentId: string, metadata?: Record<string, any>): Promise<string | null> {
    if (!this.isConnected()) {
      console.error('❌ [AWSWebSocket] Cannot start conversation - not connected');
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        // Store resolvers for when CONVERSATION_STARTED arrives
        this.conversationStartResolver = resolve;
        this.conversationStartRejecter = reject;

        const message = {
          action: 'startConversation',
          agentId,
          metadata: {
            ...metadata,
            timestamp: Date.now(),
            apiKey: BACKEND_API_KEY,
          },
        };

        this.sendMessage(message);
        console.log(`✅ [AWSWebSocket] Conversation start requested for agent: ${agentId}`);

        // Set timeout to reject if no response within 10 seconds
        setTimeout(() => {
          if (this.conversationStartRejecter) {
            console.error('❌ [AWSWebSocket] Conversation start timeout');
            this.conversationStartRejecter(new Error('Conversation start timeout'));
            this.conversationStartResolver = null;
            this.conversationStartRejecter = null;
          }
        }, 10000);

      } catch (error: any) {
        console.error('❌ [AWSWebSocket] Failed to start conversation:', error);
        this.notifyError('START_CONVERSATION_FAILED', error.message);
        reject(error);
      }
    });
  }

  /**
   * Send transcript to backend for AI processing
   */
  async sendTranscript(speaker: 'caller' | 'agent', text: string, isFinal: boolean): Promise<void> {
    if (!this.isConnected() || !this.conversationId) {
      console.warn('⚠️ [AWSWebSocket] Cannot send transcript - not connected or no active conversation');
      return;
    }

    try {
      const message = {
        action: 'transcript',
        conversationId: this.conversationId,
        speaker,
        text,
        isFinal,
        timestamp: Date.now(),
      };

      await this.sendMessage(message);
      console.log(`📝 [AWSWebSocket] Transcript sent: ${speaker} (${isFinal ? 'FINAL' : 'INTERIM'})`);
    } catch (error: any) {
      console.error('❌ [AWSWebSocket] Failed to send transcript:', error);
    }
  }

  /**
   * Send selected option to backend
   */
  async selectOption(recommendationId: string, selectedOption: 1 | 2 | 3): Promise<void> {
    if (!this.isConnected() || !this.conversationId) {
      console.warn('⚠️ [AWSWebSocket] Cannot send selection - not connected or no conversation');
      return;
    }

    try {
      const message = {
        action: 'optionSelected',
        payload: {
          conversationId: this.conversationId,
          recommendationId,
          selectedOption,
          timestamp: Date.now(),
        }
      };

      await this.sendMessage(message);
      console.log(`✅ [AWSWebSocket] Option selection sent: ${recommendationId} (Option ${selectedOption})`);
    } catch (error: any) {
      console.error('❌ [AWSWebSocket] Failed to send option selection:', error);
    }
  }

  /**
   * Request intelligence update (Auto-analysis)
   */
  async getIntelligence(conversationId: string): Promise<void> {
    if (!this.isConnected()) {
      console.warn('⚠️ [AWSWebSocket] Cannot get intelligence - not connected');
      return;
    }

    try {
      const message = {
        action: 'getIntelligence',
        conversationId,
        timestamp: Date.now(),
      };

      await this.sendMessage(message);
      console.log(`🧠 [AWSWebSocket] Intelligence requested for: ${conversationId}`);
    } catch (error: any) {
      console.error('❌ [AWSWebSocket] Failed to request intelligence:', error);
    }
  }

  /**
   * End the current conversation session
   */
  async endConversation(): Promise<void> {
    if (!this.conversationId) {
      console.warn('⚠️ [AWSWebSocket] No active conversation to end');
      return;
    }

    try {
      const message = {
        action: 'endConversation',
        conversationId: this.conversationId,
        timestamp: Date.now(),
      };

      await this.sendMessage(message);
      console.log(`✅ [AWSWebSocket] Conversation ended: ${this.conversationId}`);
      this.conversationId = null;
    } catch (error: any) {
      console.error('❌ [AWSWebSocket] Failed to end conversation:', error);
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.connectionStatus === 'connected';
  }

  /**
   * Check if there's an active conversation
   */
  hasActiveConversation(): boolean {
    return this.conversationId !== null;
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private handleOpen(): void {
    console.log('✅ [AWSWebSocket] Connected to API Gateway');
    this.updateStatus('connected');
    this.reconnectAttempts = 0;
    this.reconnectDelay = 2000;

    // Start heartbeat to keep connection alive
    this.startHeartbeat();

    // Process any queued messages
    this.processMessageQueue();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 [AWSWebSocket] Message received:', data.type || data.action);

      switch (data.type) {
        case 'CONVERSATION_STARTED':
          if (!data.payload || !data.payload.conversationId) {
            console.error('❌ [AWSWebSocket] CONVERSATION_STARTED missing conversationId');
            if (this.conversationStartRejecter) {
              this.conversationStartRejecter(new Error('No conversation ID received'));
              this.conversationStartResolver = null;
              this.conversationStartRejecter = null;
            }
            break;
          }

          this.conversationId = data.payload.conversationId;
          console.log(`🎯 [AWSWebSocket] Conversation ID: ${this.conversationId}`);

          // Resolve the startConversation promise
          if (this.conversationStartResolver && this.conversationId) {
            this.conversationStartResolver(this.conversationId);
            this.conversationStartResolver = null;
            this.conversationStartRejecter = null;
          } else if (this.conversationStartRejecter) {
            this.conversationStartRejecter(new Error('No conversation ID received'));
            this.conversationStartResolver = null;
            this.conversationStartRejecter = null;
          }
          break;

        case 'AI_TIP':
          if (!data.payload) {
            console.error('❌ [AWSWebSocket] AI_TIP missing payload');
            break;
          }

          // Log the actual payload structure for debugging
          console.log('📨 [AWSWebSocket] AI_TIP payload received:', JSON.stringify(data.payload));

          if (this.aiTipListener) {
            // Handle both single suggestion format (NEW) and options format (OLD)
            const tip: AIRecommendation = {
              heading: data.payload.heading || 'Suggestion',
              stage: data.payload.stage || 'GENERAL',
              context: data.payload.context || '',
              // Convert single suggestion to options format for backward compatibility
              options: data.payload.suggestion
                ? [{ label: 'Recommended', script: data.payload.suggestion }]
                : (data.payload.options || []),
              recommendationId: data.payload.recommendationId || '',
              timestamp: data.payload.timestamp || Date.now(),
            };
            this.aiTipListener(tip);
            console.log(`💡 [AWSWebSocket] AI Tip: ${tip.heading} (${tip.options.length} options)`);
          }
          break;

        case 'INTELLIGENCE_UPDATE':
          if (!data.payload) {
            console.error('❌ [AWSWebSocket] INTELLIGENCE_UPDATE missing payload');
            break;
          }

          if (this.intelligenceListener) {
            console.log('🧠 [AWSWebSocket] Intelligence update received');
            this.intelligenceListener(data.payload);
          }
          break;

        case 'CONVERSATION_ENDED':
          console.log('✅ [AWSWebSocket] Conversation ended confirmation');
          this.conversationId = null;
          break;

        case 'ERROR':
          const errorPayload = data.payload || {};
          console.error('❌ [AWSWebSocket] Server error:', errorPayload);
          this.notifyError(
            errorPayload.code || 'SERVER_ERROR',
            errorPayload.message || 'Unknown server error'
          );

          // Reject conversation start if pending
          if (this.conversationStartRejecter) {
            this.conversationStartRejecter(new Error(errorPayload.message || 'Server error'));
            this.conversationStartResolver = null;
            this.conversationStartRejecter = null;
          }
          break;

        case 'PONG':
          // Heartbeat response
          console.log('💓 [AWSWebSocket] Heartbeat acknowledged');
          break;

        default:
          console.warn('⚠️ [AWSWebSocket] Unknown message type:', data.type);
      }
    } catch (error: any) {
      console.error('❌ [AWSWebSocket] Error processing message:', error);
    }
  }

  private handleError(event: Event): void {
    console.error('❌ [AWSWebSocket] WebSocket error:', event);
    this.updateStatus('error');
    this.notifyError('WEBSOCKET_ERROR', 'WebSocket connection error');
  }

  private handleClose(event: CloseEvent): void {
    console.log(`🔌 [AWSWebSocket] Connection closed (code: ${event.code}, reason: ${event.reason})`);

    this.stopHeartbeat();
    this.ws = null;

    // Normal closure
    if (event.code === 1000) {
      this.updateStatus('disconnected');
      return;
    }

    // Attempt reconnection
    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.updateStatus('reconnecting');
      this.reconnectAttempts++;

      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
      console.log(`🔄 [AWSWebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect().catch(error => {
          console.error('❌ [AWSWebSocket] Reconnection failed:', error);
        });
      }, delay);
    } else {
      this.updateStatus('disconnected');
      this.notifyError('CONNECTION_LOST', 'WebSocket connection lost');
    }
  }

  private async sendMessage(message: WebSocketMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ [AWSWebSocket] WebSocket not ready, queueing message');
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      console.log(`📤 [AWSWebSocket] Message sent: ${message.action}`);
    } catch (error: any) {
      console.error('❌ [AWSWebSocket] Failed to send message:', error);
      this.messageQueue.push(message);
      throw error;
    }
  }

  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) return;

    console.log(`📮 [AWSWebSocket] Processing ${this.messageQueue.length} queued messages`);

    const queue = [...this.messageQueue];
    this.messageQueue = [];

    queue.forEach(message => {
      this.sendMessage(message).catch(error => {
        console.error('❌ [AWSWebSocket] Failed to send queued message:', error);
      });
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        this.sendMessage({ action: 'ping' }).catch(() => {
          console.warn('⚠️ [AWSWebSocket] Heartbeat failed');
        });
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private updateStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    console.log(`🔄 [AWSWebSocket] Status: ${status}`);

    if (this.statusListener) {
      this.statusListener(status);
    }
  }

  private notifyError(code: string, message: string): void {
    if (this.errorListener) {
      this.errorListener({ code, message });
    }
  }
}

// Export singleton instance
export const awsWebSocketService = new AWSWebSocketService();
