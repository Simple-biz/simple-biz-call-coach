console.log('🚀 [Content] Call detection script loaded')

// ============================================================================
// INJECT PAGE CONTEXT SCRIPTS
// ============================================================================
// NOTE: We ONLY use audio-processor.ts (page context) for audio capture
// The webrtc-bridge.ts is NOT imported to avoid duplicate audio streams

console.log('🔧 [Content] Injecting WebRTC interceptor...')

const interceptorScript = document.createElement('script')
interceptorScript.src = chrome.runtime.getURL('src/injected/webrtc-interceptor.ts')
interceptorScript.onload = () => {
  console.log('✅ [Content] WebRTC interceptor loaded')
  interceptorScript.remove()
}
interceptorScript.onerror = (error) => {
  console.error('❌ [Content] WebRTC interceptor failed to load:', error)
}
;(document.head || document.documentElement).appendChild(interceptorScript)

console.log('🔧 [Content] Injecting audio processor...')

const processorScript = document.createElement('script')
processorScript.src = chrome.runtime.getURL('src/injected/audio-processor.ts')
processorScript.onload = () => {
  console.log('✅ [Content] Audio processor loaded')
  processorScript.remove()
}
processorScript.onerror = (error) => {
  console.error('❌ [Content] Audio processor failed to load:', error)
}
;(document.head || document.documentElement).appendChild(processorScript)

// ============================================================================
// PORT-BASED CONNECTION WITH AUTO-RECONNECT
// ============================================================================

let port: chrome.runtime.Port | null = null
let portReconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5
let reloadNotificationShown = false

// Show a visual notification when extension context is invalidated
function showPageReloadNotification(): void {
  if (reloadNotificationShown) return
  reloadNotificationShown = true

  const notification = document.createElement('div')
  notification.id = 'call-coach-reload-notification'
  notification.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff4444;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      max-width: 350px;
      animation: slideIn 0.3s ease-out;
    ">
      <strong style="display: block; margin-bottom: 8px;">⚠️ Call Coach Extension Updated</strong>
      <p style="margin: 0 0 12px 0; line-height: 1.4;">
        The extension was reloaded. Please refresh this page to reconnect.
      </p>
      <button id="call-coach-reload-btn" style="
        background: white;
        color: #ff4444;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
      ">
        Refresh Page Now
      </button>
    </div>
  `

  // Add animation keyframes
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `
  document.head.appendChild(style)

  document.body.appendChild(notification)

  // Add click handler for reload button
  const reloadBtn = document.getElementById('call-coach-reload-btn')
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      window.location.reload()
    })
  }

  console.log('🔔 [Content] Reload notification displayed')
}

function connectToBackground(): void {
  try {
    port = chrome.runtime.connect({ name: 'calltools-content' })
    portReconnectAttempts = 0
    console.log('✅ [Content] Connected to background')

    port.onDisconnect.addListener(() => {
      console.log('🔌 [Content] Port disconnected')
      port = null

      // Check if extension context is invalidated
      const error = chrome.runtime.lastError
      if (error && error.message && error.message.includes('Extension context invalidated')) {
        console.error(
          '❌ [Content] Extension was reloaded - PLEASE REFRESH THIS PAGE (Ctrl+R or Cmd+R)'
        )
        showPageReloadNotification()
        return
      }

      // Auto-reconnect with backoff
      if (portReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        portReconnectAttempts++
        const delay = Math.min(1000 * portReconnectAttempts, 5000)
        console.log(
          `🔄 [Content] Reconnecting in ${delay}ms (attempt ${portReconnectAttempts})`
        )
        setTimeout(connectToBackground, delay)
      } else {
        console.warn(
          '⚠️ [Content] Max reconnect attempts reached - please refresh page'
        )
        showPageReloadNotification()
      }
    })

    port.onMessage.addListener(message => {
      console.log('📨 [Content] Port message:', message.type)
      handleIncomingMessage(message)
    })
  } catch (error) {
    const errorMessage = (error as Error).message || ''

    // Check for extension context invalidated
    if (errorMessage.includes('Extension context invalidated')) {
      console.error(
        '❌ [Content] Extension was reloaded - PLEASE REFRESH THIS PAGE (Ctrl+R or Cmd+R)'
      )
      showPageReloadNotification()
      return
    }

    console.error('❌ [Content] Connection failed:', error)
    // Try again after delay
    if (portReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      portReconnectAttempts++
      setTimeout(connectToBackground, 2000)
    }
  }
}

function sendToBackground(message: object): void {
  // Try port first
  if (port) {
    try {
      port.postMessage(message)
      console.log(`📤 [Content] Sent via port: ${(message as any).type}`)
      return
    } catch (error) {
      const errorMessage = (error as Error).message || ''
      if (errorMessage.includes('Extension context invalidated')) {
        console.error(
          '❌ [Content] Extension was reloaded - PLEASE REFRESH THIS PAGE'
        )
        showPageReloadNotification()
        return
      }
      console.warn('⚠️ [Content] Port send failed, trying runtime.sendMessage')
      port = null
    }
  }

  // Fallback to runtime.sendMessage (will wake up service worker)
  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || ''

        if (msg.includes('Extension context invalidated')) {
          console.error(
            '❌ [Content] Extension was reloaded - PLEASE REFRESH THIS PAGE'
          )
          showPageReloadNotification()
          return
        }

        if (!msg.includes('Receiving end does not exist')) {
          console.warn('⚠️ [Content] Message failed:', msg)
        }
        // Try to reconnect
        if (!port) {
          connectToBackground()
        }
      }
    })
  } catch (error) {
    const errorMessage = (error as Error).message || ''
    if (errorMessage.includes('Extension context invalidated')) {
      console.error(
        '❌ [Content] Extension was reloaded - PLEASE REFRESH THIS PAGE'
      )
      showPageReloadNotification()
      return
    }
    console.warn('⚠️ [Content] Send error, reconnecting...')
    connectToBackground()
  }
}

// Audio port for sending audio data to offscreen
let audioPort: chrome.runtime.Port | null = null

function handleIncomingMessage(message: any): void {
  if (message.type === 'EXTENSION_STATE_CHANGED') {
    console.log(`🔄 [Content] Extension state: ${message.state || 'unknown'}`)
  }
  if (message.type === 'STOP_COACHING') {
    console.log('🛑 [Content] Coaching stopped')
  }
  if (message.type === 'GET_WEBRTC_STREAMS') {
    // Tell page context audio processor to start processing
    console.log('📡 [Content] Starting audio processor in page context')

    // Create port for audio streaming to offscreen
    audioPort = chrome.runtime.connect({ name: 'webrtc-audio-stream' })
    console.log('📡 [Content] Audio port created')

    // Send command to audio processor in page context
    window.postMessage({
      target: 'audio-processor',
      type: 'START_PROCESSING',
      timestamp: Date.now()
    }, '*')
  }
  if (message.type === 'STOP_WEBRTC_STREAMING') {
    console.log('🛑 [Content] Stopping audio processor')

    // Tell page context to stop
    window.postMessage({
      target: 'audio-processor',
      type: 'STOP_PROCESSING',
      timestamp: Date.now()
    }, '*')

    // Close audio port
    if (audioPort) {
      audioPort.disconnect()
      audioPort = null
    }
  }
}

// Initialize connection
connectToBackground()

// ============================================================================
// WEBRTC STREAM NOTIFICATIONS FROM INJECTED SCRIPT
// ============================================================================

// Track whether streams are ready (isolated worlds prevents direct access)
let webrtcStreamsReady = false

window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return

  const { source, type, data } = event.data

  // Handle WebRTC interceptor messages
  if (source === 'webrtc-interceptor') {
    console.log(`📨 [Content] WebRTC interceptor message: ${type}`)

    if (type === 'INTERCEPTOR_READY') {
      console.log('✅ [Content] WebRTC interceptor confirmed ready')
    }

    if (type === 'REMOTE_AUDIO_TRACK') {
      console.log('🎤 [Content] Remote audio track detected (caller)')
    }

    if (type === 'LOCAL_AUDIO_TRACK') {
      console.log('🎤 [Content] Local audio track detected (agent mic)')
    }

    if (type === 'AUDIO_TRACKS_READY') {
      console.log('🎉 [Content] AUDIO_TRACKS_READY - both caller + agent streams detected')
      console.log('📝 [Content] Setting webrtcStreamsReady flag to true')
      webrtcStreamsReady = true
      console.log('🔔 [Content] Notifying background that streams are ready')
      handleWebRTCStreamsReady(data)
    }
  }

  // Handle audio processor messages (page context)
  if (source === 'audio-processor') {
    if (type === 'PROCESSING_STARTED') {
      console.log('✅ [Content] Audio processor started successfully')
    }

    if (type === 'PROCESSING_STOPPED') {
      console.log('✅ [Content] Audio processor stopped')
    }

    if (type === 'PROCESSING_ERROR') {
      console.error('❌ [Content] Audio processor error:', event.data.error)
    }

    if (type === 'AUDIO_DATA') {
      // Forward audio data to offscreen via port
      if (audioPort) {
        audioPort.postMessage({
          type: 'AUDIO_DATA',
          speaker: event.data.speaker,
          data: event.data.data,
          timestamp: event.data.timestamp
        })

        // Log every 50th frame to avoid console spam
        if (event.data.frameNumber && event.data.frameNumber % 50 === 0) {
          console.log(`📡 [Content] Forwarded ${event.data.speaker} audio frame ${event.data.frameNumber}: ${event.data.data?.length} samples`)
        }
      } else {
        console.warn(`⚠️ [Content] audioPort not connected, cannot forward ${event.data.speaker} audio`)
      }
    }
  }
})

function handleWebRTCStreamsReady(metadata: any) {
  console.log('📞 [Content] Handling WebRTC streams ready')
  console.log('📊 [Content] Stream metadata:', {
    remoteTrackIds: metadata.remoteTrackIds,
    localTrackIds: metadata.localTrackIds,
    timestamp: metadata.timestamp
  })

  // Don't try to access streams here - isolated worlds prevents access
  // The interceptor has already stored them in page context
  // WebRTC bridge will access them later via proper channel

  console.log('✅ [Content] Forwarding stream ready notification to background')

  // Notify background that WebRTC streams are ready
  sendToBackground({
    type: 'WEBRTC_STREAMS_READY',
    metadata: {
      remoteTrackIds: metadata.remoteTrackIds,
      localTrackIds: metadata.localTrackIds,
      timestamp: metadata.timestamp
    }
  })

  console.log('🎯 [Content] WEBRTC_STREAMS_READY message sent to background')
  console.log('💡 [Content] Background will either start capture immediately or wait for user to click "Start AI Coaching"')
}

// ============================================================================
// CALL DETECTION - MULTI-METHOD FOR CALLTOOLS
// ============================================================================

function isCallActive(): boolean {
  // Collect evidence from all detection methods
  let domIndicatorsActive = 0;

  // Method 1: Check for timer element
  const timerElement = document.querySelector(
    'p.dyn-text-center.ng-star-inserted'
  )
  if (timerElement) {
    const timerText = timerElement.textContent?.trim() || ''
    const isTimer = /^\d{2}:\d{2}:\d{2}$/.test(timerText)
    if (isTimer) {
      const seconds = parseInt(timerText.split(':')[2])
      if (seconds % 10 === 0) {
        console.log(`🎤 [Content] Call detected - Timer: ${timerText}`)
      }
      domIndicatorsActive++;
    }
  }

  // Method 2: Check for "On a Call" status text
  const statusDropdown = document.querySelector('[class*="status"]')
  if (statusDropdown) {
    const text = statusDropdown.textContent?.toLowerCase() || ''
    if (text.includes('on a call')) {
      domIndicatorsActive++;
    }
  }

  // Method 3: Check for red hangup button
  const hangupButton = document.querySelector(
    'button[color="warn"], [class*="hangup"], [class*="end-call"]'
  )
  if (hangupButton && (hangupButton as HTMLElement).offsetParent !== null) {
    domIndicatorsActive++;
  }

  // Method 4: Check for active WebRTC audio streams
  let hasWebRTCStreams = false;
  try {
    const pageWindow = document.defaultView as any
    const getStreams = pageWindow?.__getInterceptedStreams
    if (getStreams) {
      const streams = getStreams()
      if (streams) {
        // Check if remote (caller) or local (agent) streams have active audio tracks
        const hasActiveRemote = streams.remote?.getAudioTracks().some((t: MediaStreamTrack) => t.readyState === 'live')
        const hasActiveLocal = streams.local?.getAudioTracks().some((t: MediaStreamTrack) => t.readyState === 'live')
        hasWebRTCStreams = hasActiveRemote || hasActiveLocal;

        if (hasWebRTCStreams && Math.random() < 0.1) {
          console.log(`🎤 [Content] WebRTC streams: remote=${hasActiveRemote}, local=${hasActiveLocal}, DOM indicators=${domIndicatorsActive}`)
        }
      }
    }
  } catch (error) {
    // Silently fail - WebRTC check is supplementary
  }

  // SMART DETECTION LOGIC:
  // - If ANY DOM indicator shows call active → call is DEFINITELY active
  // - If NO DOM indicators but WebRTC streams exist → call ENDED (stale streams not cleaned up by CallTools)
  // - This prevents getting stuck when CallTools doesn't properly clean up WebRTC

  if (domIndicatorsActive > 0) {
    // Trust DOM indicators - call is definitely active
    return true;
  }

  if (hasWebRTCStreams && domIndicatorsActive === 0) {
    // WebRTC streams exist but NO DOM indicators = stale streams, call ended
    console.log('⚠️ [Content] WebRTC streams exist but no DOM indicators - call ended, streams not cleaned up');
    return false;
  }

  return false;
}

// ============================================================================
// CALL STATE MONITORING WITH DEBOUNCING
// ============================================================================

let lastCallState = false
let lastConfirmedCallState = false
let stateConfirmationCount = 0
const CONFIRMATION_THRESHOLD = 3
const INACTIVE_THRESHOLD = 5 // Require MORE confirmations to mark as inactive
const CHECK_INTERVAL = 2000

function checkCallStatus(): void {
  // Skip checks when tab is hidden
  if (document.hidden) {
    return
  }

  const currentCallState = isCallActive()
  const threshold = currentCallState
    ? CONFIRMATION_THRESHOLD
    : INACTIVE_THRESHOLD

  if (currentCallState !== lastCallState) {
    stateConfirmationCount++

    console.log(
      `🔄 [Content] State change (${stateConfirmationCount}/${threshold}): ${
        currentCallState ? 'ACTIVE' : 'INACTIVE'
      }`
    )

    if (stateConfirmationCount >= threshold) {
      lastCallState = currentCallState
      lastConfirmedCallState = currentCallState
      stateConfirmationCount = 0

      if (currentCallState) {
        console.log('📞 [Content] Call STARTED - notifying background')
        sendToBackground({
          type: 'CALL_STARTED',
          timestamp: Date.now(),
        })
      } else {
        console.log('📞 [Content] Call ENDED - notifying background')
        sendToBackground({
          type: 'CALL_ENDED',
          timestamp: Date.now(),
        })
      }
    }
  } else {
    if (stateConfirmationCount > 0) {
      stateConfirmationCount = 0
    }
  }
}

setInterval(checkCallStatus, CHECK_INTERVAL)

console.log('✅ [Content] Call detection initialized')
console.log(
  `⏱️ [Content] Debounce: ${CONFIRMATION_THRESHOLD} for active, ${INACTIVE_THRESHOLD} for inactive`
)

// Initial check after page load
setTimeout(() => {
  const initialState = isCallActive()
  console.log(
    `🧪 [Content] Initial test: ${initialState ? 'CALL ACTIVE' : 'NO CALL'}`
  )
  if (initialState) {
    lastCallState = true
    lastConfirmedCallState = true
    console.log('📞 [Content] Call already active - notifying background')
    sendToBackground({
      type: 'CALL_STARTED',
      timestamp: Date.now(),
    })
  }
}, 1000)

// ============================================================================
// MESSAGE HANDLER (for runtime.sendMessage responses)
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('📨 [Content] Message received:', message.type)

  if (message.type === 'CHECK_CALL_STATUS') {
    const isActive = document.hidden ? lastConfirmedCallState : isCallActive()
    console.log(
      `📞 [Content] Status check: ${isActive ? 'ACTIVE' : 'INACTIVE'}`
    )
    sendResponse({ isActive })
    return true
  }

  if (message.type === 'FORCE_STATE_CHECK') {
    const isActive = isCallActive()
    lastCallState = isActive
    lastConfirmedCallState = isActive
    stateConfirmationCount = 0
    sendResponse({ isActive })
    return true
  }

  if (message.type === 'CHECK_WEBRTC_STREAMS_STATUS') {
    console.log('🔍 [Content] Checking WebRTC stream availability')
    console.log(`📋 [Content] webrtcStreamsReady flag: ${webrtcStreamsReady}`)

    // Use our tracked flag instead of trying to access isolated window object
    if (webrtcStreamsReady) {
      console.log('✅ [Content] Streams ARE ready - background can start capture immediately')
    } else {
      console.log('⏳ [Content] Streams NOT ready yet - background will set pending capture request')
    }

    sendResponse({
      available: webrtcStreamsReady,
      remote: webrtcStreamsReady,
      local: webrtcStreamsReady
    })

    return true // Keep channel open for async response
  }

  handleIncomingMessage(message)
  return false
})

// ============================================================================
// PAGE VISIBILITY HANDLING
// ============================================================================

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('👁️ [Content] Tab hidden - pausing checks')
  } else {
    console.log('👁️ [Content] Tab visible - resuming')
    // Reconnect if needed
    if (!port) {
      connectToBackground()
    }
  }
})

// ============================================================================
// CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
  if (lastConfirmedCallState) {
    console.log('🚪 [Content] Page unloading with active call')
    sendToBackground({
      type: 'CALL_ENDED',
      timestamp: Date.now(),
      reason: 'page_unload',
    })
  }
})

console.log('✅ [Content] Fully initialized')
