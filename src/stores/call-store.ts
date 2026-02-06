import { create } from "zustand";
import type {
  CallSession,
  CallState,
  AudioState,
  Transcription,
  CoachingTip,
  AIBackendStatus,
  AIRecommendation,
  ConversationIntelligence,
  ExtractedEntities,
  ScriptOption,
} from "@/types";

// Extended store interface with Deepgram and AI Backend support
interface CallStore {
  session: CallSession | null;
  callState: CallState;
  audioState: AudioState;
  audioLevel: number;
  transcriptions: Transcription[];
  coachingTips: CoachingTip[];
  deepgramStatus?: "disconnected" | "connected" | "error";

  // AI Backend fields
  aiBackendStatus: AIBackendStatus;
  aiTips: AIRecommendation[];
  aiConversationId: string | null;
  lastAIUpdate: number | null;

  // Conversation Intelligence fields
  intelligence: ConversationIntelligence | null;
  entities: ExtractedEntities | null;

  // Developer Mode fields
  environment: 'sandbox' | 'production';
  websocketUrl: string;

  // Script Options field (for GreetingsSelector)
  currentScriptOptions: ScriptOption[];

  // Actions
  startCall: () => void;
  endCall: () => void;
  setCallState: (state: CallState) => void;
  setAudioState: (state: AudioState) => void;
  setAudioLevel: (level: number) => void;
  setDeepgramStatus: (status: "disconnected" | "connected" | "error") => void;
  addTranscription: (transcription: Transcription) => void;
  addCoachingTip: (tip: CoachingTip) => void;
  clearSession: () => void;
  loadFromStorage: () => Promise<void>;

  // AI Backend actions
  setAIBackendStatus: (status: AIBackendStatus) => void;
  addAITip: (tip: AIRecommendation) => void;
  setAIConversationId: (id: string | null) => void;
  selectAIOption: (tipId: string, optionNumber: 1 | 2 | 3) => void;
  clearAITips: () => void;

  // Intelligence actions
  updateIntelligence: (intelligence: ConversationIntelligence) => void;
  updateEntities: (entities: ExtractedEntities) => void;

  // Developer Mode actions
  setEnvironment: (environment: 'sandbox' | 'production') => void;

  // Script management actions
  requestNextSuggestion: (currentOption: ScriptOption) => void;
  refreshContext: () => void;
  setCurrentScriptOptions: (options: ScriptOption[]) => void;
}

// WebSocket URL constants
const PRODUCTION_WS_URL = import.meta.env.VITE_WS_URL || 'wss://your-api-gateway.execute-api.us-east-1.amazonaws.com/prod';
const SANDBOX_WS_URL = 'ws://localhost:8080';

// Create store with persistence
export const useCallStore = create<CallStore>((set, get) => ({
  session: null,
  callState: "inactive",
  audioState: "idle",
  audioLevel: 0,
  transcriptions: [],
  coachingTips: [],
  deepgramStatus: "disconnected",

  // AI Backend initial state
  aiBackendStatus: "disconnected",
  aiTips: [],
  aiConversationId: null,
  lastAIUpdate: null,

  // Conversation Intelligence initial state
  intelligence: null,
  entities: null,

  // Developer Mode initial state
  environment: 'production',
  websocketUrl: PRODUCTION_WS_URL,

  // Script Options initial state
  currentScriptOptions: [],

  startCall: () => {
    const newState = {
      session: {
        id: `call-${Date.now()}`,
        callState: "active" as CallState,
        audioState: "capturing" as AudioState,
        startTime: Date.now(),
        transcriptions: [],
        coachingTips: [],
        audioLevel: 0,
      },
      callState: "active" as CallState,
      audioState: "capturing" as AudioState,
      transcriptions: [],
      coachingTips: [],
      deepgramStatus: "disconnected" as "disconnected" | "connected" | "error",
    };

    set(newState);
    persistState(get());
  },

  endCall: () => {
    const state = get();
    const newState = {
      callState: "ended" as CallState,
      audioState: "idle" as AudioState,
      deepgramStatus: "disconnected" as "disconnected" | "connected" | "error",
      session: state.session
        ? {
            ...state.session,
            endTime: Date.now(),
            callState: "ended" as CallState,
          }
        : null,
    };

    set(newState);
    persistState(get());
  },

  setCallState: (callState) => {
    set({ callState });
    persistState(get());
  },

  setAudioState: (audioState) => {
    set({ audioState });
    persistState(get());
  },

  setAudioLevel: (audioLevel) => {
    set({ audioLevel });
    // Don't persist audio level (changes too frequently)
  },

  setDeepgramStatus: (deepgramStatus) => {
    set({ deepgramStatus });
    console.log(`🔌 [Store] Deepgram status updated: ${deepgramStatus}`);
    // Persist Deepgram status
    persistState(get());
  },

  addTranscription: (transcription) => {
    set((state) => ({
      transcriptions: [...state.transcriptions, transcription],
    }));
    persistState(get());
  },

  addCoachingTip: (tip) => {
    set((state) => ({
      coachingTips: [...state.coachingTips, tip],
    }));
    persistState(get());
  },

  clearSession: () => {
    const newState = {
      session: null,
      callState: "inactive" as CallState,
      audioState: "idle" as AudioState,
      audioLevel: 0,
      transcriptions: [],
      coachingTips: [],
      deepgramStatus: "disconnected" as "disconnected" | "connected" | "error",
      // Clear AI Backend state too
      aiBackendStatus: "disconnected" as AIBackendStatus,
      aiTips: [],
      aiConversationId: null,
      lastAIUpdate: null,
      // Clear Intelligence state
      intelligence: null,
      entities: null,
    };

    set(newState);
    persistState(newState);
    console.log("🗑️ [Store] Session cleared");
  },

  loadFromStorage: async () => {
    try {
      const result = await chrome.storage.local.get("callStoreState");
      if (result.callStoreState) {
        const savedState = result.callStoreState;
        set({
          session: savedState.session,
          callState: savedState.callState || "inactive",
          audioState: savedState.audioState || "idle",
          transcriptions: savedState.transcriptions || [],
          coachingTips: savedState.coachingTips || [],
          deepgramStatus: savedState.deepgramStatus || "disconnected",
          audioLevel: 0, // Don't restore audio level
          // AI Backend state
          aiBackendStatus: savedState.aiBackendStatus || "disconnected",
          aiTips: savedState.aiTips || [],
          aiConversationId: savedState.aiConversationId || null,
          lastAIUpdate: savedState.lastAIUpdate || null,
          // Intelligence state
          intelligence: savedState.intelligence || null,
          entities: savedState.entities || null,
          // Developer Mode state
          environment: savedState.environment || 'production',
          websocketUrl: savedState.websocketUrl || PRODUCTION_WS_URL,
        });
        console.log(
          "✅ [Store] Loaded state from storage:",
          savedState.callState
        );
      }
    } catch (error) {
      console.error("❌ [Store] Error loading state from storage:", error);
    }
  },

  // AI Backend actions
  setAIBackendStatus: (aiBackendStatus) => {
    set({ aiBackendStatus });
    console.log(`🤖 [Store] AI Backend status: ${aiBackendStatus}`);
    persistState(get());
  },

  addAITip: (tip) => {
    set((state) => ({
      aiTips: [...state.aiTips, tip],
      lastAIUpdate: Date.now(),
    }));
    console.log(`💡 [Store] AI tip added: ${tip.heading}`);
    persistState(get());
  },

  setAIConversationId: (aiConversationId) => {
    set({ aiConversationId });
    console.log(`🎯 [Store] AI conversation ID: ${aiConversationId}`);
    persistState(get());
  },

  selectAIOption: (tipId, optionNumber) => {
    set((state) => ({
      aiTips: state.aiTips.map((tip) =>
        tip.id === tipId
          ? { ...tip, selectedOption: optionNumber }
          : tip
      ),
    }));
    console.log(`👆 [Store] Selected option ${optionNumber} for tip: ${tipId}`);
    persistState(get());
  },

  clearAITips: () => {
    set({
      aiTips: [],
      lastAIUpdate: null,
    });
    console.log("🗑️ [Store] AI tips cleared");
    persistState(get());
  },

  // Intelligence actions
  updateIntelligence: (intelligence) => {
    set({ intelligence });
    console.log(`🧠 [Store] Intelligence updated: ${intelligence.sentiment.label}`);
    persistState(get());
  },

  updateEntities: (entities) => {
    set({ entities });
    console.log(`🏷️ [Store] Entities updated: ${entities.businessNames.length} businesses`);
    persistState(get());
  },

  // Developer Mode actions
  setEnvironment: (environment) => {
    const websocketUrl = environment === 'sandbox' ? SANDBOX_WS_URL : PRODUCTION_WS_URL;
    set({ environment, websocketUrl });
    console.log(`🔧 [Store] Environment changed to: ${environment} (${websocketUrl})`);
    persistState(get());
  },

  // Script management actions
  requestNextSuggestion: (currentOption) => {
    const state = get();
    console.log(`🔄 [Store] Requesting next suggestion for: ${currentOption.label}`);
    
    // Construct payload for Golden Script analysis (Legacy - now forwarded via BG)
    // const payload = { ... }

    // Call service (assumed global or import)
    const transcriptText = state.transcriptions.slice(-10).map(t => t.text).join(' ');
    
    // Send message to Background Worker (which holds the WebSocket)
    chrome.runtime.sendMessage({
      type: 'REQUEST_NEXT_TIP',
      payload: {
        conversationId: state.aiConversationId || state.session?.id,
        context: transcriptText,
        text: `[Requesting Tip] ${currentOption.label}`, // Marker for backend
        timestamp: Date.now()
      }
    }).catch(err => {
        console.error("❌ [Store] Failed to request next tip via background:", err);
    });
  },

  refreshContext: () => {
    console.log(`🔄 [Store] Refreshing context for new AI suggestion`);
    // Request context-based refresh from backend via WebSocket
    // This would trigger a backend request in a real implementation
  },

  setCurrentScriptOptions: (options) => {
    set({ currentScriptOptions: options });
    console.log(`📝 [Store] Updated script options: ${options.length} options`);
    persistState(get());
  },
}));

// Helper function to persist state to Chrome storage
function persistState(state: Partial<CallStore>) {
  const stateToPersist = {
    session: state.session,
    callState: state.callState,
    audioState: state.audioState,
    transcriptions: state.transcriptions,
    coachingTips: state.coachingTips,
    deepgramStatus: state.deepgramStatus,
    // AI Backend state
    aiBackendStatus: state.aiBackendStatus,
    aiTips: state.aiTips,
    aiConversationId: state.aiConversationId,
    lastAIUpdate: state.lastAIUpdate,
    // Intelligence state
    intelligence: state.intelligence,
    entities: state.entities,
    // Developer Mode state
    environment: state.environment,
    websocketUrl: state.websocketUrl,
  };

  chrome.storage.local
    .set({ callStoreState: stateToPersist })
    .catch((error) => {
      console.error("❌ [Store] Error persisting state:", error);
    });
}

// Initialize store from storage when module loads
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get("callStoreState", (result) => {
    if (result.callStoreState) {
      useCallStore.setState({
        session: result.callStoreState.session,
        callState: result.callStoreState.callState || "inactive",
        audioState: result.callStoreState.audioState || "idle",
        transcriptions: result.callStoreState.transcriptions || [],
        coachingTips: result.callStoreState.coachingTips || [],
        deepgramStatus: result.callStoreState.deepgramStatus || "disconnected",
        audioLevel: 0,
        // AI Backend state
        aiBackendStatus: result.callStoreState.aiBackendStatus || "disconnected",
        aiTips: result.callStoreState.aiTips || [],
        aiConversationId: result.callStoreState.aiConversationId || null,
        lastAIUpdate: result.callStoreState.lastAIUpdate || null,
        // Intelligence state
        intelligence: result.callStoreState.intelligence || null,
        entities: result.callStoreState.entities || null,
        // Developer Mode state
        environment: result.callStoreState.environment || 'production',
        websocketUrl: result.callStoreState.websocketUrl || PRODUCTION_WS_URL,
      });
      console.log("✅ [Store] Initial state loaded from storage");
    }
  });
}
