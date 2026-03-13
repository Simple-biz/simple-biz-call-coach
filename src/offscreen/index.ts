// Import validator for pre-connection checks
import { logger } from '@/utils/logger'
import { startPTTCapture, stopPTTCapture } from './ptt-capture'

logger.log('✅ Offscreen document ready for audio capture with Deepgram (Dual Stream)')

// ============================================================================
// STATE MANAGEMENT - DUAL STREAM (NO MIXING)
// ============================================================================

// Two Deepgram Sockets
let agentSocket: WebSocket | null = null
let callerSocket: WebSocket | null = null

// KeepAlive timers
let keepAliveIntervalAgent: any = null
let keepAliveIntervalCaller: any = null

// Stream State
let deepgramApiKey: string | null = null
let isCapturing = false

// Media State
let tabCaptureStream: MediaStream | null = null
let micStream: MediaStream | null = null
let audioContext: AudioContext | null = null

// Worklet Nodes (Separate processing)
let agentWorklet: AudioWorkletNode | null = null
let callerWorklet: AudioWorkletNode | null = null

// ============================================================================
// DEDUPLICATION STATE (SIDETONE SUPPRESSION)
// ============================================================================
// We store recent Agent transcripts to check if Caller transcript is just an echo.
const RECENT_AGENT_TEXT_BUFFER_MS = 5000
let recentAgentTranscripts: { text: string, time: number }[] = []


// ============================================================================
// MESSAGE HANDLER
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_TAB_CAPTURE') {
    startDualStreamCapture(message.streamId, message.deepgramApiKey)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
          logger.error('❌ Capture Start Failed:', err)
          sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (message.type === 'STOP_CAPTURE') {
    stopDualStreamCapture()
    sendResponse({ success: true })
    return true
  }

  // Handle other messages if needed (e.g. GET_CAPTURE_STATE)
  if (message.type === 'GET_CAPTURE_STATE') {
    sendResponse({
      success: true,
      isCapturing: isCapturing,
      hasDeepgramConnection: agentSocket?.readyState === WebSocket.OPEN || callerSocket?.readyState === WebSocket.OPEN
    })
    return true;
  }

  // PTT Sandbox Handlers
  if (message.type === 'START_PTT_CAPTURE') {
    startPTTCapture(message.deepgramApiKey)
      .then(() => sendResponse({ success: true }))
      .catch((err: Error) => {
        logger.error('❌ PTT Start Failed:', err)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (message.type === 'STOP_PTT_CAPTURE') {
    stopPTTCapture()
      .then((transcript: string) => sendResponse({ success: true, transcript }))
      .catch((err: Error) => sendResponse({ success: false, error: err.message }))
    return true
  }
})

// ============================================================================
// DUAL STREAM CAPTURE SETUP
// ============================================================================

async function startDualStreamCapture(streamId: string, apiKey: string) {
    logger.log('🎬 Starting Dual-Stream Capture (Agent vs Caller)')
    deepgramApiKey = apiKey

    try {
        // 1. Get Tab Stream (Caller + Sidetone)
        tabCaptureStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            } as any,
            video: false
        })

        // 2. Get Mic Stream (Agent Only)
        // We use Echo Cancellation here to clean up the mic input itself
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            }
        })

        // 3. Create Audio Context & Worklets
        audioContext = new AudioContext()
        await audioContext.audioWorklet.addModule(chrome.runtime.getURL('src/offscreen/audio-worklet-processor.js'))

        // 4. Setup Agent Pipeline (Mic -> Agent Worklet -> Agent Socket)
        const micSource = audioContext.createMediaStreamSource(micStream)
        agentWorklet = new AudioWorkletNode(audioContext, 'deepgram-audio-processor', {
            processorOptions: { source: 'agent' }
        })

        agentWorklet.port.onmessage = (event) => {
            if (event.data.command === 'audio') {
                // Send audio buffer to Deepgram
                if (agentSocket?.readyState === WebSocket.OPEN) {
                    agentSocket.send(event.data.buffer)
                }

                // Forward audio level to background/UI for monitoring
                if (event.data.audioLevel !== undefined) {
                    chrome.runtime.sendMessage({
                        type: 'AUDIO_LEVEL_UPDATE',
                        level: event.data.audioLevel,
                        source: 'agent'
                    }).catch(() => {})
                }
            }
        }
        micSource.connect(agentWorklet)
        // Agent Worklet does NOT connect to destination (we don't want to hear ourselves)

        // 5. Setup Caller Pipeline (Tab -> Caller Worklet -> Caller Socket + Destination)
        const tabSource = audioContext.createMediaStreamSource(tabCaptureStream)
        callerWorklet = new AudioWorkletNode(audioContext, 'deepgram-audio-processor', {
            processorOptions: { source: 'caller' }
        })

        callerWorklet.port.onmessage = (event) => {
            if (event.data.command === 'audio') {
                // Send audio buffer to Deepgram
                if (callerSocket?.readyState === WebSocket.OPEN) {
                    callerSocket.send(event.data.buffer)
                }

                // Forward audio level to background/UI for monitoring
                if (event.data.audioLevel !== undefined) {
                    chrome.runtime.sendMessage({
                        type: 'AUDIO_LEVEL_UPDATE',
                        level: event.data.audioLevel,
                        source: 'caller'
                    }).catch(() => {})
                }
            }
        }
        tabSource.connect(callerWorklet)
        tabSource.connect(audioContext.destination) // Critical: Hear the caller!

        // 6. Connect Sockets
        await connectDeepgramSockets()
        isCapturing = true

    } catch (err: any) {
        logger.error('❌ Failed to start Dual Stream Capture:', err)
        chrome.runtime.sendMessage({
            type: 'CAPTURE_ERROR',
            error: err?.message || String(err)
        }).catch(() => {})
        stopDualStreamCapture()
        throw err;
    }
}

// ============================================================================
// DUAL SOCKET MANAGEMENT
// ============================================================================

async function connectDeepgramSockets() {
    const token = deepgramApiKey
    if (!token) throw new Error('No Deepgram API Key configured')

    logger.log('🔑 Using Deepgram API key for authentication')

    // Nova-3: Latest model with improved accuracy
    // Using Sec-WebSocket-Protocol authentication for browser compatibility
    const params = new URLSearchParams({
        model: 'nova-3',
        language: 'en-US',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        interim_results: 'true',
        smart_format: 'true',
        punctuate: 'true',
        detect_entities: 'true'
    })

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`

    try {
        // Create Agent Socket using Sec-WebSocket-Protocol auth
        logger.log('🔌 Connecting AGENT Socket (Nova-3, Sec-WebSocket-Protocol auth)...')
        logger.log(`🔑 Using API key: ${token.substring(0, 8)}...`)
        // Pass ['token', apiKey] as second parameter for Sec-WebSocket-Protocol header
        agentSocket = new WebSocket(wsUrl, ['token', token])
        setupSocketHandlers(agentSocket, 'agent')

        // Create Caller Socket using Sec-WebSocket-Protocol auth
        logger.log('🔌 Connecting CALLER Socket (Nova-3, Sec-WebSocket-Protocol auth)...')
        callerSocket = new WebSocket(wsUrl, ['token', token])
        setupSocketHandlers(callerSocket, 'caller')
    } catch (e) {
        logger.error('❌ Failed to create Deepgram Sockets:', e)
        throw e
    }
}

function setupSocketHandlers(socket: WebSocket, source: 'agent' | 'caller') {
    socket.onopen = () => {
        logger.log(`✅ ${source.toUpperCase()} Socket Connected`)

        // Broadcast connection status
        chrome.runtime.sendMessage({
            type: 'DEEPGRAM_STATUS',
            status: 'connected',
            speaker: source
        }).catch(() => {})

        // KeepAlive
        const interval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'KeepAlive' }))
            }
        }, 5000)

        if (source === 'agent') keepAliveIntervalAgent = interval
        else keepAliveIntervalCaller = interval
    }

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data)
            handleDualResponse(data, source)
        } catch (e) {
            logger.error(`Parse Error (${source})`, e)
        }
    }

    socket.onerror = (e) => {
        logger.error(`❌ ${source} Socket Error`, e)
        chrome.runtime.sendMessage({
            type: 'DEEPGRAM_STATUS',
            status: 'error',
            speaker: source
        }).catch(() => {})
    }

    socket.onclose = (event) => {
        logger.log(`🔌 ${source} Socket Closed (code: ${event.code})`)
        chrome.runtime.sendMessage({
            type: 'DEEPGRAM_STATUS',
            status: 'disconnected',
            speaker: source
        }).catch(() => {})

        // Auto-reconnect if unexpected closure
        if (isCapturing && event.code !== 1000) {
            logger.log(`🔄 Attempting to reconnect ${source} socket...`)
            setTimeout(() => {
                if (isCapturing) {
                    connectDeepgramSockets().catch(err => {
                        logger.error(`❌ Failed to reconnect ${source} socket:`, err)
                    })
                }
            }, 3000)
        }
    }
}

// ============================================================================
// DUAL STREAM RESPONSE HANDLER + DEDUPLICATION
// ============================================================================

function handleDualResponse(data: any, source: 'agent' | 'caller') {
    if (data.type !== 'Results' || !data.channel?.alternatives?.[0]) return

    const alt = data.channel.alternatives[0]
    const transcript = alt.transcript
    if (!transcript || transcript.trim().length === 0) return

    const isFinal = data.is_final
    const confidence = alt.confidence || 0
    const entities = alt.entities || []

    // INTERIM HANDLING: Only process final transcripts for deduplication
    // (Interim transcripts are sent to UI but not used for echo detection)
    if (!isFinal) {
        // Send interim to UI for live feedback
        dispatchTranscript(transcript, source, false, confidence, [])
        return
    }

    // Forward entities to UI/backend if present (only in final transcripts)
    if (entities.length > 0) {
        logger.log(`🏷️ [ENTITIES] Detected ${entities.length} entities in ${source} transcript:`, entities)
        chrome.runtime.sendMessage({
            type: 'ENTITIES_DETECTED',
            entities: entities,
            speaker: source,
            transcript: transcript,
            timestamp: Date.now()
        }).catch(() => {})
    }

    // 1. BUFFER AGENT TEXT (For Dedupe) - FINAL ONLY
    if (source === 'agent') {
        recentAgentTranscripts.push({ text: transcript, time: Date.now() })
        // Cleanup old buffer
        recentAgentTranscripts = recentAgentTranscripts.filter(t => Date.now() - t.time < RECENT_AGENT_TEXT_BUFFER_MS)

        // Dispatch Agent Logic with confidence and entities
        dispatchTranscript(transcript, 'agent', true, confidence, entities)
        return
    }

    // 2. CHECK CALLER TEXT FOR ECHO (Sidetone Suppression) - FINAL ONLY
    if (source === 'caller') {
        // Is this transcript remarkably similar to something the Agent JUST said?
        const isEcho = checkForEcho(transcript)

        if (isEcho) {
            logger.log(`🛡️ [DEDUPE] Suppressed Echo in Caller Stream: "${transcript}"`)
            return // DROP IT
        }

        dispatchTranscript(transcript, 'caller', true, confidence, entities)
    }
}

function checkForEcho(callerText: string): boolean {
    // Simple fuzzy match against recent agent texts
    // If >70% overlapping words, assume it's an echo.
    const cleanCaller = callerText.toLowerCase().replace(/[^a-z0-9 ]/g, '')
    if (cleanCaller.length < 5) return false // Too short to judge

    for (const agentEntry of recentAgentTranscripts) {
        const cleanAgent = agentEntry.text.toLowerCase().replace(/[^a-z0-9 ]/g, '')

        // Exact substring match (common for perfect echo)
        if (cleanCaller.includes(cleanAgent) || cleanAgent.includes(cleanCaller)) {
             // Only if lengths are somewhat comparable (avoid matching "I" to "I am the agent")
             const lenRatio = Math.min(cleanCaller.length, cleanAgent.length) / Math.max(cleanCaller.length, cleanAgent.length)
             if (lenRatio > 0.5) return true
        }

        // TODO: Full Levenshtein if needed, but substring is usually enough for sidetone
    }
    return false
}

function dispatchTranscript(text: string, speaker: 'agent' | 'caller', isFinal: boolean, confidence: number = 0, entities: any[] = []) {
    const prefix = isFinal ? '📤 Sending Final' : '⏳ Sending Interim'
    const entitiesInfo = entities.length > 0 ? ` | ${entities.length} entities` : ''
    logger.log(`${prefix}: [${speaker.toUpperCase()}] "${text}" (confidence: ${Math.round(confidence * 100)}%${entitiesInfo})`)

    chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_UPDATE',
        transcript: text,
        isFinal: isFinal,
        speaker: speaker,
        id: isFinal ? crypto.randomUUID() : `interim-${speaker}`,
        timestamp: Date.now(),
        confidence: confidence,
        entities: entities
    }).catch(() => {})
}


// ============================================================================
// CLEANUP
// ============================================================================

function stopDualStreamCapture() {
    isCapturing = false

    // Stop Sockets
    if (agentSocket) {
        if (agentSocket.readyState === WebSocket.OPEN) {
            agentSocket.close(1000, 'Capture stopped')
        }
        agentSocket = null
    }
    if (callerSocket) {
        if (callerSocket.readyState === WebSocket.OPEN) {
            callerSocket.close(1000, 'Capture stopped')
        }
        callerSocket = null
    }
    clearInterval(keepAliveIntervalAgent)
    clearInterval(keepAliveIntervalCaller)

    // Stop Streams
    micStream?.getTracks().forEach(t => t.stop())
    tabCaptureStream?.getTracks().forEach(t => t.stop())

    // Disconnect Worklets
    agentWorklet?.disconnect()
    callerWorklet?.disconnect()
    agentWorklet = null
    callerWorklet = null

    // Close Context
    audioContext?.close()
    audioContext = null

    // Notify background
    chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED' }).catch(() => {})

    logger.log('🛑 Dual Capture Stopped')
}
