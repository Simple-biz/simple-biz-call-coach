/**
 * Background Service Worker - Production Demo Version
 *
 * Orchestrates all components for real-time call coaching:
 * - Call lifecycle management (CALL_STARTED/CALL_ENDED from content script)
 * - Offscreen document management (dual-stream audio capture)
 * - AWS WebSocket integration (AI coaching backend)
 * - Message routing between all components
 * - State management and persistence
 *
 * Flow:
 * 1. Content script detects call → CALL_STARTED
 * 2. Background creates offscreen document
 * 3. Background gets tab capture stream ID
 * 4. Background sends START_TAB_CAPTURE to offscreen
 * 5. Offscreen captures dual streams (caller + agent)
 * 6. Offscreen sends audio to Deepgram → TRANSCRIPTION_UPDATE
 * 7. Background forwards transcriptions to AWS WebSocket
 * 8. AWS WebSocket sends back AI_TIP
 * 9. Background broadcasts to UI (popup/sidepanel)
 */

console.log('🚀 [Background] Service worker started')

// Import AWS WebSocket service for real-time coaching
// Import AI Backend Service (Legacy Socket.io for Elastic Beanstalk fallback)
import { awsWebSocketService } from '@/services/aws-websocket.service'
import { saveTranscript, pruneOldTranscripts } from '@/utils/history-store'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TranscriptionEntry {
  transcript: string
  isFinal: boolean
  timestamp: number
  confidence: number
  speaker?: string
}

interface CoachingTip {
  tip: string
  category: 'positive' | 'warning' | 'suggestion' | 'question' | 'info'
  priority: 'normal' | 'high'
  timestamp: number
}

interface ExtensionState {
  isAuthenticated: boolean
  isRecording: boolean
  isOnCall: boolean
  deepgramStatus: 'disconnected' | 'connected' | 'error'
  aiBackendStatus: 'disconnected' | 'connecting' | 'connected' | 'ready' | 'error' | 'reconnecting'
  transcriptions: TranscriptionEntry[]
  coachingTips: CoachingTip[]
  currentStreamId: string | null
  tabId: number | null
  userEmail: string | null
  startTime: number | null
  captureMode?: 'webrtc' | 'tab'
  remoteStreamActive?: boolean
  localStreamActive?: boolean
  conversationId?: string | null
  callToolsCallId?: string | null
  callDetectionSource?: 'webhook' | 'dom' | null
  coachingPending?: boolean
  latestIntelligence?: any | null
  latestEntities?: any | null
}

// Webhook destination matching — content script reports the number being dialed
let expectedDestination: string | null = null

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let extensionState: ExtensionState = {
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
  captureMode: 'webrtc',
  remoteStreamActive: false,
  localStreamActive: false,
  conversationId: null,
  callToolsCallId: null,
  callDetectionSource: null,
}

// Restore coachingPending from storage on service worker wake-up
// (onStartup only fires on browser launch, not SW restarts after idle kill)
chrome.storage.local.get(['coachingPending', 'userEmail', 'isAuthenticated']).then((data: Record<string, any>) => {
  if (data.coachingPending) {
    extensionState.coachingPending = true
    console.log('🔄 [Background] Restored coachingPending=true from storage')
  }
  if (data.userEmail) {
    extensionState.userEmail = data.userEmail
    extensionState.isAuthenticated = data.isAuthenticated || false
    console.log('✅ [Background] Restored user session:', data.userEmail)
  }
}).catch(err => {
  console.error('❌ [Background] Failed to restore state from storage:', err)
})

// Keep-alive mechanism
let keepAliveInterval: number | null = null

// ============================================================================
// LOCAL CALL HISTORY — save transcripts to IndexedDB on CALL_ENDED
// ============================================================================

// Track call start time + destination so we can attach them to the history record on hang-up
let currentCallStartedAt: number | null = null;
let currentCallDestination: string | null = null;

async function saveCurrentCallToHistory(): Promise<void> {
  try {
    const transcripts = extensionState.transcriptions || [];
    const finalEntries = transcripts
      .filter((t: TranscriptionEntry) => t.isFinal && t.transcript)
      .map((t: TranscriptionEntry) => ({
        // offscreen emits 'agent' | 'caller' — normalize 'caller' → 'customer'
        speaker: (t.speaker === 'agent' ? 'agent' : 'customer') as 'agent' | 'customer',
        text: t.transcript,
        timestamp: t.timestamp,
      }));

    if (finalEntries.length === 0) {
      console.log('[History] No final transcripts to save — skipping');
      return;
    }

    const conversationId = extensionState.conversationId;
    if (!conversationId) {
      console.log('[History] No conversationId — skipping save');
      return;
    }

    const endedAt = Date.now();
    const startedAt = currentCallStartedAt ?? extensionState.startTime ?? endedAt;

    await saveTranscript({
      conversationId,
      agentEmail: extensionState.userEmail || 'unknown',
      startedAt,
      endedAt,
      destination: currentCallDestination ?? undefined,
      transcript: finalEntries,
      intelligence: extensionState.latestIntelligence ?? null,
      entities: extensionState.latestEntities ?? null,
    });
  } catch (err) {
    console.warn('[History] saveCurrentCallToHistory failed:', err);
  }
}

// Prune old transcripts on startup (fire-and-forget)
pruneOldTranscripts().catch(err =>
  console.warn('[History] startup prune failed:', err)
);

// ============================================================================
// AUTO-ANALYSIS LOOP — intelligence updates only (tips via streaming on click)
// ============================================================================
let autoAnalysisInterval: any = null;
let autoAnalysisInFlight = false;
let lastTranscriptCount = 0;
const AUTO_ANALYSIS_INTERVAL_MS = 30000;

function startAutoAnalysisLoop() {
  if (autoAnalysisInterval) clearInterval(autoAnalysisInterval);
  console.log('🔄 [Background] Starting 30-second auto-analysis loop (intelligence only)');
  lastTranscriptCount = extensionState.transcriptions?.length || 0;
  autoAnalysisInFlight = false;

  // Fire first analysis only if we have transcripts
  if (awsWebSocketService.isConnected() && extensionState.isRecording && extensionState.conversationId) {
    const currentCount = extensionState.transcriptions?.length || 0;
    if (currentCount > 0) {
      console.log('⚡ [Background] Running immediate first auto-analysis to warm cache');
      awsWebSocketService.getIntelligence(extensionState.conversationId, true);
    }
  }

  autoAnalysisInterval = setInterval(() => {
    if (!awsWebSocketService.isConnected() || !extensionState.isRecording) return;
    if (!extensionState.conversationId) return;
    if (autoAnalysisInFlight) return; // Skip if previous request still pending

    // Skip if no new transcripts since last analysis
    const currentCount = extensionState.transcriptions?.length || 0;
    if (currentCount <= lastTranscriptCount) return;
    lastTranscriptCount = currentCount;

    autoAnalysisInFlight = true;
    awsWebSocketService.getIntelligence(extensionState.conversationId, true)
      .finally(() => { autoAnalysisInFlight = false; });
  }, AUTO_ANALYSIS_INTERVAL_MS);
}

function stopAutoAnalysisLoop() {
  if (autoAnalysisInterval) {
    clearInterval(autoAnalysisInterval);
    autoAnalysisInterval = null;
    console.log('🛑 [Background] Stopped auto-analysis loop');
  }
}

// ============================================================================
// CAPTURE START HELPER
// ============================================================================

async function startCaptureAndCoaching(captureTabId: number) {
  console.log('🎙️ [Background] Starting capture and coaching for tab', captureTabId)
  startKeepAlive()

  await updateExtensionState({
    isRecording: true,
    tabId: captureTabId,
    coachingPending: false,
  })

  try {
    await ensureOffscreenDocument()

    const settings = await chrome.storage.local.get('deepgramApiKey')
    const deepgramApiKey = settings.deepgramApiKey || import.meta.env.VITE_DEEPGRAM_API_KEY
    if (!deepgramApiKey) {
      throw new Error('No Deepgram API key configured. Please add your API key in settings.')
    }

    console.log('🔑 [Background] Deepgram API key found')

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: captureTabId,
    })
    console.log('✅ [Background] Stream ID obtained:', streamId)

    await chrome.runtime.sendMessage({
      type: 'START_TAB_CAPTURE',
      streamId: streamId,
      deepgramApiKey: deepgramApiKey,
    })
    console.log('✅ [Background] Tab capture started')

    await connectAIBackend()

    broadcastToUI({
      type: 'CAPTURE_STARTED',
      timestamp: Date.now(),
    })
  } catch (error: any) {
    console.error('❌ [Background] Failed to start coaching:', error)
    await updateExtensionState({
      isRecording: false,
      coachingPending: false,
    })
    broadcastToUI({
      type: 'CALL_START_FAILED',
      error: error.message || 'Failed to start coaching',
    })
  }
}

// ============================================================================
// PORT-BASED CONNECTIONS FROM CONTENT SCRIPTS
// ============================================================================

const connectedPorts: Map<number, chrome.runtime.Port> = new Map()

chrome.runtime.onConnect.addListener(port => {
  console.log(`🔌 [Background] Port connected: ${port.name}`)

  if (port.name === 'calltools-content') {
    const tabId = port.sender?.tab?.id
    if (tabId) {
      connectedPorts.set(tabId, port)
      console.log(`✅ [Background] Content script connected (Tab: ${tabId})`)
    }

    port.onMessage.addListener(async message => {
      console.log(`📨 [Background] Port message: ${message.type}`)

      // Handle messages same as runtime.onMessage
      if (message.type === 'CALL_STARTED') {
        console.log('📞 [Background] Call STARTED detected (via port)')

        // Track call start time + clear previous call's history fields
        currentCallStartedAt = Date.now()
        currentCallDestination = message.destination || null
        extensionState.latestIntelligence = null
        extensionState.latestEntities = null
        if (currentCallDestination) {
          console.log(`📱 [Background] Destination captured from CALL_STARTED: ${currentCallDestination}`)
        }

        // ✅ CLEAR ALL PREVIOUS CALL DATA (fresh start for new call)
        console.log('🧹 [Background] Clearing ALL data from previous call')
        extensionState.transcriptions = []
        extensionState.coachingTips = []
        await chrome.storage.local.set({
          'callStoreState': JSON.stringify({
            transcriptions: [],
            coachingTips: [],
            audioLevel: 0,
            aiTips: [],
            intelligence: null,
            entities: null,
            lastAIUpdate: null,
            aiConversationId: null,
            session: null,
            currentScriptOptions: [],
          })
        })
        broadcastToUI({ type: 'CLEAR_SESSION', timestamp: Date.now() })

        await updateExtensionState({
          isOnCall: true,
          tabId: tabId,
          conversationId: null,
        })
        broadcastToUI({ type: 'CALL_STARTED', tabId })
        console.log(`✅ [Background] Call state updated (Tab: ${tabId})`)

        // Auto-start capture if coaching was armed before the call
        // Fallback: check storage in case SW restarted and module-level restore hasn't completed
        let shouldStartCoaching = extensionState.coachingPending
        if (!shouldStartCoaching && tabId) {
          const stored = await chrome.storage.local.get('coachingPending')
          shouldStartCoaching = stored.coachingPending === true
          if (shouldStartCoaching) {
            extensionState.coachingPending = true
            console.log('🔄 [Background] Restored coachingPending from storage (fallback)')
          }
        }
        if (shouldStartCoaching && tabId) {
          console.log('🎙️ [Background] Coaching was pending — auto-starting capture')
          await startCaptureAndCoaching(tabId)
        }
      }

      if (message.type === 'CALL_ENDED') {
        console.log('📞 [Background] Call ENDED detected (via port)')

        // Save transcript to local history (fire-and-forget)
        saveCurrentCallToHistory()

        await updateExtensionState({ isOnCall: false })
        await handleCallEnd(tabId)
        stopAutoAnalysisLoop();
        stopKeepAlive()
        currentCallStartedAt = null
      }

      if (message.type === 'DESTINATION_NUMBER_DETECTED') {
        const digits = message.destination?.replace(/\D/g, '') || ''
        if (digits.length >= 10) {
          expectedDestination = digits
          currentCallDestination = message.destination || digits
          console.log(`📱 [Background] Expected destination set: ${digits}`)
        }
      }
    })

    port.onDisconnect.addListener(() => {
      console.log(`🔌 [Background] Port disconnected (Tab: ${tabId})`)
      if (tabId) {
        connectedPorts.delete(tabId)
      }
    })
  }
})

// Helper to broadcast messages to all UI components
function broadcastToUI(message: object): void {
  chrome.runtime.sendMessage(message).catch((err) => {
    // Log for debugging — UI might not be open, that's usually okay
    console.warn(`⚠️ [Background] broadcastToUI failed for ${(message as any).type}:`, err?.message || err)
  })
}

// Helper to send message to content script on the active CallTools tab
function notifyContentScript(message: object): void {
  if (extensionState.tabId) {
    chrome.tabs.sendMessage(extensionState.tabId, message).catch(() => {
      // Content script might not be ready
    })
  }
}

// Helper to send message to content script via port or tabs.sendMessage
function sendToContentScript(tabId: number, message: object): void {
  const port = connectedPorts.get(tabId)
  if (port) {
    try {
      port.postMessage(message)
      return
    } catch (error) {
      console.warn('⚠️ [Background] Port send failed, using tabs.sendMessage')
      connectedPorts.delete(tabId)
    }
  }
  chrome.tabs.sendMessage(tabId, message).catch(() => {})
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function startKeepAlive() {
  if (keepAliveInterval) return
  console.log('🔄 [Background] Keep-alive started')
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo().then(() => {})
  }, 20000) as unknown as number
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    console.log('🛑 [Background] Keep-alive stopped')
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
}

// ✅ ROBUST STATE UPDATE with error handling and retry
async function updateExtensionState(
  updates: Partial<ExtensionState>,
  retries = 3
): Promise<void> {
  try {
    // Update in-memory state
    extensionState = { ...extensionState, ...updates }

    // Prepare storage data with consistent keys
    const storageData = {
      // NEW: Single source of truth
      callState: extensionState.isOnCall ? 'active' : 'inactive',
      isOnCall: extensionState.isOnCall,
      isRecording: extensionState.isRecording,
      coachingPending: extensionState.coachingPending || false,

      // Legacy support
      callStoreState: {
        session: extensionState.userEmail,
        callState: extensionState.isOnCall ? 'active' : 'inactive',
        audioState: extensionState.isRecording ? 'capturing' : 'idle',
        deepgramStatus: extensionState.deepgramStatus,
        aiBackendStatus: extensionState.aiBackendStatus,
        transcriptions: extensionState.transcriptions,
        coachingTips: extensionState.coachingTips,
        tabId: extensionState.tabId,
        startTime: extensionState.startTime,
        conversationId: extensionState.conversationId,
      },
    }

    // Save to storage with retry logic
    await chrome.storage.local.set(storageData)

    // Update badge
    if (extensionState.isRecording) {
      await chrome.action.setBadgeText({ text: '●' })
      await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
    } else if (extensionState.isOnCall) {
      await chrome.action.setBadgeText({ text: '📞' })
      await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' })
    } else {
      await chrome.action.setBadgeText({ text: '' })
    }

    // Broadcast to ALL listeners (popup, sidepanel, content script)
    const message = {
      type: 'STATE_UPDATE',
      payload: {
        ...extensionState,
        timestamp: Date.now(),
      },
    }

    // Broadcast to runtime (popup/sidepanel)
    broadcastToUI(message)

    // Notify content script if tab exists (use port if available)
    if (extensionState.tabId) {
      sendToContentScript(extensionState.tabId, {
        type: 'EXTENSION_STATE_CHANGED',
        state: extensionState.isRecording ? 'active' : 'inactive',
        isOnCall: extensionState.isOnCall,
        deepgramStatus: extensionState.deepgramStatus,
        timestamp: Date.now(),
      })
    }

    console.log('✅ [Background] State updated:', updates)
  } catch (error: any) {
    console.error('❌ [Background] State update failed:', error)
    if (retries > 0) {
      console.log(`🔄 [Background] Retrying state update (${retries} left)`)
      await new Promise(resolve => setTimeout(resolve, 500))
      return updateExtensionState(updates, retries - 1)
    }
    throw error
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

chrome.runtime.onInstalled.addListener(async details => {
  console.log('📦 [Background] Extension installed/updated')

  if (details.reason === 'install' || details.reason === 'update') {
    await chrome.storage.local.set({
      callState: 'inactive',
      isOnCall: false,
      isRecording: false,
      developerModeEnabled: false, // Default to Production Mode
      callStoreState: {
        session: null,
        callState: 'inactive',
        audioState: 'idle',
        deepgramStatus: 'disconnected',
        transcriptions: [],
        coachingTips: [],
        tabId: null,
        startTime: null,
      },
    })
    console.log('✅ [Background] Extension state initialized')
  }
})

chrome.runtime.onStartup.addListener(() => {
  console.log('🔄 [Background] Startup - initializing')
  // Only start keep-alive if there's an active call (restored from storage)
  if (extensionState.isOnCall || extensionState.isRecording) {
    startKeepAlive()
  }
  // State restoration is handled at module level (runs on every SW wake-up)
})

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.userEmail) {
      console.log('⚙️ [Background] User email changed:', changes.userEmail.newValue)
      extensionState.userEmail = changes.userEmail.newValue as string | null
      extensionState.isAuthenticated = !!changes.userEmail.newValue
    }
  }
})

// ============================================================================
// MESSAGE HANDLER - ROBUST VERSION
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`📨 [Background] Received: ${message.type}`, {
    from: sender.tab ? `tab:${sender.tab.id}` : 'extension',
  })

  // Wrap in error boundary
  processMessage(message, sender)
    .then(result => {
      // Skip response for messages handled by offscreen
      if (result === '__SKIP_RESPONSE__') return
      sendResponse({ success: true, result })
    })
    .catch(error => {
      console.error(`❌ [Background] Handler error (${message.type}):`, error)

      // Broadcast error to UI
      broadcastToUI({
        type: 'ERROR',
        error: error.message || 'Unknown error occurred',
        context: message.type,
        timestamp: Date.now(),
      })

      sendResponse({ success: false, error: error.message })
    })

  return true // Keep message channel open for async response
})

async function processMessage(message: any, sender: any) {
  switch (message.type) {
    // ========================================================================
    // CALL LIFECYCLE EVENTS - FIXED
    // ========================================================================

    case 'CALL_STARTED':
      console.log('📞 [Background] Call STARTED detected - clearing previous call data for fresh start')
      const callTabId = sender.tab?.id

      if (!callTabId) {
        console.warn('⚠️ [Background] No tab ID from call start')
        return
      }

      // Track call start time + clear previous call's history fields
      currentCallStartedAt = Date.now()
      currentCallDestination = message.destination || null
      extensionState.latestIntelligence = null
      extensionState.latestEntities = null
      if (currentCallDestination) {
        console.log(`📱 [Background] Destination captured from CALL_STARTED: ${currentCallDestination}`)
      }

      // ✅ CLEAR ALL PREVIOUS CALL DATA (fresh start for new call)
      console.log('🧹 [Background] Clearing ALL data from previous call')
      extensionState.transcriptions = []
      extensionState.coachingTips = []
      await chrome.storage.local.set({
        'callStoreState': JSON.stringify({
          transcriptions: [],
          coachingTips: [],
          audioLevel: 0,
          aiTips: [],
          intelligence: null,
          entities: null,
          lastAIUpdate: null,
          aiConversationId: null,
          callStartTime: null,
          callEndTime: null,
          session: null,
          currentScriptOptions: [],
        })
      })
      broadcastToUI({ type: 'CLEAR_SESSION', timestamp: Date.now() })

      // ✅ UPDATE STATE IMMEDIATELY
      // Skip DOM detection if webhook already detected this call
      if (extensionState.callDetectionSource === 'webhook' && extensionState.isOnCall) {
        console.log('ℹ️ [Background] Call already detected via webhook, ignoring DOM detection')
        return
      }

      await updateExtensionState({
        isOnCall: true,
        tabId: callTabId,
        startTime: Date.now(),
        conversationId: null, // Reset conversation ID for new call
        callDetectionSource: 'dom',
      })

      // Start keep-alive during call
      startKeepAlive()

      // Notify UI components to clear and prepare for new call
      broadcastToUI({
        type: 'CALL_DETECTED',
        tabId: callTabId,
        timestamp: Date.now(),
        clearPreviousData: true, // Signal UI to clear display
      })

      console.log(`✅ [Background] New call initialized with clean state (Tab: ${callTabId})`)

      // Auto-start capture if coaching was armed before the call
      // Fallback: check storage in case SW restarted and module-level restore hasn't completed
      let shouldStartCoachingMsg = extensionState.coachingPending
      if (!shouldStartCoachingMsg && callTabId) {
        const stored = await chrome.storage.local.get('coachingPending')
        shouldStartCoachingMsg = stored.coachingPending === true
        if (shouldStartCoachingMsg) {
          extensionState.coachingPending = true
          console.log('🔄 [Background] Restored coachingPending from storage (fallback)')
        }
      }
      if (shouldStartCoachingMsg && callTabId) {
        console.log('🎙️ [Background] Coaching was pending — auto-starting capture')
        await startCaptureAndCoaching(callTabId)
      }
      break

    case 'CALL_ENDED':
      console.log('📞 [Background] Call ENDED detected - retaining call data for review')

      // Save transcript to local history (fire-and-forget)
      saveCurrentCallToHistory()

      // ✅ UPDATE STATE FIRST
      await updateExtensionState({
        isOnCall: false,
      })

      // Then handle cleanup (but DON'T clear transcriptions/tips - keep for review)
      await handleCallEnd(sender.tab?.id)
      stopKeepAlive()
      currentCallStartedAt = null

      // Notify UI that call ended (but data should remain visible)
      broadcastToUI({
        type: 'CALL_ENDED_RETAIN_DATA',
        timestamp: Date.now(),
      })

      console.log('✅ [Background] Call ended - data retained for agent review')
      break

    case 'WEBRTC_STREAMS_READY':
      console.log('📞 [Background] WebRTC streams ready (legacy event)')
      await updateExtensionState({
        remoteStreamActive: true,
        localStreamActive: true
      })

      // Notify UI that streams are ready
      broadcastToUI({
        type: 'WEBRTC_STREAMS_READY',
        timestamp: Date.now(),
      })
      break

    case 'START_COACHING_FROM_POPUP':
      console.log('📞 [Background] Coaching start requested from popup')

      // Get tab ID
      const tabId = message.tabId
      if (!tabId) {
        console.error('❌ [Background] No tab ID available')
        broadcastToUI({
          type: 'ERROR',
          error: 'No tab ID provided. Please refresh the CallTools page and try again.',
        })
        break
      }

      // If no active call, arm coaching to auto-start when call is detected
      if (!extensionState.isOnCall) {
        console.log('⏳ [Background] No active call — coaching armed, will start on call detection')
        await updateExtensionState({
          coachingPending: true,
          tabId: tabId,
          isRecording: true,
        })
        broadcastToUI({
          type: 'COACHING_PENDING',
          timestamp: Date.now(),
        })
        break
      }

      // Call is active — start capture immediately
      await startCaptureAndCoaching(tabId)
      break

    // ========================================================================
    // AUDIO CAPTURE EVENTS FROM OFFSCREEN
    // ========================================================================

    case 'CAPTURE_STARTED':
      console.log('✅ [Background] Offscreen confirmed capture started')
      await updateExtensionState({
        isRecording: true,
        isOnCall: true,
      })

      // AWS WebSocket connection is now handled in START_COACHING_FROM_POPUP
      // This handler is kept for compatibility with offscreen document
      break

    case 'CAPTURE_STOPPED':
      console.log('✅ [Background] Offscreen confirmed capture stopped')
      await updateExtensionState({
        isRecording: false,
        deepgramStatus: 'disconnected',
        aiBackendStatus: 'disconnected',
      })

      // Disconnect AI Backend
      await disconnectAIBackend()
      break

    case 'CAPTURE_ERROR':
      console.error('❌ [Background] Capture error:', message.error)
      await handleCallEnd(extensionState.tabId || undefined)
      broadcastToUI({
        type: 'CALL_START_FAILED',
        error: message.error,
      })
      break

    // ========================================================================
    // DEEPGRAM EVENTS
    // ========================================================================

    case 'DEEPGRAM_STATUS':
      const dgSpeaker = message.speaker || 'mono'
      console.log(`🔌 [Background] Deepgram ${dgSpeaker}: ${message.status}`)

      // Update state with connection status
      await updateExtensionState({
        deepgramStatus: message.status,
      })

      // Broadcast to UI
      broadcastToUI({
        type: 'DEEPGRAM_STATUS',
        status: message.status,
        speaker: dgSpeaker,
      })
      break

    case 'TRANSCRIPTION_UPDATE':
      if (!message.transcript) {
        console.warn('⚠️ [Background] TRANSCRIPTION_UPDATE missing transcript, skipping');
        break;
      }

      const speaker = message.speaker || 'unknown'
      console.log(
        `📝 [Background] Transcription from ${speaker.toUpperCase()} (${
          message.isFinal ? 'FINAL' : 'INTERIM'
        }): ${message.transcript}`
      )

      const transcriptionEntry: TranscriptionEntry = {
        transcript: message.transcript,
        isFinal: message.isFinal || false,
        timestamp: message.timestamp || Date.now(),
        confidence: message.confidence || 0,
        speaker: message.speaker || 'unknown',
      }

      // Find last entry from same speaker to handle interim dedup
      let lastSameSpeakerIdx = -1
      for (let i = extensionState.transcriptions.length - 1; i >= 0; i--) {
        if (extensionState.transcriptions[i].speaker === transcriptionEntry.speaker) {
          lastSameSpeakerIdx = i
          break
        }
      }

      if (lastSameSpeakerIdx >= 0 && !extensionState.transcriptions[lastSameSpeakerIdx].isFinal) {
        // Last entry from this speaker was interim — replace it
        extensionState.transcriptions[lastSameSpeakerIdx] = transcriptionEntry
      } else {
        // No interim to replace — append new entry
        extensionState.transcriptions.push(transcriptionEntry)
      }

      // Sort by timestamp to maintain correct order (dual streams may arrive out of order)
      extensionState.transcriptions.sort((a, b) => a.timestamp - b.timestamp)

      // Keep last 100 transcriptions (increased from 50 for dual streams)
      if (extensionState.transcriptions.length > 100) {
        extensionState.transcriptions = extensionState.transcriptions.slice(-100)
      }

      await updateExtensionState({
        transcriptions: extensionState.transcriptions,
      })

      // Broadcast transcription to UI (sidepanel, popup)
      broadcastToUI({
        type: 'TRANSCRIPTION_UPDATE',
        transcript: message.transcript,
        speaker: message.speaker,
        timestamp: message.timestamp,
        confidence: message.confidence || 0,
        isFinal: message.isFinal,
      })

      // Forward FINAL transcripts to AI Backend for analysis
      if (message.isFinal && awsWebSocketService.isConnected()) {
        try {
          awsWebSocketService.sendTranscript(
            message.speaker === 'caller' ? 'caller' : 'agent',
            message.transcript,
            message.isFinal
          )
          console.log(`🤖 [Background] Forwarded ${message.speaker} transcript to AI Backend`)
        } catch (error) {
          console.error('❌ [Background] Error forwarding transcript to Backend:', error)
        }
      }
      break

    // ========================================================================
    // STATE QUERIES - ENHANCED
    // ========================================================================

    case 'GET_CURRENT_STATE':
      console.log('🔍 [Background] State query')
      return {
        ...extensionState,
        timestamp: Date.now(),
      }

    case 'PING':
      return {
        alive: true,
        state: extensionState,
        timestamp: Date.now(),
      }

    // ========================================================================
    // AUDIO LEVEL
    // ========================================================================

    case 'AUDIO_LEVEL_UPDATE':
      // Forward audio level updates to UI
      broadcastToUI({
        type: 'AUDIO_LEVEL',
        level: message.level,
        source: message.source, // 'agent' or 'caller'
      })
      break

    // ========================================================================
    // MANUAL TRANSCRIPT (PTT Sandbox Mode)
    // ========================================================================

    case 'MANUAL_TRANSCRIPT':
      if (!message.payload || !message.payload.text) {
        console.warn('⚠️ [Background] MANUAL_TRANSCRIPT missing payload or text, skipping');
        break;
      }

      console.log('📝 [Background] Manual transcript from sandbox mode:', message.payload)

      // Forward to AI Backend if connected
      if (awsWebSocketService.isConnected()) {
        try {
          await awsWebSocketService.sendTranscript(
            message.payload.speaker || 'agent',
            message.payload.text,
            message.payload.isFinal || false
          )
          console.log('✅ [Background] Manual transcript forwarded to AI Backend')
        } catch (error) {
          console.error('❌ [Background] Failed to forward manual transcript:', error)
        }
      } else {
        console.warn('⚠️ [Background] AI Backend not connected, cannot forward manual transcript')
      }
      break

    // ========================================================================
    // AI BACKEND AI TIPS
    // ========================================================================

    case 'AI_TIP':
      if (!message.tip) {
        console.warn('⚠️ [Background] AI_TIP missing tip data, skipping');
        break;
      }

      console.log('💡 [Background] AI Tip received from AI Backend')
      // Broadcast to UI components
      broadcastToUI({
        type: 'AI_TIP',
        tip: message.tip,
        timestamp: Date.now(),
      })
      break

    // ========================================================================
    // AI ACTIONS FROM UI
    // ========================================================================

      // Legacy handler - suppressed warning for demo
      case 'REQUEST_NEXT_TIP':
        console.log('🔄 [Background] Request next tip (streaming)', {
          wsConnected: awsWebSocketService.isConnected(),
          conversationId: extensionState.conversationId,
        });

        if (!awsWebSocketService.isConnected()) {
          console.error('❌ [Background] Cannot request tip - WebSocket not connected');
          return { success: false, error: 'WebSocket not connected' };
        }

        if (!extensionState.conversationId) {
          console.error('❌ [Background] Cannot request tip - No active conversation');
          return { success: false, error: 'No active conversation' };
        }

        // Request tip from Lambda — response streams back via TIP_CHUNK messages
        // Pass client transcripts + current intelligence snapshot to keep click-path fast
        try {
          console.log('🌊 [Background] Requesting streaming tip from Lambda (FAST PATH)...');
          await awsWebSocketService.getIntelligence(
            extensionState.conversationId,
            false,
            message.payload?.transcripts,
            true,
            message.payload?.clientIntelligence
          );
          return { success: true, message: 'Streaming tip...' };
        } catch (error: any) {
          console.error('❌ [Background] Failed to request intelligence:', error);
          return { success: false, error: error.message };
        }

    case 'OPTION_SELECTED':
      if (!message.payload || !message.payload.recommendationId || !message.payload.selectedOption) {
        console.warn('⚠️ [Background] OPTION_SELECTED missing payload data, skipping');
        return { success: false, error: 'Invalid payload' };
      }

      console.log('👆 [Background] Option selected:', message.payload)
      if (awsWebSocketService.isConnected()) {
        try {
          const { recommendationId, selectedOption } = message.payload
          await awsWebSocketService.selectOption(recommendationId, selectedOption)
          return { success: true }
        } catch (error: any) {
          console.error('❌ [Background] Failed to send option selection:', error)
          return { success: false, error: error.message }
        }
      }
      break

    // ========================================================================
    // DEVELOPER MODE TOGGLE
    // ========================================================================

    case 'DEVELOPER_MODE_CHANGED':
      console.log(`🔧 [Background] Developer Mode changed: ${message.enabled ? 'ENABLED' : 'DISABLED'}`)
      
      // Store the setting
      await chrome.storage.local.set({ developerModeEnabled: message.enabled })
      
      // Broadcast to all UI components (sidepanel will switch to sandbox mode)
      broadcastToUI({
        type: 'DEVELOPER_MODE_CHANGED',
        enabled: message.enabled,
        timestamp: Date.now(),
      })
      break

    case 'ENSURE_OFFSCREEN':
      console.log('📄 [Background] Ensuring offscreen document for PTT...')
      try {
        await ensureOffscreenDocument()
        return { success: true }
      } catch (error: any) {
        throw new Error(error.message)
      }

    case 'START_PTT_CAPTURE':
    case 'STOP_PTT_CAPTURE':
      // Handled by offscreen document listener — don't respond from background
      console.log(`🎤 [Background] ${message.type} — handled by offscreen`)
      return '__SKIP_RESPONSE__'

    // ========================================================================
    // OFFSCREEN PTT & LOGGING EVENTS
    // ========================================================================

    case 'LOG_FORWARD':
      // Simply log the message from offscreen to the background console
      console.log(message.message)
      break

    case 'PTT_TRANSCRIPTION':
      // Handle PTT transcription (Sandbox Mode)
      if (!message.transcript) {
        console.warn('⚠️ [Background] PTT_TRANSCRIPTION missing transcript, skipping');
        break;
      }

      const pttTranscript = message.transcript
      const pttIsFinal = message.isFinal || false

      console.log(`🎤 [Background] PTT Transcription: ${pttTranscript} (Final: ${pttIsFinal})`)
      
      const pttEntry: TranscriptionEntry = {
        transcript: pttTranscript,
        isFinal: pttIsFinal,
        timestamp: Date.now(),
        confidence: 1.0,
        speaker: 'agent' // PTT is always the agent
      }
      
      extensionState.transcriptions.push(pttEntry)
      
      // Keep last 100
      if (extensionState.transcriptions.length > 100) {
        extensionState.transcriptions = extensionState.transcriptions.slice(-100)
      }
      
      // Broadbast as standard update to UI
      broadcastToUI({
        type: 'TRANSCRIPTION_UPDATE',
        transcript: pttTranscript,
        speaker: 'agent',
        timestamp: Date.now(),
        confidence: 1.0,
        isFinal: pttIsFinal
      })
      
      // Forward to AI Backend context if needed (though Sandbox usually means local testing)
      if (pttIsFinal && awsWebSocketService.isConnected()) {
          awsWebSocketService.sendTranscript('agent', pttTranscript, pttIsFinal)
          // awsWebSocketService.sendTranscript is void, so no catch block here
      }
      break

    default:
      console.warn('⚠️ [Background] Unknown message:', message.type)
  }
}

// ============================================================================
// AI BACKEND MANAGEMENT
// ============================================================================

async function connectAIBackend() {
  console.log('🔄 [Background] Connecting to AI Backend...')

  try {
    // Initialize service first
    // AWS Service initializes on import and uses config/aws.ts
    /*
    await awsWebSocketService.initialize({
      url: import.meta.env.VITE_BACKEND_WS_URL || 'http://localhost:3000',
      apiKey: import.meta.env.VITE_BACKEND_API_KEY || 'devassist-local-key',
      autoReconnect: true,
      reconnectAttempts: 5
    })
    */

    // Set up listeners
    awsWebSocketService.setStatusListener(async (status) => {
      console.log(`🔌 [Background] AI Backend Status: ${status}`)
      await updateExtensionState({ aiBackendStatus: status })
      broadcastToUI({
        type: 'AI_BACKEND_STATUS',
        status
      })
    })

    // TIP_CHUNK: Forward streaming chunks to UI for progressive rendering
    awsWebSocketService.setTipChunkListener((delta, heading, stage) => {
      console.log(`🌊 [Background] Tip chunk: "${delta.substring(0, 20)}..."`);
      broadcastToUI({
        type: 'TIP_CHUNK',
        payload: { delta, heading, stage }
      });
    })

    // AI_TIP: Final complete tip — broadcast to UI to finalize display
    awsWebSocketService.setAITipListener((tip) => {
      const suggestion = tip.options && tip.options.length > 0
        ? tip.options[0].script
        : '';

      const tipPayload = {
        heading: tip.heading,
        stage: tip.stage,
        context: tip.context,
        suggestion: suggestion,
        recommendationId: tip.recommendationId,
        timestamp: tip.timestamp
      };

      console.log('💡 [Background] AI Tip received — broadcasting final tip');
      broadcastToUI({ type: 'AI_TIP', payload: tipPayload });
    })

    awsWebSocketService.setIntelligenceListener((payload) => {
      console.log('🧠 [Background] Intelligence update received')
      // Stash latest snapshot so we can attach it to the call history record on hang-up
      if (payload) {
        extensionState.latestIntelligence = (payload as any).intelligence ?? null
        extensionState.latestEntities = (payload as any).entities ?? null
      }
      broadcastToUI({
        type: 'INTELLIGENCE_UPDATE',
        payload,
        timestamp: Date.now(),
      })
    })

    awsWebSocketService.setErrorListener((error) => {
      console.error('❌ [Background] AI Backend Error:', error)
      broadcastToUI({
        type: 'AI_ERROR',
        error
      })
    })

    // Webhook STATUS_UPDATE listener (call start/end from CallTools resthook)
    awsWebSocketService.setStatusUpdateListener(async (payload) => {
      // Capture destination for history whenever we see it
      if (payload.destination) {
        currentCallDestination = payload.destination
      }

      if (payload.event === 'CALL_STARTED') {
        // Already on a call — enrich with callId if within 15s
        if (extensionState.isOnCall) {
          if (Date.now() - (extensionState.startTime || 0) < 15000) {
            updateExtensionState({
              callToolsCallId: payload.callId,
              callDetectionSource: 'webhook',
            })
          }
          return
        }

        // DESTINATION MATCHING: If we know the number being dialed,
        // match it against the webhook destination for instant detection
        if (expectedDestination && payload.destination && extensionState.coachingPending) {
          const webhookDigits = (payload.destination || '').replace(/\D/g, '')
          // Match last 10 digits (ignore country code differences)
          const expectedLast10 = expectedDestination.slice(-10)
          const webhookLast10 = webhookDigits.slice(-10)

          if (expectedLast10 === webhookLast10 && expectedLast10.length >= 10) {
            console.log(`🎯 [Background] Webhook MATCHED destination ${webhookLast10} — instant call detection!`)

            updateExtensionState({
              isOnCall: true,
              startTime: Date.now(),
              callToolsCallId: payload.callId,
              callDetectionSource: 'webhook',
              conversationId: null,
            })

            startKeepAlive()
            expectedDestination = null // Clear after match

            broadcastToUI({
              type: 'CALL_DETECTED',
              tabId: extensionState.tabId,
              timestamp: Date.now(),
              clearPreviousData: true,
              source: 'webhook',
              callToolsCallId: payload.callId,
            })

            notifyContentScript({ type: 'WEBHOOK_CALL_STARTED', payload })

            if (extensionState.tabId) {
              console.log('🎙️ [Background] Webhook match — auto-starting capture')
              await startCaptureAndCoaching(extensionState.tabId)
            }
            return
          }
        }

        // No match — ignore (it's another agent's call)
        return
      }

      if (payload.event === 'CALL_ENDED') {
        if (!extensionState.isOnCall) {
          console.log('ℹ️ [Background] Not on a call, ignoring webhook CALL_ENDED')
          return
        }

        console.log('📞 [Background] Webhook detected CALL_ENDED — ending call')

        // Save transcript to local history (fire-and-forget)
        saveCurrentCallToHistory()

        updateExtensionState({
          isOnCall: false,
          callDetectionSource: null,
          callToolsCallId: null,
        })

        handleCallEnd(extensionState.tabId || undefined)
        stopKeepAlive()
        currentCallStartedAt = null

        broadcastToUI({
          type: 'CALL_ENDED_RETAIN_DATA',
          timestamp: Date.now(),
          source: 'webhook',
        })

        notifyContentScript({ type: 'WEBHOOK_CALL_ENDED', payload })
      }
    })

    // Connect
    await awsWebSocketService.connect()

    // Start conversation session
    const userEmail = extensionState.userEmail || `agent-${Date.now()}`
    console.log(`👤 [Background] Starting conversation for agent: ${userEmail}`)

    const conversationId = await awsWebSocketService.startConversation(
      userEmail,
      {
        source: 'devassist-call-coach',
        tabId: extensionState.tabId,
        version: '2.2.9',
      }
    )

    if (conversationId) {
      console.log(`✅ [Background] AI conversation started: ${conversationId}`)

      // Start auto-analysis loop for real-time intelligence updates
      startAutoAnalysisLoop()

      await updateExtensionState({
        conversationId: conversationId,
      })

      broadcastToUI({
        type: 'AI_CONVERSATION_STARTED',
        conversationId
      })
    }
  } catch (error: any) {
    console.error('❌ [Background] Failed to connect to AI Backend:', error)

    await updateExtensionState({
      aiBackendStatus: 'error',
    })

    throw error
  }
}

async function disconnectAIBackend() {
  console.log('🛑 [Background] Disconnecting AI Backend...')

  try {
    if (awsWebSocketService.hasActiveConversation()) {
      await awsWebSocketService.endConversation()
    }

    if (awsWebSocketService.isConnected()) {
      console.log('🔌 [Background] Closing WebSocket connection...')
      awsWebSocketService.disconnect()
    }

    await updateExtensionState({
      aiBackendStatus: 'disconnected',
      conversationId: null,
    })

    console.log('✅ [Background] AI Backend disconnected')
  } catch (error: any) {
    console.error('❌ [Background] Error disconnecting AI Backend:', error)
  }
}

// ============================================================================
// CALL END HANDLER
// ============================================================================

async function handleCallEnd(tabId?: number) {
  console.log(`🛑 [Background] Handling call end (Tab: ${tabId})`)

  try {
    // 1. Stop capture in offscreen document
    console.log('📤 [Background] Sending STOP_CAPTURE to offscreen...')
    await chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
    }).catch(() => {
      console.warn('⚠️ [Background] Offscreen document may already be closed')
    })

    // 2. Grace period for Deepgram to flush final audio chunk
    console.log('⏳ [Background] Waiting 2.5s for Deepgram to flush final transcripts...')
    await new Promise(resolve => setTimeout(resolve, 2500))

    // 3. Disconnect AI Backend
    await disconnectAIBackend()

    // 3. Close offscreen document
    console.log('📄 [Background] Closing offscreen document...')
    await chrome.offscreen.closeDocument().catch(() => {
      console.warn('⚠️ [Background] No offscreen document to close')
    })

    // 4. Update state
    // Always keep coaching armed so the next call auto-starts
    // (no need for agent to click "Start AI Coaching" again)
    const savedTabId = extensionState.tabId
    console.log('🔄 [Background] Call ended — keeping coaching armed for next call')

    await updateExtensionState({
      isRecording: false,
      isOnCall: false,
      coachingPending: true,
      tabId: savedTabId,
      currentStreamId: null,
      deepgramStatus: 'disconnected',
      aiBackendStatus: 'disconnected',
      remoteStreamActive: false,
      localStreamActive: false,
      conversationId: null,
      callDetectionSource: null,
    })

    // 5. Notify UI
    broadcastToUI({
      type: 'CALL_ENDED',
      timestamp: Date.now(),
    })

    console.log('✅ [Background] Call ended successfully')
  } catch (error: any) {
    console.error('❌ [Background] Error during call end:', error)
  }
}

// ============================================================================
// OFFSCREEN DOCUMENT MANAGEMENT
// ============================================================================

/**
 * Ensures a fresh offscreen document exists.
 * Closes any stale offscreen documents before creating a new one.
 */
async function ensureOffscreenDocument(): Promise<void> {
  try {
    // Check for existing offscreen documents
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    })

    // Close any stale offscreen documents
    if (existingContexts.length > 0) {
      console.log('🧹 [Background] Closing stale offscreen document...')
      await chrome.offscreen.closeDocument()
      console.log('✅ [Background] Stale offscreen document closed')
    }

    // Create new offscreen document
    console.log('📄 [Background] Creating offscreen document...')
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
      justification: 'Audio capture for call coaching'
    })

    console.log('✅ [Background] Offscreen document created')
  } catch (error: any) {
    console.error('❌ [Background] Failed to ensure offscreen document:', error)
    throw error
  }
}

// ============================================================================
// INITIALIZATION COMPLETE
// ============================================================================

console.log('✅ [Background] Service worker initialized (Production Demo v2.0.0)')
console.log('📋 [Background] Features enabled:')
console.log('   - Dual-stream audio capture (caller + agent)')
console.log('   - AWS WebSocket AI coaching')
console.log('   - Deepgram Nova-3 transcription')
console.log('   - PTT sandbox mode support')
console.log('   - State persistence and recovery')
