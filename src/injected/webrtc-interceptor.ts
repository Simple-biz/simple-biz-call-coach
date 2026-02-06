// @ts-nocheck
console.log('🚀 [WebRTC Interceptor] Initializing...');

// ============================================================================
// TYPE DEFINITIONS (JSDoc)
// ============================================================================

/**
 * @typedef {Object} InterceptedStream
 * @property {string} id
 * @property {'local'|'remote'} type
 * @property {MediaStream} stream
 * @property {MediaStreamTrack[]} tracks
 * @property {number} timestamp
 */

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const OriginalRTCPeerConnection = window.RTCPeerConnection;
const interceptedStreams = new Map();

let remoteAudioStream = null;
let localAudioStream = null;

// ============================================================================
// STREAM HANDLING FUNCTIONS
// ============================================================================

function handleRemoteAudioTrack(track, stream) {
  console.log('[WebRTC Interceptor] REMOTE audio track detected:', track.id);

  const streamToUse = stream || new MediaStream([track]);

  // Create or update remote stream
  if (!remoteAudioStream) {
    remoteAudioStream = new MediaStream();
    console.log('[WebRTC Interceptor] Created remote stream');
  }

  // Add track if not already present
  const existingTracks = remoteAudioStream.getTracks();
  if (!existingTracks.find(t => t.id === track.id)) {
    remoteAudioStream.addTrack(track);
    console.log('[WebRTC Interceptor] Added remote track to stream');
  }

  const streamData = {
    id: streamToUse.id,
    type: 'remote',
    stream: remoteAudioStream,
    tracks: [track],
    timestamp: Date.now()
  };

  interceptedStreams.set(`remote-${track.id}`, streamData);

  // Notify content script
  notifyContentScript('REMOTE_AUDIO_TRACK', streamData);

  // Check if we have both streams
  checkAndNotifyReady();
}

function handleLocalAudioTrack(track, stream) {
  console.log('[WebRTC Interceptor] LOCAL audio track detected:', track.id);

  const streamToUse = stream || new MediaStream([track]);

  // Create or update local stream
  if (!localAudioStream) {
    localAudioStream = new MediaStream();
    console.log('[WebRTC Interceptor] Created local stream');
  }

  // Add track if not already present
  const existingTracks = localAudioStream.getTracks();
  if (!existingTracks.find(t => t.id === track.id)) {
    localAudioStream.addTrack(track);
    console.log('[WebRTC Interceptor] Added local track to stream');
  }

  const streamData = {
    id: streamToUse.id,
    type: 'local',
    stream: localAudioStream,
    tracks: [track],
    timestamp: Date.now()
  };

  interceptedStreams.set(`local-${track.id}`, streamData);

  // Notify content script
  notifyContentScript('LOCAL_AUDIO_TRACK', streamData);

  // Check if we have both streams
  checkAndNotifyReady();
}

function checkAndNotifyReady() {
  if (remoteAudioStream && localAudioStream) {
    const remoteTracks = remoteAudioStream.getTracks();
    const localTracks = localAudioStream.getTracks();

    if (remoteTracks.length > 0 && localTracks.length > 0) {
      console.log('✅ [WebRTC Interceptor] Both streams ready!');

      // Store streams directly on window for content script access
      // Content scripts can access window properties (not functions in page context)
      window.__webrtcStreams = {
        remote: remoteAudioStream,
        local: localAudioStream
      };
      console.log('[WebRTC Interceptor] Stored streams on window.__webrtcStreams');

      notifyContentScript('AUDIO_TRACKS_READY', {
        remoteTrackIds: remoteTracks.map(t => t.id),
        localTrackIds: localTracks.map(t => t.id),
        timestamp: Date.now()
      });
    }
  }
}

function notifyContentScript(type, data) {
  window.postMessage({
    source: 'webrtc-interceptor',
    type,
    data: {
      id: data.id,
      type: data.type,
      trackIds: data.trackIds || data.tracks?.map((t) => t.id) || [],
      remoteTrackIds: data.remoteTrackIds,
      localTrackIds: data.localTrackIds,
      timestamp: data.timestamp
    }
  }, '*');
}

// ============================================================================
// RTCPEERCONNECTION PROXY
// ============================================================================

window.RTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
  construct(target, args) {
    console.log('[WebRTC Interceptor] New RTCPeerConnection created');

    const pc = new target(...args);

    // ========================================================================
    // Hook getReceivers (REMOTE AUDIO - Caller)
    // ========================================================================
    // CallTools uses pc.ontrack which we can't reliably intercept without breaking audio
    // Instead, poll getReceivers() to detect remote tracks (defensive approach)

    const originalGetReceivers = pc.getReceivers.bind(pc);
    pc.getReceivers = function() {
      const receivers = originalGetReceivers();

      receivers.forEach(receiver => {
        if (receiver.track?.kind === 'audio') {
          const trackId = `remote-${receiver.track.id}`;
          if (!interceptedStreams.has(trackId)) {
            console.log('[WebRTC Interceptor] Found remote track via getReceivers');
            handleRemoteAudioTrack(receiver.track, null);
          }
        }
      });

      return receivers;
    };

    // ========================================================================
    // Hook addEventListener for 'track' events (alternative method)
    // ========================================================================

    const originalAddEventListener = pc.addEventListener.bind(pc);
    pc.addEventListener = function(type, listener, options) {
      if (type === 'track') {
        console.log('[WebRTC Interceptor] addEventListener("track") called');

        const wrappedListener = (event) => {
          if (event.track.kind === 'audio') {
            handleRemoteAudioTrack(event.track, event.streams[0]);
          }
          return listener(event);
        };

        return originalAddEventListener(type, wrappedListener, options);
      }

      return originalAddEventListener(type, listener, options);
    };

    // ========================================================================
    // Hook addTrack (LOCAL AUDIO - Agent Microphone)
    // ========================================================================

    const originalAddTrack = pc.addTrack.bind(pc);
    pc.addTrack = function(track, ...streams) {
      console.log('[WebRTC Interceptor] addTrack called:', track.kind);

      // Intercept audio tracks
      if (track.kind === 'audio') {
        handleLocalAudioTrack(track, streams[0]);
      }

      return originalAddTrack(track, ...streams);
    };

    // ========================================================================
    // Hook getSenders (for existing local tracks - defensive)
    // ========================================================================

    const originalGetSenders = pc.getSenders.bind(pc);
    pc.getSenders = function() {
      const senders = originalGetSenders();

      senders.forEach(sender => {
        if (sender.track?.kind === 'audio') {
          const trackId = `local-${sender.track.id}`;
          if (!interceptedStreams.has(trackId)) {
            console.log('[WebRTC Interceptor] Found existing local track via getSenders');
            handleLocalAudioTrack(sender.track, null);
          }
        }
      });

      return senders;
    };

    // ========================================================================
    // Poll for remote tracks (since ontrack interception breaks audio)
    // ========================================================================

    let pollCount = 0;
    const MAX_POLLS = 20; // Poll for up to 20 seconds
    const pollInterval = setInterval(() => {
      pollCount++;

      // Stop polling after max attempts or when remote track found
      if (pollCount > MAX_POLLS || remoteAudioStream) {
        clearInterval(pollInterval);
        if (!remoteAudioStream) {
          console.log('[WebRTC Interceptor] Polling stopped - no remote track found');
        }
        return;
      }

      // Check for remote tracks via getReceivers
      pc.getReceivers();
    }, 1000);

    return pc;
  }
});

// ============================================================================
// EXPOSE ACCESSOR FOR CONTENT SCRIPT
// ============================================================================

window.__getInterceptedStreams = () => {
  console.log('[WebRTC Interceptor] Streams requested by content script');
  console.log('  - Remote stream:', !!remoteAudioStream, remoteAudioStream?.getTracks().length || 0, 'tracks');
  console.log('  - Local stream:', !!localAudioStream, localAudioStream?.getTracks().length || 0, 'tracks');

  return {
    remote: remoteAudioStream,
    local: localAudioStream
  };
};

// ============================================================================
// INITIALIZATION COMPLETE
// ============================================================================

console.log('✅ [WebRTC Interceptor] Ready - RTCPeerConnection hooked');

// Notify content script that interceptor is ready
window.postMessage({
  source: 'webrtc-interceptor',
  type: 'INTERCEPTOR_READY',
  data: { timestamp: Date.now() }
}, '*');
