// Call State Types
export type CallState =
  | "inactive"
  | "detecting"
  | "active"
  | "paused"
  | "ended";
export type AudioState = "idle" | "capturing" | "streaming" | "error";
export type DeepgramStatus = "disconnected" | "connected" | "error";

// Call Detection
export interface CallDetection {
  isCallActive: boolean;
  callStartTime?: number;
  callEndTime?: number;
  callDuration?: number;
}

// Audio Capture
export interface AudioCapture {
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  isCapturing: boolean;
  audioLevel: number;
}

// Transcription with Deepgram support
export interface Transcription {
  id?: string; // Optional unique identifier
  text: string;
  speaker: "agent" | "customer";
  timestamp: number;
  confidence: number;
  isFinal?: boolean; // Distinguishes between interim and final Deepgram transcripts
}

// Coaching Tip with extended types
export interface CoachingTip {
  id: string;
  type: "suggestion" | "warning" | "positive" | "question" | "info";
  message: string;
  timestamp: number;
  priority: "low" | "medium" | "high" | "normal";
}

// Call Session with Deepgram status
export interface CallSession {
  id: string;
  callState: CallState;
  audioState: AudioState;
  deepgramStatus?: DeepgramStatus;
  startTime: number;
  endTime?: number;
  transcriptions: Transcription[];
  coachingTips: CoachingTip[];
  audioLevel: number;
}

// Settings
export interface Settings {
  deepgramApiKey: string;
  n8nWebhookUrl: string;
  aiCoachingEnabled: boolean; // NEW: Enable/disable AI coaching via n8n
  audioSensitivity: number;
  enableNotifications: boolean;
  theme: "light" | "dark" | "system";
}

// Extended Chrome Messages for Deepgram integration
export interface ChromeMessage {
  type:
    | "CALL_STARTED"
    | "CALL_ENDED"
    | "CALL_DETECTED"
    | "TRANSCRIPTION"
    | "TRANSCRIPTION_UPDATE"
    | "COACHING_TIP"
    | "AUDIO_LEVEL"
    | "AUDIO_LEVEL_UPDATE"
    | "ERROR"
    | "START_CAPTURE"
    | "STOP_CAPTURE"
    | "CAPTURE_STARTED"
    | "CAPTURE_STOPPED"
    | "CAPTURE_ERROR"
    | "DEEPGRAM_STATUS"
    | "STATE_UPDATE"
    | "GET_CURRENT_STATE"
    | "GET_TRANSCRIPTIONS"
    | "GET_COACHING_TIPS"
    | "CLEAR_TRANSCRIPTIONS"
    | "START_COACHING_FROM_POPUP"
    | "TURN_ENDED"
    | "REQUEST_COACHING_TIP"
    | "CALL_START_FAILED"
    | "EXTENSION_STATE_CHANGED"
    | "PING"
    | "WEBRTC_STREAMS_READY"     // NEW: Content → Background
    | "START_WEBRTC_CAPTURE"     // NEW: Background → Offscreen
    | "GET_WEBRTC_STREAMS"       // NEW: Offscreen → Content
    | "WEBRTC_STREAM_PORT"       // NEW: Content → Offscreen
    | "AUDIO_TRACKS_READY";      // NEW: Injected → Content (via postMessage)
  payload?: any;
}

// Deepgram-specific types
export interface DeepgramTranscription {
  transcript: string;
  isFinal: boolean;
  timestamp: number;
  confidence: number;
  speaker?: 'caller' | 'agent';
}

// WebRTC Interception types
export interface WebRTCStreamMetadata {
  remoteTrackIds: string[];
  localTrackIds: string[];
  timestamp: number;
}

export interface InterceptedStream {
  id: string;
  type: 'local' | 'remote';
  stream: MediaStream;
  tracks: MediaStreamTrack[];
  timestamp: number;
}

export interface DeepgramConfig {
  model: string;
  language: string;
  smartFormat: boolean;
  interimResults: boolean;
  punctuate?: boolean;
  diarize?: boolean;
  utteranceEndMs?: number;
}

// Extension State (for background script)
export interface ExtensionState {
  isAuthenticated: boolean;
  isRecording: boolean;
  isOnCall: boolean;
  deepgramStatus: DeepgramStatus;
  transcriptions: DeepgramTranscription[];
  coachingTips: CoachingTip[];
  currentStreamId: string | null;
  tabId: number | null;
  userEmail: string | null;
  startTime: number | null;
  captureMode: 'webrtc';  // NEW: Only WebRTC mode supported
  remoteStreamActive: boolean;  // NEW: Caller audio stream status
  localStreamActive: boolean;   // NEW: Agent mic stream status
}

// Offscreen Message Types
export interface OffscreenMessage {
  type: "START_CAPTURE" | "STOP_CAPTURE" | "GET_CAPTURE_STATE";
  streamId?: string;
}

export interface OffscreenResponse {
  success: boolean;
  error?: string;
  isCapturing?: boolean;
  hasMediaRecorder?: boolean;
  hasDeepgramConnection?: boolean;
}

// Background Message Responses
export interface BackgroundResponse {
  success: boolean;
  result?: any;
  error?: string;
}

// State Update Payload
export interface StateUpdatePayload {
  isRecording?: boolean;
  isOnCall?: boolean;
  deepgramStatus?: DeepgramStatus;
  transcriptions?: DeepgramTranscription[];
  coachingTips?: CoachingTip[];
  timestamp: number;
  tabId?: number | null;
  status?: "active" | "inactive" | "capturing";
}

// Call Summary (for end of call)
export interface CallSummary {
  totalTranscriptions: number;
  totalCoachingTips: number;
  duration: number;
  finalTranscripts?: Transcription[];
  topTips?: CoachingTip[];
}

// AI Backend Integration Types (Socket.io WebSocket)
export type AIBackendStatus = 'disconnected' | 'connecting' | 'ready' | 'error' | 'reconnecting';

export type ConversationStage =
  | 'GREETING'
  | 'DISCOVERY'
  | 'VALUE_PROP'
  | 'OBJECTION_HANDLING'
  | 'NEXT_STEPS'
  | 'CONVERSION';

export interface DialogueOption {
  label: string; // "Minimal", "Explanative", "Contextual"
  script: string; // Exact words to say
}

export interface AIRecommendation {
  id: string;
  recommendationId: string; // Backend UUID for tracking selection
  heading: string; // Max 2 words (e.g., "Ask Discovery")
  stage: ConversationStage;
  context: string; // Why this recommendation makes sense
  options: [DialogueOption, DialogueOption, DialogueOption]; // Always 3 options
  selectedOption?: 1 | 2 | 3; // Which option user clicked
  timestamp: number;
  conversationId?: string;
}

export interface AIBackendConfig {
  url: string;
  apiKey: string;
  autoReconnect: boolean;
  reconnectAttempts: number;
}

// WebSocket Message Types (Backend Communication)
export interface WSMessage {
  type: string;
  payload: any;
}

export interface StartConversationPayload {
  agentId: string;
  metadata?: Record<string, any>;
}

export interface TranscriptPayload {
  conversationId: string;
  speaker: 'caller' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface EndConversationPayload {
  conversationId: string;
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

export interface AIErrorPayload {
  conversationId?: string;
  message: string;
  code: string;
  timestamp: number;
}

// Script Option for AI Suggestions
export interface ScriptOption {
  id: string;
  type: string;
  label: string;
  script: string;
  icon?: string;
}

// Re-export types from ai-coaching.types.ts
export type {
  ConversationIntelligence,
  ExtractedEntities,
  IntelligenceUpdatePayload
} from './ai-coaching.types';
