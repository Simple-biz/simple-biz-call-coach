// @ts-nocheck
// ============================================================================
// AUDIO PROCESSOR - Runs in PAGE CONTEXT
// ============================================================================
// This script runs in the page's JavaScript context (not isolated world)
// so it can access window.__webrtcStreams and process the MediaStreams
// ============================================================================

;(function() {
console.log('🎵 [Audio Processor] Initializing in page context...')

let pageAudioContext = null
let pageRemoteProcessor = null
let pageLocalProcessor = null
let isProcessing = false

// ============================================================================
// AUDIO PROCESSING SETUP
// ============================================================================

async function startAudioProcessing() {
  console.log('🎤 [Audio Processor] Starting audio processing')

  // Access streams from page context window
  const streams = window.__webrtcStreams

  if (!streams || !streams.remote || !streams.local) {
    throw new Error(`Streams not available - remote: ${!!streams?.remote}, local: ${!!streams?.local}`)
  }

  console.log('✅ [Audio Processor] Streams found:', {
    remote: streams.remote.getTracks().length,
    local: streams.local.getTracks().length
  })

  // Create audio context for processing
  // Use 16kHz for optimal Deepgram Nova-2 accuracy (per Deepgram docs)
  pageAudioContext = new AudioContext({ sampleRate: 16000 })
  console.log(`🎵 [Audio Processor] AudioContext created (${pageAudioContext.sampleRate}Hz)`)

  // Get FIRST audio track only from each stream to avoid duplicates
  const remoteAudioTracks = streams.remote.getAudioTracks()
  const localAudioTracks = streams.local.getAudioTracks()

  if (remoteAudioTracks.length === 0 || localAudioTracks.length === 0) {
    throw new Error('No audio tracks found in streams')
  }

  console.log('🎤 [Audio Processor] Using first track only:', {
    remote: `${remoteAudioTracks.length} tracks available, using track 0`,
    local: `${localAudioTracks.length} tracks available, using track 0`
  })

  // Create single-track streams
  const remoteSingleTrack = new MediaStream([remoteAudioTracks[0]])
  const localSingleTrack = new MediaStream([localAudioTracks[0]])

  // Process remote stream (caller audio) - FIRST track only
  await setupStreamProcessor(remoteSingleTrack, 'caller')

  // Process local stream (agent mic) - FIRST track only
  await setupStreamProcessor(localSingleTrack, 'agent')

  isProcessing = true
  console.log('✅ [Audio Processor] Audio processing started')

  // Notify content script that processing has started
  window.postMessage({
    source: 'audio-processor',
    type: 'PROCESSING_STARTED',
    timestamp: Date.now()
  }, '*')
}

async function setupStreamProcessor(stream, speaker) {
  if (!pageAudioContext) throw new Error('AudioContext not initialized')

  const source = pageAudioContext.createMediaStreamSource(stream)

  // Create script processor for capturing audio data
  // Use 8192 samples (512ms at 16kHz) - larger chunks for better Deepgram transcription accuracy
  const processor = pageAudioContext.createScriptProcessor(8192, 1, 1)

  // Create a GainNode with gain=0 to mute playback while keeping processor active
  // ScriptProcessorNode requires connection to destination to fire events
  // But we don't want echo, so we mute it with gain=0
  const gainNode = pageAudioContext.createGain()
  gainNode.gain.value = 0 // Mute the output (no playback, no echo!)

  let frameCount = 0

  processor.onaudioprocess = (event) => {
    if (!isProcessing) return

    const inputData = event.inputBuffer.getChannelData(0)

    // Convert Float32 (-1 to 1) to Int16 PCM (-32768 to 32767)
    const pcmData = new Int16Array(inputData.length)
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]))
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    // Send PCM data to content script via window.postMessage
    window.postMessage({
      source: 'audio-processor',
      type: 'AUDIO_DATA',
      speaker,
      data: Array.from(pcmData), // Convert to regular array for postMessage
      timestamp: Date.now(),
      frameNumber: frameCount++
    }, '*')

    if (frameCount % 100 === 0) {
      console.log(`🔊 [Audio Processor] ${speaker} frame ${frameCount}: ${inputData.length} samples`)
    }
  }

  // Audio chain: source → processor → gainNode(muted) → destination
  // This keeps ScriptProcessor firing events, but mutes playback to prevent echo
  source.connect(processor)
  processor.connect(gainNode)
  gainNode.connect(pageAudioContext.destination)

  if (speaker === 'caller') {
    pageRemoteProcessor = processor
  } else {
    pageLocalProcessor = processor
  }

  console.log(`✅ [Audio Processor] ${speaker} processor connected (muted, no echo)`)
}

// ============================================================================
// CLEANUP
// ============================================================================

function stopAudioProcessing() {
  console.log('🛑 [Audio Processor] Stopping audio processing')

  isProcessing = false

  if (pageRemoteProcessor) {
    pageRemoteProcessor.disconnect()
    pageRemoteProcessor = null
  }

  if (pageLocalProcessor) {
    pageLocalProcessor.disconnect()
    pageLocalProcessor = null
  }

  if (pageAudioContext) {
    pageAudioContext.close()
    pageAudioContext = null
  }

  console.log('✅ [Audio Processor] Cleanup complete')

  // Notify content script
  window.postMessage({
    source: 'audio-processor',
    type: 'PROCESSING_STOPPED',
    timestamp: Date.now()
  }, '*')
}

// ============================================================================
// MESSAGE HANDLER - Listen for commands from content script
// ============================================================================

window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return

  // Only process messages for audio processor
  if (event.data.target !== 'audio-processor') return

  console.log(`📨 [Audio Processor] Received command: ${event.data.type}`)

  if (event.data.type === 'START_PROCESSING') {
    startAudioProcessing().catch((err) => {
      console.error('❌ [Audio Processor] Start failed:', err)
      window.postMessage({
        source: 'audio-processor',
        type: 'PROCESSING_ERROR',
        error: err.message,
        timestamp: Date.now()
      }, '*')
    })
  }

  if (event.data.type === 'STOP_PROCESSING') {
    stopAudioProcessing()
  }
})

console.log('✅ [Audio Processor] Ready to process audio')
})() // Close IIFE
