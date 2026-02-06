import { useEffect, useState } from 'react'
import { Phone, Mic, Activity, CheckCircle, LogOut, Settings2 } from 'lucide-react'
import { useCallStore } from '@/stores/call-store'
import Login from './Login'

export default function Popup() {
  const { audioState, audioLevel } = useCallStore() // ← Added audioState
  const [isStarting, setIsStarting] = useState(false)
  const [isCallToolsTab, setIsCallToolsTab] = useState(true)
  const [isCheckingTab, setIsCheckingTab] = useState(true)
  const [hasUsedBefore, setHasUsedBefore] = useState(false)
  const [isCallDetected, setIsCallDetected] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userCcEmail, setUserCcEmail] = useState<string | null>(null) // Added
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(['userEmail', 'userCcEmail', 'developerModeEnabled'], result => {
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

    chrome.storage.local.get(['hasUsedBefore'], result => {
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
    chrome.storage.local.set({ userEmail: email, userCcEmail: ccEmail }, () => {
      setUserEmail(email)
      setUserCcEmail(ccEmail || null)
      chrome.storage.local.set({
        deepgramApiKey: 'e06e624c52e5974a4e5162b3c93306ecdda52bc9',
      })
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
      <div className="w-80 p-6 bg-gradient-to-br from-gray-900 to-gray-800">
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-sm text-gray-400 mt-4">Loading...</p>
        </div>
      </div>
    )
  }

  if (!userEmail) {
    return <Login onLogin={handleLogin} />
  }

  if (isCheckingTab) {
    return (
      <div className="w-80 p-6 bg-gradient-to-br from-gray-900 to-gray-800">
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-sm text-gray-400 mt-4">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isCallToolsTab) {
    return (
      <div className="w-80 p-6 bg-gradient-to-br from-gray-900 to-gray-800">
        <div className="text-center py-8">
          <div className="p-4 bg-purple-500/10 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <Phone className="w-10 h-10 text-purple-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            CallTools Only
          </h3>
          <p className="text-sm text-gray-400 leading-relaxed mb-4">
            This extension only works on the CallTools.io platform.
          </p>
          <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg mb-4">
            <p className="text-xs text-gray-500">
              💡 Navigate to CallTools agent dashboard to activate coaching
              features
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
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
    <div className="w-80 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Phone className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Simple.Biz Call Coach</h1>
              <p className="text-xs text-gray-400">Real-time AI coaching</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="mt-2 text-xs text-gray-500 space-y-0.5">
          <div className="flex items-center justify-between">
            <div>Logged in as: <span className="text-purple-400">{userEmail}</span></div>
          </div>
          <div className="flex items-center justify-between mt-1">
            {userCcEmail ? (
              <div className="flex items-center gap-2">
                <span>CC: <span className="text-gray-400">{userCcEmail}</span></span>
                <button 
                  onClick={() => {
                    const newCc = prompt('Update CC Email:', userCcEmail);
                    if (newCc !== null) {
                      handleLogin(userEmail!, newCc);
                    }
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 underline"
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
                className="text-xs text-gray-500 hover:text-purple-400 flex items-center gap-1 transition-colors"
              >
                + Add CC Email
              </button>
            )}
          </div>
        </div>
      </div>

      {!hasUsedBefore && !isRecording && (
        <div className="px-6 pb-4">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-blue-400 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              How to Use
            </h3>
            <ol className="text-xs text-gray-300 space-y-2">
              <li className="flex gap-2">
                <span className="font-bold text-blue-400">1.</span>
                <span>Start or answer a call in CallTools</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-blue-400">2.</span>
                <span>
                  Click the <strong>"Start AI Coaching"</strong> button below
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-blue-400">3.</span>
                <span>
                  The side panel will open with live transcription and AI tips
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}

      <div className="px-6 pb-4">
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Recording Status</span>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isRecording ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                }`}
              />
              <span className="text-xs text-gray-400">
                {isRecording ? 'Recording' : 'Inactive'}
              </span>
            </div>
          </div>

          {isRecording && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-400">Audio Level</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
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
                ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 shadow-lg hover:shadow-green-500/20'
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
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm text-green-400 font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Coaching Active
              </p>
              <p className="text-xs text-gray-400 mt-1">
                AI is listening and providing real-time tips
              </p>
            </div>

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
              className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-all duration-200"
            >
              Open Coaching Panel
            </button>

            <button
              onClick={handleStopCoaching}
              className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-all duration-200"
            >
              Stop Coaching
            </button>
          </div>
        </div>
      )}

      {/* Developer Mode Toggle Footer */}
      <div className="px-6 pb-6 pt-4 border-t border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-300">Developer Mode</span>
            {developerModeEnabled && (
              <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/30 font-semibold">
                SANDBOX
              </span>
            )}
          </div>
          <button
            onClick={handleToggleDeveloperMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              developerModeEnabled ? 'bg-blue-600' : 'bg-gray-600'
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
                className="flex-1 px-3 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs rounded border border-green-600/50 transition-colors"
              >
                📞 Simulate Call Start
              </button>
              <button
                onClick={handleSimulateCallEnd}
                className="flex-1 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs rounded border border-red-600/50 transition-colors"
              >
                🔴 Simulate Call End
              </button>
            </div>
            <p className="text-xs text-gray-400 italic">
              Click "Simulate Call Start" then "Start AI Coaching"
            </p>
          </div>
        )}
      </div>

    </div>
  )
}
