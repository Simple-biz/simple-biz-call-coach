console.log('🌉 [WebRTC Bridge] Module loaded')

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let audioContext: AudioContext | null = null  // 16kHz for Deepgram transcription
let playbackContext: AudioContext | null = null  // Native sample rate for clean playback
let remoteProcessor: ScriptProcessorNode | null = null
let localProcessor: ScriptProcessorNode | null = null
let remotePlaybackSource: MediaStreamAudioSourceNode | null = null  // For clean caller audio playback
let audioPort: chrome.runtime.Port | null = null
let isStreaming = false

// ============================================================================
// MESSAGE HANDLER FOR OFFSCREEN REQUESTS
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log(`📨 [WebRTC Bridge] Received message: ${message.type}`)

  if (message.type === 'GET_WEBRTC_STREAMS') {
    extractAndStreamAudio()
      .then(() => {
        console.log('✅ [WebRTC Bridge] Stream extraction successful')
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('❌ [WebRTC Bridge] Stream extraction failed:', error)
        sendResponse({ success: false, error: error.message })
      })
    return true // Keep channel open for async response
  }

  if (message.type === 'STOP_WEBRTC_STREAMING') {
    stopStreaming()
    sendResponse({ success: true })
    return true
  }

  return false
})

// ============================================================================
// STREAM EXTRACTION AND AUDIO PROCESSING
// ============================================================================

async function extractAndStreamAudio() {
  console.log('🎤 [WebRTC Bridge] Starting audio stream extraction')

  // Access page context window (content scripts are in isolated world)
  const pageWindow = document.defaultView as any

  console.log('🔍 [WebRTC Bridge] Checking page window for streams')

  // Get streams from page context
  let streams = pageWindow?.__webrtcStreams

  if (!streams) {
    console.log('⚠️ [WebRTC Bridge] No cached streams, calling __getInterceptedStreams()')
    const getStreams = pageWindow?.__getInterceptedStreams
    if (!getStreams) {
      throw new Error('WebRTC streams not available in page context')
    }
    streams = getStreams()
    if (!streams) {
      throw new Error('__getInterceptedStreams() returned null/undefined')
    }
  }

  if (!streams.remote || !streams.local) {
    throw new Error(`Missing streams - remote: ${!!streams.remote}, local: ${!!streams.local}`)
  }

  console.log('✅ [WebRTC Bridge] Streams available:', {
    remote: streams.remote.getTracks().length,
    local: streams.local.getTracks().length
  })

  // Create port connection for streaming audio to offscreen
  console.log('📡 [WebRTC Bridge] Creating port connection to offscreen')
  audioPort = chrome.runtime.connect({ name: 'webrtc-audio-stream' })

  // Notify offscreen that we're ready to stream
  audioPort.postMessage({
    type: 'STREAM_READY',
    timestamp: Date.now()
  })

  console.log('📡 [WebRTC Bridge] Audio port connected to offscreen')

  // Create audio context for Deepgram transcription (16kHz)
  audioContext = new AudioContext({ sampleRate: 16000 })
  console.log(`🎵 [WebRTC Bridge] Transcription AudioContext created (${audioContext.sampleRate}Hz)`)

  // Create separate audio context for CLEAN playback (native sample rate - typically 48kHz)
  // This prevents static/artifacts from sample rate conversion
  playbackContext = new AudioContext()  // Uses default sample rate (48kHz)
  console.log(`🔊 [WebRTC Bridge] Playback AudioContext created (${playbackContext.sampleRate}Hz - native quality)`)

  // Setup CLEAN PLAYBACK for caller audio (48kHz → speakers, no downsampling)
  remotePlaybackSource = playbackContext.createMediaStreamSource(streams.remote)
  remotePlaybackSource.connect(playbackContext.destination)
  console.log('🔊 [WebRTC Bridge] CALLER audio routed to speakers via NATIVE sample rate (crystal clear)')

  // Process remote stream (caller audio) for TRANSCRIPTION ONLY
  await setupAudioProcessor(
    streams.remote,
    'caller',
    audioContext,
    audioPort
  )

  // Process local stream (agent mic)
  await setupAudioProcessor(
    streams.local,
    'agent',
    audioContext,
    audioPort
  )

  isStreaming = true
  console.log('🎉 [WebRTC Bridge] Audio streaming started for both tracks')
}

// ============================================================================
// AUDIO PROCESSOR SETUP
// ============================================================================

async function setupAudioProcessor(
  stream: MediaStream,
  speaker: 'caller' | 'agent',
  audioContext: AudioContext,
  port: chrome.runtime.Port
) {
  console.log(`🎵 [WebRTC Bridge] Setting up processor for ${speaker}`)

  const source = audioContext.createMediaStreamSource(stream)
  // Use 8192 samples (512ms at 16kHz) - larger chunks for better Deepgram transcription accuracy
  const processor = audioContext.createScriptProcessor(8192, 1, 1)

  let frameCount = 0

  processor.onaudioprocess = (event) => {
    if (!isStreaming) return

    const inputData = event.inputBuffer.getChannelData(0)

    // Log first few frames for diagnostics
    if (frameCount < 3) {
      console.log(
        `🔊 [WebRTC Bridge] ${speaker} frame ${frameCount}: ${inputData.length} samples`
      )
      frameCount++
    }

    // Convert Float32 to Int16 for Deepgram
    const int16Data = new Int16Array(inputData.length)
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]))
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }

    // Send audio data to offscreen via Chrome runtime port
    try {
      port.postMessage({
        type: 'AUDIO_DATA',
        speaker,
        data: Array.from(int16Data), // Convert to regular array for transfer
        timestamp: Date.now()
      })
    } catch (error) {
      console.error(`❌ [WebRTC Bridge] Failed to send ${speaker} audio:`, error)
    }
  }

  // Connect audio pipeline
  source.connect(processor)
  // NOTE: We do NOT connect to audioContext.destination here
  // Caller playback is handled separately via playbackContext (native 48kHz for clean audio)
  // This 16kHz context is ONLY for Deepgram transcription

  // Store processors for cleanup
  if (speaker === 'caller') {
    remoteProcessor = processor
    console.log('📊 [WebRTC Bridge] CALLER processor connected (transcription path only - 16kHz)')
  } else {
    localProcessor = processor
    console.log('📊 [WebRTC Bridge] AGENT processor connected (transcription path only - 16kHz)')
  }

  console.log(`✅ [WebRTC Bridge] ${speaker} processor configured for Deepgram`)
}

// ============================================================================
// CLEANUP
// ============================================================================

function stopStreaming() {
  console.log('🛑 [WebRTC Bridge] Stopping audio streaming')

  isStreaming = false

  if (remoteProcessor) {
    remoteProcessor.disconnect()
    remoteProcessor = null
  }

  if (localProcessor) {
    localProcessor.disconnect()
    localProcessor = null
  }

  if (remotePlaybackSource) {
    remotePlaybackSource.disconnect()
    remotePlaybackSource = null
  }

  if (audioContext) {
    audioContext.close()
    audioContext = null
  }

  if (playbackContext) {
    playbackContext.close()
    playbackContext = null
  }

  if (audioPort) {
    audioPort.disconnect()
    audioPort = null
  }

  console.log('✅ [WebRTC Bridge] Cleanup complete')
}

// ============================================================================
// EXPORT FOR CONTENT SCRIPT
// ============================================================================

export { extractAndStreamAudio, stopStreaming }
