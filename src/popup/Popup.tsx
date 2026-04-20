import { useEffect, useState } from 'react'
import { Mic, Activity, CheckCircle, LogOut, Settings2 } from 'lucide-react'
import { useCallStore } from '@/stores/call-store'
import { SessionStats } from '@/components/SessionStats'
import Login from './Login'

export default function Popup() {
  const { audioState, audioLevel, transcriptions, coachingTips, session, callState } = useCallStore()
  const [isStarting, setIsStarting] = useState(false)
  const [isCallToolsTab, setIsCallToolsTab] = useState(true)
  const [isCheckingTab, setIsCheckingTab] = useState(true)
  const [hasUsedBefore, setHasUsedBefore] = useState(false)
  const [isCallDetected, setIsCallDetected] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userCcEmail, setUserCcEmail] = useState<string | null>(null) // Added
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)
  const [micTesting, setMicTesting] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [micTranscript, setMicTranscript] = useState('')
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [micError, setMicError] = useState<string | null>(null)

  // Mic test cleanup on unmount
  useEffect(() => {
    return () => {
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop())
      }
    }
  }, [micStream])

  const startMicTest = async () => {
    setMicError(null)
    setMicTranscript('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setMicStream(stream)
      setMicTesting(true)

      // Audio level meter
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const checkLevel = () => {
        if (!stream.active) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)))
        requestAnimationFrame(checkLevel)
      }
      checkLevel()

      // Deepgram transcription test
      const dgKey = await new Promise<string>((resolve) => {
        chrome.storage.local.get(['deepgramApiKey'], (r: any) => resolve(r.deepgramApiKey || ''))
      })

      if (dgKey) {
        const ws = new WebSocket(
          `wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=48000&channels=1&interim_results=true&smart_format=true`,
          ['token', dgKey]
        )

        const processor = audioCtx.createScriptProcessor(4096, 1, 1)
        source.connect(processor)
        processor.connect(audioCtx.destination)

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const float32 = e.inputBuffer.getChannelData(0)
            const int16 = new Int16Array(float32.length)
            for (let i = 0; i < float32.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)))
            }
            ws.send(int16.buffer)
          }
        }

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)
          const transcript = data.channel?.alternatives?.[0]?.transcript
          if (transcript) {
            setMicTranscript(transcript)
          }
        }

        ws.onerror = () => setMicError('Deepgram connection failed')

        // Store cleanup refs
        stream.addEventListener('inactive', () => {
          ws.close()
          processor.disconnect()
          audioCtx.close()
        })
      }
    } catch (err: any) {
      setMicError(err.message || 'Mic access denied')
      setMicTesting(false)
    }
  }

  const stopMicTest = () => {
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop())
      setMicStream(null)
    }
    setMicTesting(false)
    setMicLevel(0)
    setMicTranscript('')
  }

  useEffect(() => {
    chrome.storage.local.get(['userEmail', 'userCcEmail', 'developerModeEnabled'], (result: { userEmail?: string; userCcEmail?: string; developerModeEnabled?: boolean }) => {
      setUserEmail(result.userEmail || null)
      setUserCcEmail(result.userCcEmail || null) // Load CC
      setDeveloperModeEnabled(result.developerModeEnabled || false)
      setIsCheckingAuth(false)
      if (result.userEmail) {
        console.log('📧 [Popup] User logged in:', result.userEmail)
      }
      if (result.developerModeEnabled) {
        console.log('🔧 [Popup] Developer Mode: ENABLED')
      }
    })
  }, [])

  useEffect(() => {
    if (userEmail) {
      useCallStore.getState().loadFromStorage()
    }
  }, [userEmail])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const currentTab = tabs[0]
      const isCallTools = currentTab?.url?.includes('calltools.io')
      setIsCallToolsTab(!!isCallTools)
      setIsCheckingTab(false)
    })

    chrome.storage.local.get(['hasUsedBefore'], (result: { hasUsedBefore?: boolean }) => {
      setHasUsedBefore(result.hasUsedBefore || false)
    })
  }, [])

  useEffect(() => {
    let pollInterval: number | undefined

    const checkCallStatus = async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })

        if (tab?.id && tab.url?.includes('calltools.io')) {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: 'CHECK_CALL_STATUS',
          })
          setIsCallDetected(response?.isActive || false)
        } else {
          setIsCallDetected(false)
        }
      } catch (error) {
        setIsCallDetected(false)
      }
    }

    if (userEmail && isCallToolsTab && !isCheckingTab) {
      checkCallStatus()
      pollInterval = window.setInterval(checkCallStatus, 2000)
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [userEmail, isCallToolsTab, isCheckingTab])

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'AUDIO_LEVEL') {
        if (message.level !== undefined) {
          useCallStore.setState({ audioLevel: message.level })
        }
      }
      if (message.type === 'CALL_STARTED') {
        useCallStore.getState().setCallState('active')
        console.log('✅ [Popup] State updated to ACTIVE')
      }
      if (message.type === 'CALL_ENDED') {
        useCallStore.getState().setCallState('inactive')
        console.log('✅ [Popup] State updated to INACTIVE')
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  const handleLogin = (email: string, ccEmail?: string) => {
    const envKey = import.meta.env.VITE_DEEPGRAM_API_KEY || ''
    chrome.storage.local.set({ userEmail: email, userCcEmail: ccEmail, deepgramApiKey: envKey }, () => {
      setUserEmail(email)
      setUserCcEmail(ccEmail || null)
      console.log('✅ [Popup] User logged in:', email, 'CC:', ccEmail)
    })
  }

  const handleLogout = () => {
    if (
      confirm(
        'Are you sure you want to logout? This will stop all active coaching sessions.'
      )
    ) {
      if (audioState === 'capturing') {
        handleStopCoaching()
      }

      chrome.storage.local.remove(['userEmail', 'userCcEmail'], () => {
        setUserEmail(null)
        setUserCcEmail(null)
        console.log('✅ [Popup] User logged out')
      })
    }
  }

  const handleStartCoaching = async () => {
    try {
      setIsStarting(true)

      chrome.storage.local.set({ hasUsedBefore: true })
      setHasUsedBefore(true)

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })

      if (!tab?.id) {
        alert('Could not identify current tab')
        setIsStarting(false)
        return
      }

      if (!tab.url?.includes('calltools.io')) {
        alert('Please navigate to CallTools agent page first')
        setIsStarting(false)
        return
      }

      console.log('✅ [Popup] Starting AI coaching (will activate when call begins)')

      chrome.runtime.sendMessage(
        {
          type: 'START_COACHING_FROM_POPUP',
          tabId: tab.id,
          timestamp: Date.now(),
          userEmail: userEmail,
        },
        response => {
          console.log('✅ [Popup] Background acknowledged:', response)
          setIsStarting(false)
        }
      )

      // FIX: Add proper null check for windowId
      if (chrome.sidePanel && tab.windowId !== undefined) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId })
          console.log('✅ [Popup] Side panel opened successfully')
          // Close popup so agent doesn't re-click Start Coaching
          window.close()
        } catch (sidePanelError) {
          console.warn('⚠️ [Popup] Could not open side panel:', sidePanelError)
          // Side panel might already be open, this is not critical
        }
      } else {
        console.warn(
          '⚠️ [Popup] Cannot open side panel: Invalid window ID or API not available'
        )
      }
    } catch (error) {
      console.error('❌ [Popup] Start coaching failed:', error)
      alert('Failed to start coaching. Please try again.')
      setIsStarting(false)
    }
  }

  const handleStopCoaching = async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })

      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'STOP_COACHING' }).catch(() => {
          console.warn('⚠️ [Popup] Could not reach content script')
        })
      }

      chrome.runtime.sendMessage({
        type: 'CALL_ENDED',
        timestamp: Date.now(),
      })

      useCallStore.getState().setCallState('inactive')
      useCallStore.getState().setAudioState('idle')
      console.log('✅ [Popup] Coaching stopped manually')
    } catch (error) {
      console.error('❌ [Popup] Stop coaching failed:', error)
    }
  }

  const handleSimulateCallStart = async () => {
    console.log('🧪 [Popup] Simulating call start')

    // Simulate CALL_STARTED message
    chrome.runtime.sendMessage({
      type: 'CALL_STARTED',
      timestamp: Date.now(),
    })

    // Update local state
    setIsCallDetected(true)

    alert('✅ Test call started!\n\nThe extension now thinks a call is active.\nClick "Start AI Coaching" to test the flow.')
  }

  const handleSimulateCallEnd = async () => {
    console.log('🧪 [Popup] Simulating call end')

    // Simulate CALL_ENDED message
    chrome.runtime.sendMessage({
      type: 'CALL_ENDED',
      timestamp: Date.now(),
    })

    // Update local state
    setIsCallDetected(false)

    alert('✅ Test call ended!\n\nData should be retained for review.')
  }

  const handleToggleDeveloperMode = async () => {
    const newValue = !developerModeEnabled
    setDeveloperModeEnabled(newValue)

    chrome.storage.local.set({ developerModeEnabled: newValue }, () => {
      console.log(`🔧 [Popup] Developer Mode: ${newValue ? 'ENABLED' : 'DISABLED'}`)
    })

    // Notify sidepanel to show/hide developer mode
    chrome.runtime.sendMessage({
      type: 'DEVELOPER_MODE_CHANGED',
      enabled: newValue,
      timestamp: Date.now(),
    }).catch(() => {
      console.warn('⚠️ [Popup] Could not notify sidepanel of dev mode change')
    })

    // If enabling, open sidepanel directly (must be from user gesture context)
    if (newValue && chrome.sidePanel) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.windowId) {
          await chrome.sidePanel.open({ windowId: tab.windowId })
          console.log('✅ [Popup] Opened sidepanel for Sandbox Mode')
        }
      } catch (error) {
        console.warn('⚠️ [Popup] Could not open sidepanel:', error)
      }
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="w-80 p-6 bg-white">
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-[#1B1F6B] border-t-transparent rounded-full mx-auto"></div>
          <p className="text-sm text-[#757575] mt-4">Loading...</p>
        </div>
      </div>
    )
  }

  if (!userEmail) {
    return <Login onLogin={handleLogin} />
  }

  if (isCheckingTab) {
    return (
      <div className="w-80 p-6 bg-white">
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-[#1B1F6B] border-t-transparent rounded-full mx-auto"></div>
          <p className="text-sm text-[#757575] mt-4">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isCallToolsTab) {
    return (
      <div className="w-80 p-6 bg-white">
        <div className="text-center py-8">
          <img src={new URL('../assets/simplebiz-logo.png', import.meta.url).href} alt="Simple.Biz" className="h-10 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#1B1F6B] mb-2">
            CallTools Only
          </h3>
          <p className="text-sm text-[#757575] leading-relaxed mb-4">
            This extension only works on the CallTools.io platform.
          </p>
          <div className="p-3 bg-white border border-[#dddddd] rounded-lg mb-4">
            <p className="text-xs text-gray-500">
              💡 Navigate to CallTools agent dashboard to activate coaching
              features
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="w-full py-2 px-4 bg-[#F5F7FA] hover:bg-white text-[#333333] text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 border border-[#dddddd]"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </div>
    )
  }

  const isRecording = audioState === 'capturing' // ← Fixed: Check audioState, not callState

  return (
    <div className="w-80 max-h-[600px] overflow-y-auto bg-white text-[#333333]">
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <img src={new URL('../assets/simplebiz-logo.png', import.meta.url).href} alt="Simple.Biz" className="h-7" />
            <div>
              <h1 className="text-lg font-bold text-[#1B1F6B]">Call Coach</h1>
              <p className="text-xs text-[#757575]">Real-time AI coaching</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4 text-[#757575]" />
          </button>
        </div>

        <div className="mt-2 text-xs text-gray-500 space-y-0.5">
          <div className="flex items-center justify-between">
            <div>Logged in as: <span className="text-[#1B1F6B]">{userEmail}</span></div>
          </div>
          <div className="flex items-center justify-between mt-1">
            {userCcEmail ? (
              <div className="flex items-center gap-2">
                <span>CC: <span className="text-[#757575]">{userCcEmail}</span></span>
                <button 
                  onClick={() => {
                    const newCc = prompt('Update CC Email:', userCcEmail);
                    if (newCc !== null) {
                      handleLogin(userEmail!, newCc);
                    }
                  }}
                  className="text-xs text-[#1B1F6B] hover:text-[#1B1F6B]/80 underline"
                >
                  Edit
                </button>
              </div>
            ) : (
              <button 
                onClick={() => {
                  const newCc = prompt('Enter CC Email for Reports:');
                  if (newCc) {
                    handleLogin(userEmail!, newCc);
                  }
                }}
                className="text-xs text-gray-500 hover:text-[#1B1F6B] flex items-center gap-1 transition-colors"
              >
                + Add CC Email
              </button>
            )}
          </div>
        </div>
      </div>

      {!hasUsedBefore && !isRecording && (
        <div className="px-6 pb-4">
          <div className="bg-[#1B1F6B]/10 border border-[#1B1F6B]/30 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-[#1B1F6B] mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              How to Use
            </h3>
            <ol className="text-xs text-[#757575] space-y-2">
              <li className="flex gap-2">
                <span className="font-bold text-[#1B1F6B]">1.</span>
                <span>Start or answer a call in CallTools</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#1B1F6B]">2.</span>
                <span>
                  Click the <strong>"Start AI Coaching"</strong> button below
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#1B1F6B]">3.</span>
                <span>
                  The side panel will open with live transcription and AI tips
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}

      <div className="px-6 pb-4">
        <div className="p-4 bg-white rounded-lg border border-[#dddddd]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Recording Status</span>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isRecording ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                }`}
              />
              <span className="text-xs text-[#757575]">
                {isRecording ? 'Recording' : 'Inactive'}
              </span>
            </div>
          </div>

          {isRecording && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-3 h-3 text-[#757575]" />
                <span className="text-xs text-[#757575]">Audio Level</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-100"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {!isRecording && (
        <div className="px-6 pb-4">
          <button
            onClick={handleStartCoaching}
            disabled={isStarting}
            className={`w-full py-3 px-4 ${
              !isStarting
                ? 'bg-[#1B1F6B] hover:bg-[#14174f] shadow-lg hover:shadow-[#1B1F6B]/20'
                : 'bg-gray-600 cursor-not-allowed opacity-50'
            } text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:cursor-not-allowed`}
          >
            <Mic className="w-5 h-5" />
            {isStarting ? 'Starting...' : 'Start AI Coaching'}
          </button>
          <p className="text-xs text-center text-gray-500 mt-2">
            {isCallDetected
              ? '✓ Call detected - Ready to coach'
              : '💡 Start before your call to capture from the beginning'}
          </p>
        </div>
      )}

      {isRecording && (
        <div className="px-6 pb-4">
          <div className="space-y-3">
            <div className="p-3 bg-[#1B1F6B]/10 border border-[#1B1F6B]/30 rounded-lg">
              <p className="text-sm text-[#1B1F6B] font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Coaching Active
              </p>
              <p className="text-xs text-[#757575] mt-1">
                AI is listening and providing real-time tips
              </p>
            </div>

            <SessionStats
              transcriptions={transcriptions}
              coachingTips={coachingTips}
              session={session}
              callState={callState}
              compact
            />

            <button
              onClick={() => {
                if (chrome.sidePanel) {
                  chrome.tabs.query(
                    { active: true, currentWindow: true },
                    tabs => {
                      if (tabs[0]?.windowId) {
                        chrome.sidePanel.open({ windowId: tabs[0].windowId })
                      }
                    }
                  )
                }
              }}
              className="w-full py-2 px-4 bg-[#F5F7FA] hover:bg-white text-[#333333] text-sm font-medium rounded-lg transition-all duration-200 border border-[#dddddd]"
            >
              Open Coaching Panel
            </button>

            <button
              onClick={handleStopCoaching}
              className="w-full py-2 px-4 bg-[#D0021B] hover:bg-[#b0011a] text-white text-sm font-medium rounded-lg transition-all duration-200"
            >
              Stop Coaching
            </button>
          </div>
        </div>
      )}

      {/* Developer Mode Toggle Footer */}
      <div className="px-6 pb-6 pt-4 border-t border-[#dddddd]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[#757575]" />
            <span className="text-sm text-[#333333]">Developer Mode</span>
            {developerModeEnabled && (
              <span className="text-xs px-2 py-0.5 bg-[#1B1F6B]/20 text-[#1B1F6B] rounded-full border border-[#1B1F6B]/30 font-semibold">
                SANDBOX
              </span>
            )}
          </div>
          <button
            onClick={handleToggleDeveloperMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              developerModeEnabled ? 'bg-[#1B1F6B]' : 'bg-gray-300'
            }`}
            aria-label="Toggle Developer Mode"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                developerModeEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {developerModeEnabled && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-gray-500">
              🔧 Test Controls (No real call needed)
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSimulateCallStart}
                className="flex-1 px-3 py-2 bg-[#1B1F6B]/20 hover:bg-[#1B1F6B]/30 text-[#1B1F6B] text-xs rounded border border-[#1B1F6B]/50 transition-colors"
              >
                📞 Simulate Call Start
              </button>
              <button
                onClick={handleSimulateCallEnd}
                className="flex-1 px-3 py-2 bg-[#D0021B]/20 hover:bg-[#D0021B]/30 text-[#D0021B] text-xs rounded border border-[#D0021B]/50 transition-colors"
              >
                🔴 Simulate Call End
              </button>
            </div>
            <p className="text-xs text-[#757575] italic">
              Click "Simulate Call Start" then "Start AI Coaching"
            </p>

            {/* Mic Test */}
            <div className="mt-3 p-3 bg-[#F5F7FA] rounded-lg border border-[#dddddd]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-[#1B1F6B]" />
                  <span className="text-xs font-semibold text-[#333333]">Mic Test</span>
                </div>
                <button
                  onClick={micTesting ? stopMicTest : startMicTest}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                    micTesting
                      ? 'bg-[#D0021B] hover:bg-[#b0011a] text-white'
                      : 'bg-[#1B1F6B] hover:bg-[#14174f] text-white'
                  }`}
                >
                  {micTesting ? 'Stop' : 'Start'}
                </button>
              </div>

              {micTesting && (
                <>
                  {/* Audio Level */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[#757575]">Audio Level</span>
                      <span className="text-[10px] font-medium text-[#333333]">{micLevel}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-100 ${
                          micLevel > 50 ? 'bg-green-500' : micLevel > 10 ? 'bg-[#1B1F6B]' : 'bg-gray-400'
                        }`}
                        style={{ width: `${micLevel}%` }}
                      />
                    </div>
                  </div>

                  {/* Live Transcription */}
                  <div className="p-2 bg-white rounded border border-[#dddddd] min-h-[40px]">
                    <div className="text-[10px] text-[#757575] mb-1">Live Transcription</div>
                    <p className="text-xs text-[#333333] italic">
                      {micTranscript || 'Speak to see transcription...'}
                    </p>
                  </div>
                </>
              )}

              {micError && (
                <p className="text-xs text-[#D0021B] mt-1">{micError}</p>
              )}
            </div>
          </div>
        )}

        {/* Mic Permissions */}
        <button
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/permissions.html') })}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-[#757575] hover:text-[#1B1F6B] bg-[#F5F7FA] hover:bg-[#EFF3F6] rounded-lg border border-[#dddddd] transition-colors"
        >
          <Mic className="w-3.5 h-3.5" />
          Grant Microphone Access
        </button>
      </div>

    </div>
  )
}
