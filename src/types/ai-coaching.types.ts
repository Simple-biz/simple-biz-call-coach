/**
 * AI Coaching Types
 * TypeScript types for AI-powered conversation coaching with 3-option dialogue scripts
 */

export type ConversationStage =
  | 'GREETING'
  | 'DISCOVERY'
  | 'VALUE_PROP'
  | 'OBJECTION_HANDLING'
  | 'NEXT_STEPS'
  | 'CONVERSION';

export interface DialogueOption {
  label: string; // "Minimal", "Explanative", "Contextual"
  script: string; // Exact words to say to customer
}

export interface AITip {
  recommendationId: string; // UUID from backend
  conversationId: string;
  stage: ConversationStage;
  heading: string; // 2-word heading (e.g., "Ask Discovery")
  context: string; // Why this recommendation makes sense
  options: [DialogueOption, DialogueOption, DialogueOption]; // Always 3 options
  selectedOption?: 1 | 2 | 3; // Which option user clicked
  timestamp: number;
}

export type AIStatus =
  | 'idle' // Not started
  | 'warmup' // 0-3 minutes, no analysis yet
  | 'ready' // After warmup, actively analyzing
  | 'error' // AI analysis failed
  | 'reconnecting'; // WebSocket reconnecting

export interface AIState {
  status: AIStatus;
  tips: AITip[];
  conversationId: string | null;
  aiStartTime: number | null;
  warmupProgress: number; // 0-100% during warmup
  nextUpdateIn: number; // Seconds until next AI tip
  error: string | null;
}

// WebSocket Event Payloads

export interface StartConversationPayload {
  agentId: string;
  metadata?: Record<string, any>;
}

export interface ConversationStartedPayload {
  conversationId: string;
  agentId: string;
  startTime: string;
  timestamp: number;
}

export interface TranscriptPayload {
  conversationId: string;
  speaker: 'caller' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp?: number;
}

export interface AITipPayload {
  recommendationId: string;
  conversationId: string;
  stage: ConversationStage;
  heading: string;
  context: string;
  options: DialogueOption[];
  timestamp: number;
}

export interface OptionSelectedPayload {
  recommendationId: string;
  selectedOption: 1 | 2 | 3;
}

export interface OptionSelectedAckPayload {
  recommendationId: string;
  selectedOption: 1 | 2 | 3;
  timestamp: number;
}

export interface ErrorPayload {
  message: string;
  code: string;
  timestamp: number;
}

// Conversation Intelligence Types (for IntelligenceDisplay component)
export interface ExtractedEntities {
  businessNames: string[];
  contactInfo: {
    emails: string[];
    phoneNumbers: string[];
    urls: string[];
  };
  locations: string[];
  dates: string[];
  people: string[];
  timestamp: number;
}

export interface ConversationIntelligence {
  sentiment: {
    label: 'positive' | 'negative' | 'neutral';
    score: number; // 0-1
    averageScore: number;
  };
  intents: Array<{
    intent: string;
    confidence: number;
    segment: string; // Text segment where intent was detected
  }>;
  topics: Array<{
    topic: string;
    confidence: number;
    segment: string;
  }>;
  summary: string;
  lastUpdated: number;
}

export interface IntelligenceUpdatePayload {
  conversationId: string;
  intelligence: ConversationIntelligence;
  entities: ExtractedEntities;
  timestamp: number;
}

// WebSocket Events (for type safety)
export type WebSocketEvent =
  | { type: 'START_CONVERSATION'; payload: StartConversationPayload }
  | { type: 'CONVERSATION_STARTED'; payload: ConversationStartedPayload }
  | { type: 'TRANSCRIPT'; payload: TranscriptPayload }
  | { type: 'AI_TIP'; payload: AITipPayload }
  | { type: 'INTELLIGENCE_UPDATE'; payload: IntelligenceUpdatePayload }
  | { type: 'OPTION_SELECTED'; payload: OptionSelectedPayload }
  | { type: 'OPTION_SELECTED_ACK'; payload: OptionSelectedAckPayload }
  | { type: 'ERROR'; payload: ErrorPayload }
  | { type: 'PING'; payload: {} }
  | { type: 'PONG'; payload: { timestamp: number } };
