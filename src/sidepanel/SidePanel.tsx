import { useEffect, useState, useCallback } from "react";
import { useCallStore } from "@/stores/call-store";
import {
  Mic,
  Trash2,
  Wifi,
  WifiOff,
  Send,
} from "lucide-react";
import type { Transcription, CoachingTip, DeepgramStatus, ScriptOption } from "@/types";
import { ChatThread } from "@/components/ChatThread";
import { IntelligenceDisplay } from "@/components/IntelligenceDisplay";
import { SessionStats } from "@/components/SessionStats";
import { pttDeepgramService, type PTTStatus } from "@/services/ptt-deepgram.service";
import { useSettingsStore } from "@/stores/settings-store";

export default function SidePanel() {
  const {
    callState,
    audioLevel,
    transcriptions,
    coachingTips,
    intelligence,
    entities,
    environment,
    session
  } = useCallStore();
  const [deepgramStatus, setDeepgramStatus] =
    useState<DeepgramStatus>("disconnected");
  const isLoadingScripts = useCallStore((s) => s.isGeneratingTip);

  // Sandbox mode: Customer input (text)
  const [customerMessage, setCustomerMessage] = useState('');
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [threadVisible, setThreadVisible] = useState(false);

  // Sandbox mode: Agent PTT (Push-to-Talk)
  const [pttStatus, setPttStatus] = useState<PTTStatus>('idle');
  const [pttTranscript, setPttTranscript] = useState(''); // Live transcription preview
  const [pttAudioLevel, setPttAudioLevel] = useState(0);
  const [isPttButtonHeld, setIsPttButtonHeld] = useState(false);

  // Get Deepgram API key from settings
  const { deepgramApiKey } = useSettingsStore();

  useEffect(() => {
    console.log(`📊 [SidePanel] Transcriptions array updated: ${transcriptions.length} items`, transcriptions);
  }, [transcriptions]);

  useEffect(() => {
    // Load persisted state on mount
    useCallStore.getState().loadFromStorage();
    console.log("📂 [SidePanel] Loading state from storage");

    // Load Developer Mode setting from storage and sync with environment
    chrome.storage.local.get(['developerModeEnabled', 'deepgramApiKey'], (result: { developerModeEnabled?: boolean; deepgramApiKey?: string }) => {
      if (result.developerModeEnabled !== undefined) {
        const env = result.developerModeEnabled ? 'sandbox' : 'production';
        useCallStore.getState().setEnvironment(env);
        console.log(`🔧 [SidePanel] Environment loaded from storage: ${env}`);
      }
      
      // Hydrate Deepgram API key
      if (result.deepgramApiKey) {
        useSettingsStore.getState().setDeepgramApiKey(result.deepgramApiKey);
        console.log("🔑 [SidePanel] Deepgram API key loaded from storage");
      } else {
        // Fallback: read from env var
        const envKey = import.meta.env.VITE_DEEPGRAM_API_KEY || '';
        if (envKey) {
          chrome.storage.local.set({ deepgramApiKey: envKey });
          useSettingsStore.getState().setDeepgramApiKey(envKey);
          console.log("🔑 [SidePanel] Deepgram API key loaded from environment");
        } else {
          console.warn("⚠️ [SidePanel] No Deepgram API key found. Set VITE_DEEPGRAM_API_KEY in .env.production.");
        }
      }
    });

    // Listen for messages from background
    const handleMessage = (message: any) => {
      console.log("📨 [SidePanel] Received message:", message.type);

      switch (message.type) {
        case "STATE_UPDATE":
          // Handle full state updates from background
          if (message.payload) {
            const payload = message.payload;

            if (payload.isRecording !== undefined) {
              useCallStore
                .getState()
                .setCallState(payload.isRecording ? "active" : "inactive");
            }

            if (payload.deepgramStatus) {
              const status = payload.deepgramStatus as DeepgramStatus;
              setDeepgramStatus(status);
              useCallStore.getState().setDeepgramStatus(status);
            }

            if (payload.transcriptions && Array.isArray(payload.transcriptions)) {
              // Sync transcriptions from background state
              useCallStore.setState({
                transcriptions: payload.transcriptions.map((t: any) => ({
                  text: t?.transcript || '',
                  speaker: (t?.speaker === 'caller' ? 'customer' : 'agent') as 'agent' | 'customer',
                  timestamp: t?.timestamp || Date.now(),
                  confidence: t?.confidence || 0,
                  isFinal: t?.isFinal || false,
                })),
              });
            }

            if (payload.coachingTips) {
              useCallStore.setState({ coachingTips: payload.coachingTips });
            }
          }
          break;

        case "AUDIO_LEVEL":
          useCallStore.setState({ audioLevel: message.level });
          break;

        case "CALL_STARTED":
        case "CAPTURE_STARTED":
          useCallStore.getState().startCall();
          console.log("✅ [SidePanel] Call started with session");
          break;

        case "CALL_ENDED":
        case "CAPTURE_STOPPED":
          useCallStore.getState().endCall();
          setDeepgramStatus("disconnected");
          console.log("✅ [SidePanel] Call ended, session finalized");
          break;

        case "DEEPGRAM_STATUS":
          const status = message.status as DeepgramStatus;
          setDeepgramStatus(status);
          useCallStore.getState().setDeepgramStatus(status);
          console.log(`🔌 [SidePanel] Deepgram status: ${status}`);
          break;

        case "TRANSCRIPTION_UPDATE":
          // Add new transcription from Deepgram
          if (!message.transcript) {
            console.warn("⚠️ [SidePanel] TRANSCRIPTION_UPDATE missing transcript, skipping");
            break;
          }

          console.log(`📝 [SidePanel] TRANSCRIPTION_UPDATE received:`, {
            speaker: message.speaker,
            transcript: message.transcript,
            isFinal: message.isFinal,
            confidence: message.confidence
          });

          const newTranscription: Transcription = {
            text: message.transcript,
            speaker: (message.speaker === 'caller' ? 'customer' : 'agent') as 'agent' | 'customer',
            timestamp: message.timestamp || Date.now(),
            confidence: message.confidence || 0,
            isFinal: message.isFinal || false,
          };

          if (message.isFinal) {
            // FINAL transcript - remove any interim from same speaker and add final
            const currentTranscriptions = useCallStore.getState().transcriptions;
            const lastTranscript = currentTranscriptions[currentTranscriptions.length - 1];

            // If last transcript is interim from same speaker, replace it with final
            if (lastTranscript && !lastTranscript.isFinal && lastTranscript.speaker === newTranscription.speaker) {
              currentTranscriptions[currentTranscriptions.length - 1] = newTranscription;
              useCallStore.setState({
                transcriptions: [...currentTranscriptions],
              });
              console.log(`📝 [SidePanel] Replaced INTERIM with FINAL from ${newTranscription.speaker}: "${newTranscription.text}"`);
            } else {
              // No interim to replace, just add the final
              useCallStore.getState().addTranscription(newTranscription);
              console.log(`📝 [SidePanel] Added FINAL transcription from ${newTranscription.speaker}: "${newTranscription.text}"`);
            }
          } else {
            // INTERIM transcript - skip for now (only show finals in thread)
            console.log(`📝 [SidePanel] Skipping INTERIM transcription from ${newTranscription.speaker}`);
          }
          break;

        case "TRANSCRIPTION":
          // Legacy transcription format support
          const legacyTranscription: Transcription = {
            text: message.transcript,
            speaker: (message.speaker || "agent") as "agent" | "customer",
            timestamp: Date.now(),
            confidence: message.confidence || 0.9,
            isFinal: true,
          };
          useCallStore.getState().addTranscription(legacyTranscription);
          break;

        case "COACHING_TIP":
          // Add coaching tip to store
          const newTip: CoachingTip = {
            id: message.timestamp?.toString() || Date.now().toString(),
            type: (message.category || "suggestion") as CoachingTip["type"],
            message: message.tip,
            timestamp: message.timestamp || Date.now(),
            priority: (message.priority || "normal") as CoachingTip["priority"],
          };
          useCallStore.getState().addCoachingTip(newTip);
          console.log("💡 [SidePanel] Added coaching tip:", newTip.type);
          break;

        case "TIP_CHUNK":
          // Streaming: accumulate text chunks for progressive rendering
          if (message.payload) {
            useCallStore.getState().appendStreamingChunk(
              message.payload.delta || '',
              message.payload.heading,
              message.payload.stage
            );
            // Update GreetingsSelector with partial text as it streams
            const streamingState = useCallStore.getState().streamingTip;
            if (streamingState) {
              const partialOption: ScriptOption = {
                id: `streaming-tip-${Date.now()}`,
                type: 'suggestion',
                label: streamingState.heading || 'Generating...',
                script: streamingState.text,
                icon: 'zap'
              };
              useCallStore.getState().setCurrentScriptOptions([partialOption]);
            }
          }
          break;

        case "AI_TIP":
          // Final complete tip from Lambda — finalize display
          console.log("🤖 [SidePanel] AI_TIP received:", message.payload);

          if (!message.payload) {
            console.error("❌ [SidePanel] AI_TIP message missing payload");
            break;
          }

          // Clear streaming state
          useCallStore.getState().clearStreamingTip();

          const aiTip: CoachingTip = {
            id: (message.payload.timestamp)?.toString() || Date.now().toString(),
            type: "suggestion",
            message: message.payload.suggestion || '',
            timestamp: message.payload.timestamp || Date.now(),
            priority: "normal",
          };
          useCallStore.getState().addCoachingTip(aiTip);
          console.log(`💡 [SidePanel] Added AI suggestion: "${message.payload.suggestion || 'empty'}"`);

          // Update GreetingsSelector with final complete suggestion
          const scriptOption: ScriptOption = {
            id: `ai-tip-${message.payload.recommendationId || Date.now()}`,
            type: 'suggestion',
            label: message.payload.heading || 'Suggested',
            script: message.payload.suggestion || '',
            icon: 'zap'
          };
          useCallStore.getState().setCurrentScriptOptions([scriptOption]);
          console.log(`✅ [SidePanel] Updated GreetingsSelector with final suggestion: "${message.payload.heading}"`);
          break;

        case "AI_COACHING_TIP":
          // Handle AI coaching suggestions (legacy format)
          const legacyAiTip: CoachingTip = {
            id: message.tip.timestamp?.toString() || Date.now().toString(),
            type: message.tip.category || "suggestion",
            message: message.tip.tip,
            timestamp: message.tip.timestamp || Date.now(),
            priority: message.tip.priority || "normal",
          };
          useCallStore.getState().addCoachingTip(legacyAiTip);
          console.log("🤖 [SidePanel] Added AI coaching tip (legacy)");
          break;

        case "AI_BACKEND_STATUS":
          // AI Backend WebSocket status update
          console.log(`🤖 [SidePanel] AI Backend status: ${message.status}`);
          useCallStore.getState().setAIBackendStatus(message.status);
          break;

        case "AI_TIP_RECEIVED":
          // Real-time AI coaching tip from backend
          if (!message.tip) {
            console.error("❌ [SidePanel] AI_TIP_RECEIVED message missing tip");
            break;
          }
          console.log(`💡 [SidePanel] AI Tip: ${message.tip.heading || 'unknown'}`);
          useCallStore.getState().addAITip(message.tip);

          // Transform to ScriptOptions for GreetingsSelector
          if (message.tip.options && Array.isArray(message.tip.options)) {
            const scriptOptions: ScriptOption[] = message.tip.options.map((opt: any, index: number) => ({
              id: `${message.tip.recommendationId}:${index + 1}`, // Encode recommendationId and index
              type: 'suggestion',
              label: opt.label,
              script: opt.script,
              icon: 'zap'
            }));
            useCallStore.getState().setCurrentScriptOptions(scriptOptions);
          }
          break;

        case "AI_CONVERSATION_STARTED":
          // AI Backend conversation session started
          console.log(`🎯 [SidePanel] AI conversation ID: ${message.conversationId}`);
          useCallStore.getState().setAIConversationId(message.conversationId);
          break;

        case "AI_BACKEND_ERROR":
          // AI Backend error
          console.error(`❌ [SidePanel] AI Backend error: ${message.error.message}`);
          useCallStore.getState().setAIBackendStatus('error');
          break;

        case "INTELLIGENCE_UPDATE":
          // Handle conversation intelligence updates
          console.log("🧠 [SidePanel] Intelligence update received");
          if (!message.payload) {
            console.error("❌ [SidePanel] INTELLIGENCE_UPDATE message missing payload");
            break;
          }
          if (message.payload.intelligence) {
            useCallStore.getState().updateIntelligence(message.payload.intelligence);
          }
          if (message.payload.entities) {
            useCallStore.getState().updateEntities(message.payload.entities);
          }
          break;

        case "CALL_DETECTED":
          console.log("📞 [SidePanel] Call detected, waiting for user action");
          break;

        case "CLEAR_SESSION":
          console.log("🧹 [SidePanel] Clearing all data for new call");
          useCallStore.setState({
            transcriptions: [],
            coachingTips: [],
            aiTips: [],
            intelligence: null,
            entities: null,
            lastAIUpdate: null,
            aiConversationId: null,
            session: null,
            audioLevel: 0,
            currentScriptOptions: [],
            streamingTip: null,
            isGeneratingTip: false,
          });
          break;

        case "CALL_START_FAILED":
          console.error("❌ [SidePanel] Call start failed:", message.error);
          setDeepgramStatus("error");
          break;

        case "DEVELOPER_MODE_CHANGED":
          // Handle Developer Mode toggle from popup - switch environment
          if (message.enabled !== undefined) {
            const newEnv = message.enabled ? 'sandbox' : 'production';
            useCallStore.getState().setEnvironment(newEnv);
            console.log(`🔧 [SidePanel] Environment switched to ${newEnv} via Developer Mode toggle`);
          }
          break;

        default:
          console.log("⚠️ [SidePanel] Unhandled message type:", message.type);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Request current state on mount
    chrome.runtime
      .sendMessage({ type: "GET_CURRENT_STATE" })
      .then((state) => {
        if (state) {
          console.log("📊 [SidePanel] Loaded current state:", state);
          if (state.isRecording) {
            useCallStore.getState().setCallState("active");
          }
          if (state.deepgramStatus) {
            setDeepgramStatus(state.deepgramStatus);
          }
        }
      })
      .catch((error) => {
        console.log("⚠️ [SidePanel] Could not load state:", error);
      });

    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const clearSession = () => {
    useCallStore.setState({ transcriptions: [], coachingTips: [], intelligence: null, entities: null });
    chrome.runtime
      .sendMessage({ type: "CLEAR_TRANSCRIPTIONS" })
      .catch(() => {});
    console.log("🗑️ [SidePanel] Session cleared");
  };

  const handleSelectScript = (option: ScriptOption) => {
    console.log(`✅ [SidePanel] Script selected: ${option.label}`);
    
    // Copy to clipboard
    navigator.clipboard.writeText(option.script).then(() => {
      console.log("📋 [SidePanel] Script copied to clipboard");
    });

    // If this is an AI recommendation (has encoded ID), notify backend
    if (option.id && option.id.includes(':')) {
      const parts = option.id.split(':');
      if (parts.length === 2) {
        const recommendationId = parts[0];
        const selectedOption = parseInt(parts[1], 10) as 1 | 2 | 3;
        
        console.log(`📡 [SidePanel] Sending selection to backend: ${recommendationId} (Option ${selectedOption})`);
        
        chrome.runtime.sendMessage({
          type: 'OPTION_SELECTED',
          payload: {
            recommendationId,
            selectedOption
          }
        }).catch(err => {
          console.error("❌ [SidePanel] Failed to send selection:", err);
        });
      }
    }
  };



  const exportTranscriptsAsText = () => {
    if (transcriptions.length === 0) {
      alert("No transcriptions to export");
      return;
    }

    const finalTranscripts = transcriptions.filter((t) => t.isFinal);

    let textContent = `Call Transcription Export\n`;
    textContent += `Date: ${new Date().toLocaleString()}\n`;
    textContent += `Total Transcripts: ${finalTranscripts.length}\n`;
    textContent += `\n${"=".repeat(50)}\n\n`;

    finalTranscripts.forEach((t) => {
      const time = formatTime(t.timestamp);
      const speaker = t.speaker === "agent" ? "Agent" : "Customer";
      textContent += `[${time}] ${speaker}: ${t.text}\n\n`;
    });

    const blob = new Blob([textContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    console.log("📥 [SidePanel] Exported transcripts as TXT");
  };

  const exportTranscriptsAsJSON = () => {
    if (transcriptions.length === 0) {
      alert("No transcriptions to export");
      return;
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      callDuration: callState === "active" ? "ongoing" : "completed",
      totalTranscripts: transcriptions.filter((t) => t.isFinal).length,
      totalCoachingTips: coachingTips.length,
      transcripts: transcriptions
        .filter((t) => t.isFinal)
        .map((t) => ({
          timestamp: t.timestamp,
          time: formatTime(t.timestamp),
          speaker: t.speaker,
          text: t.text,
          confidence: t.confidence,
        })),
      coachingTips: coachingTips.map((tip) => ({
        id: tip.id,
        type: tip.type,
        message: tip.message,
        timestamp: tip.timestamp,
        time: formatTime(tip.timestamp),
        priority: tip.priority,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-transcript-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    console.log("📥 [SidePanel] Exported transcripts as JSON");
  };

  const getDeepgramStatusIcon = () => {
    switch (deepgramStatus) {
      case "connected":
        return <Wifi size={16} className="text-green-600" />;
      case "error":
        return <WifiOff size={16} className="text-red-600" />;
      default:
        return <WifiOff size={16} className="text-gray-400" />;
    }
  };

  const getDeepgramStatusText = () => {
    switch (deepgramStatus) {
      case "connected":
        return <span className="text-green-600 font-medium">Live</span>;
      case "error":
        return <span className="text-red-600 font-medium">Error</span>;
      default:
        return <span className="text-gray-400 font-medium">Offline</span>;
    }
  };

  // ============================================================================
  // SANDBOX MODE HANDLERS
  // ============================================================================

  // Customer: Send typed message
  const handleSendCustomerMessage = () => {
    if (!customerMessage.trim()) return;

    console.log(`📨 [Sandbox] Customer message:`, customerMessage);

    // Create transcription
    const transcription: Transcription = {
      text: customerMessage,
      speaker: 'customer',
      timestamp: Date.now(),
      confidence: 1.0,
      isFinal: true,
    };

    // Add to store
    useCallStore.getState().addTranscription(transcription);

    // Send to backend for AI suggestion
    chrome.runtime.sendMessage({
      type: 'MANUAL_TRANSCRIPT',
      payload: {
        speaker: 'caller',
        text: customerMessage,
        isFinal: true,
        timestamp: Date.now(),
      },
    }).catch(err => console.error('Failed to send manual transcript:', err));

    // Clear input
    setCustomerMessage('');
  };

  // Agent: Start PTT recording (button press)
  const handlePTTStart = useCallback(async () => {
    if (isPttButtonHeld) return; // Already recording

    if (!deepgramApiKey) {
      alert('Please configure Deepgram API key in settings');
      return;
    }

    setIsPttButtonHeld(true);
    setPttTranscript('');

    try {
      await pttDeepgramService.startRecording(deepgramApiKey);
    } catch (error: any) {
      console.error('Failed to start PTT:', error);
      setIsPttButtonHeld(false);
    }
  }, [isPttButtonHeld, deepgramApiKey]);

  // Agent: Stop PTT recording (button release)
  const handlePTTStop = useCallback(async () => {
    if (!isPttButtonHeld) return;

    setIsPttButtonHeld(false);

    try {
      const finalText = await pttDeepgramService.stopRecording();

      if (finalText.trim()) {
        console.log(`📨 [Sandbox] Agent spoke:`, finalText);

        // Create transcription
        const transcription: Transcription = {
          text: finalText,
          speaker: 'agent',
          timestamp: Date.now(),
          confidence: 1.0,
          isFinal: true,
        };

        // Add to store
        useCallStore.getState().addTranscription(transcription);

        // Send to backend
        chrome.runtime.sendMessage({
          type: 'MANUAL_TRANSCRIPT',
          payload: {
            speaker: 'agent',
            text: finalText,
            isFinal: true,
            timestamp: Date.now(),
          },
        }).catch(err => console.error('Failed to send manual transcript:', err));
      }

      setPttTranscript('');
      setPttAudioLevel(0);
    } catch (error: any) {
      console.error('Failed to stop PTT:', error);
    }
  }, [isPttButtonHeld]);

  // Initialize PTT service listeners
  useEffect(() => {
    pttDeepgramService.setStatusListener((status) => {
      setPttStatus(status);
    });

    pttDeepgramService.setTranscriptionListener((transcription) => {
      if (!transcription.isFinal) {
        // Show interim transcription as preview
        setPttTranscript(transcription.text);
      }
    });

    pttDeepgramService.setAudioLevelListener((level) => {
      setPttAudioLevel(level);
    });

    pttDeepgramService.setErrorListener((error) => {
      console.error('[PTT Error]:', error);
      alert(`PTT Error: ${error}`);
    });

    // Keyboard support: Space bar for PTT (only in sandbox mode)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (environment === 'sandbox' && e.code === 'Space' && !e.repeat) {
        // Don't activate if user is typing in a text input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        e.preventDefault();
        handlePTTStart();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (environment === 'sandbox' && e.code === 'Space') {
        e.preventDefault();
        handlePTTStop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [environment, handlePTTStart, handlePTTStop]);

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E0E4E8] bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <img src={new URL('../assets/simplebiz-logo.png', import.meta.url).href} alt="Simple.Biz" className="h-11" />
            <span className="text-sm font-semibold text-[#1B1F6B]">Call Coach</span>
            {/* Environment Badge */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
              environment === 'production'
                ? 'bg-[#1B1F6B]/10 text-[#1B1F6B] border-[#1B1F6B]/30'
                : 'bg-[#1B1F6B]/10 text-[#1B1F6B] border-[#1B1F6B]/30'
            }`}>
              {environment === 'production' ? 'PROD' : 'DEV'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {getDeepgramStatusIcon()}
            {getDeepgramStatusText()}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                callState === "active"
                  ? "bg-green-500 animate-pulse"
                  : "bg-gray-400"
              }`}
            />
            <span className="text-sm text-muted-foreground capitalize">
              {callState === "active" ? "Recording" : "Idle"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {transcriptions.length > 0 && (
              <button
                onClick={clearSession}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
              >
                <Trash2 size={14} />
                Clear
              </button>
            )}
            {transcriptions.filter((t) => t.isFinal).length > 0 && (
              <>
                <button
                  onClick={exportTranscriptsAsText}
                  className="px-2 py-1 text-xs bg-[#1B1F6B] hover:bg-[#14174f] text-white rounded transition-colors"
                  title="Export as Text"
                >
                  TXT
                </button>
                <button
                  onClick={exportTranscriptsAsJSON}
                  className="px-2 py-1 text-xs bg-[#1B1F6B] hover:bg-[#14174f] text-white rounded transition-colors"
                  title="Export as JSON"
                >
                  JSON
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* DUAL-VIEW MAIN CONTENT */}
      {environment === 'sandbox' ? (
        /* ========== SANDBOX MODE VIEW ========== */
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Sandbox Header */}
          <div className="px-4 py-3 bg-[#F5F7FA] border-b border-[#dddddd] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic size={16} className="text-[#1B1F6B]" />
              <span className="text-sm font-bold text-[#333333]">Sandbox Mode</span>
              <span className="text-xs px-2 py-0.5 bg-[#1B1F6B]/20 text-[#1B1F6B] rounded-full border border-[#1B1F6B]/30 font-semibold">
                TESTING
              </span>
            </div>
            {/* Switcher removed - Controlled by Popup Toggle */}
          </div>

          {/* Customer Input (Type) */}
          <div className="p-4 bg-[#1B1F6B]/10 border-b border-[#dddddd]">
            <div className="flex items-center gap-2 mb-2">
              <Send size={14} className="text-[#1B1F6B]" />
              <span className="text-xs font-semibold text-[#1B1F6B] uppercase tracking-wide">Customer Response (Type)</span>
            </div>
            <div className="relative mb-2">
              <textarea
                value={customerMessage}
                onChange={(e) => setCustomerMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendCustomerMessage();
                  }
                }}
                placeholder="Type what the customer says... (Enter to send, Shift+Enter for new line)"
                className="w-full px-3 py-2 text-sm bg-[#F5F7FA] border border-[#1B1F6B]/20 rounded-lg text-[#333333] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B1F6B] focus:border-transparent resize-none"
                rows={2}
              />
            </div>
            <button
              onClick={handleSendCustomerMessage}
              disabled={!customerMessage.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-[#1B1F6B] hover:bg-[#14174f] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-semibold"
            >
              <Send size={14} />
              Send Customer Message
            </button>
          </div>

          {/* Agent Input (Push-to-Talk) */}
          <div className="p-4 bg-[#1B1F6B]/10 border-b border-[#dddddd]">
            <div className="flex items-center gap-2 mb-2">
              <Mic size={14} className="text-[#1B1F6B]" />
              <span className="text-xs font-semibold text-[#1B1F6B] uppercase tracking-wide">Your Response (Speak)</span>
            </div>

            {/* PTT Button */}
            <div className="mb-2">
              <button
                onMouseDown={handlePTTStart}
                onMouseUp={handlePTTStop}
                onMouseLeave={handlePTTStop}
                onTouchStart={handlePTTStart}
                onTouchEnd={handlePTTStop}
                className={`w-full py-12 rounded-lg transition-all font-bold text-lg flex flex-col items-center justify-center gap-2 border-2 ${
                  isPttButtonHeld
                    ? 'bg-[#D0021B] border-[#D0021B] text-white shadow-lg shadow-[#D0021B]/50 animate-pulse'
                    : pttStatus === 'error'
                      ? 'bg-gray-700 border-red-500/50 text-red-400'
                      : 'bg-[#1B1F6B] border-[#1B1F6B] text-white hover:bg-[#14174f] active:scale-95'
                }`}
              >
                {isPttButtonHeld ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                      <Mic size={28} className="text-white" />
                    </div>
                    <span>🔴 RECORDING...</span>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                      <Mic size={28} />
                    </div>
                    <span>HOLD TO TALK</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Transcription Preview */}
            {isPttButtonHeld && (
              <div className="mt-3 p-3 bg-[#F5F7FA] rounded-lg border border-[#1B1F6B]/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex gap-1">
                    <div className="w-1 h-4 bg-[#1B1F6B] animate-pulse"></div>
                    <div className="w-1 h-4 bg-[#1B1F6B] animate-pulse" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-1 h-4 bg-[#1B1F6B] animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-xs text-[#1B1F6B] font-semibold">Listening...</span>
                </div>
                <p className="text-sm text-[#333333] italic min-h-[20px]">
                  {pttTranscript || 'Speak now...'}
                </p>
                {/* Audio Level */}
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-[#1B1F6B] h-2 rounded-full transition-all duration-100"
                    style={{ width: `${pttAudioLevel}%` }}
                  />
                </div>
              </div>
            )}

            {/* Instructions */}
            <p className="text-xs text-gray-500 mt-2 text-center">
              Press and hold the button, then speak naturally. Release when done.
            </p>
          </div>

          {/* Sandbox Conversation Thread */}
          {transcriptions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="flex items-center justify-center gap-3 mb-4">
                <Send size={32} className="text-[#1B1F6B]" />
                <Mic size={32} className="text-[#1B1F6B]" />
              </div>
              <h3 className="text-lg font-semibold mb-2 text-[#333333]">Hybrid Testing Mode</h3>
              <p className="text-sm text-[#757575] mb-4">
                Type customer responses, speak your agent responses
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>✓ Customer: Type messages manually</p>
                <p>✓ Agent: Speak with push-to-talk + Deepgram</p>
                <p>✓ Get real AI coaching on your speech</p>
                <p>✓ Practice naturally with controlled scenarios</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {/* Conversation Intelligence Display - hidden when expanded */}
              {!threadExpanded && (
                <div className={`px-3 pt-2 pb-1 overflow-y-auto ${threadVisible ? 'max-h-[35%] shrink-0' : 'flex-1'}`}>
                  <IntelligenceDisplay
                    intelligence={intelligence}
                    entities={entities}
                    isRecording={callState === "active"}
                  />
                </div>
              )}

              {/* Chat Thread */}
              <ChatThread
                transcriptions={transcriptions}
                callState={callState}
                isLoadingScripts={isLoadingScripts}
                onSelectScript={handleSelectScript}
                onExportText={exportTranscriptsAsText}
                onExportJSON={exportTranscriptsAsJSON}
                expanded={threadExpanded}
                collapsed={!threadVisible && !threadExpanded}
                onToggleExpand={() => { setThreadExpanded(!threadExpanded); setThreadVisible(true); }}
                onToggleCollapse={() => { setThreadVisible(!threadVisible); setThreadExpanded(false); }}
              />
            </div>
          )}
        </div>
      ) : (
        /* ========== PRODUCTION MODE VIEW ========== */
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Audio Level Indicator (Production only) */}
          {callState === "active" && (
            <div className="p-4 bg-card border-b">
              <div className="flex items-center gap-2 mb-2">
                <Mic size={16} />
                <span className="text-sm font-semibold">Audio Monitor</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {Math.round(audioLevel)}%
                </span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
            </div>
          )}

          {/* Production Conversation Thread - always visible */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Conversation Intelligence Display - hidden when thread expanded */}
            {!threadExpanded && (
              <div className={`px-3 pt-2 pb-1 overflow-y-auto ${threadVisible ? 'max-h-[35%] shrink-0' : 'flex-1'}`}>
                <IntelligenceDisplay
                  intelligence={intelligence}
                  entities={entities}
                  isRecording={callState === "active"}
                />
              </div>
            )}

            {/* Chat Thread */}
            <ChatThread
              transcriptions={transcriptions}
              callState={callState}
              isLoadingScripts={isLoadingScripts}
              onSelectScript={handleSelectScript}
              onExportText={exportTranscriptsAsText}
              onExportJSON={exportTranscriptsAsJSON}
              expanded={threadExpanded}
              collapsed={!threadVisible && !threadExpanded}
              onToggleExpand={() => { setThreadExpanded(!threadExpanded); setThreadVisible(true); }}
              onToggleCollapse={() => { setThreadVisible(!threadVisible); setThreadExpanded(false); }}
            />
          </div>
        </div>
      )}

      {/* Footer Stats */}
      {!threadExpanded && (transcriptions.length > 0 || callState === "active") && (
        <SessionStats
          transcriptions={transcriptions}
          coachingTips={coachingTips}
          session={session}
          callState={callState}
        />
      )}
    </div>
  );
}
