# Code Changes Review - AI Coaching Integration

This document shows the **exact changes** needed for the AI coaching integration.

Review each change and approve/deny before I apply them.

---

## Change #1: Background Service Worker

**File:** `src/background/index.ts`

### Change 1.1: Add Import (Line 3, after console.log)

**ADD these lines:**
```typescript
// Import AI coaching service
import { aiCoachingService } from '@/services/ai-coaching-service'
import type { CoachingSuggestion } from '@/services/ai-coaching-service'
```

**Why:** Import the AI coaching service module we created

---

### Change 1.2: Initialize Service on Startup (Line 262, in onStartup listener)

**FIND:**
```typescript
chrome.runtime.onStartup.addListener(() => {
  console.log('🔄 [Background] Startup - initializing')
  startKeepAlive()
})
```

**REPLACE WITH:**
```typescript
chrome.runtime.onStartup.addListener(() => {
  console.log('🔄 [Background] Startup - initializing')
  startKeepAlive()

  // Initialize AI coaching service
  aiCoachingService.initialize().catch(error => {
    console.error('❌ [Background] Failed to initialize AI coaching:', error)
  })
})
```

**Why:** Initialize the AI coaching service when the extension starts

---

### Change 1.3: Listen for Settings Changes (Line 264, after onStartup)

**ADD this new listener:**
```typescript
// Listen for settings changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.aiCoachingEnabled || changes.n8nWebhookUrl) {
      console.log('⚙️ [Background] AI coaching settings changed, reinitializing...')
      aiCoachingService.initialize().catch(error => {
        console.error('❌ [Background] Failed to reinitialize AI coaching:', error)
      })
    }
  }
})
```

**Why:** Reinitialize the service when user changes AI coaching settings

---

### Change 1.4: Add AI Coaching to Transcription Handler (Line 388-430)

**FIND this case block:**
```typescript
case 'TRANSCRIPTION_UPDATE':
  const speaker = message.speaker || 'unknown'
  console.log(
    `📝 [Background] Transcription from ${speaker.toUpperCase()} (${
      message.isFinal ? 'FINAL' : 'INTERIM'
    }): ${message.transcript}`
  )

  const transcriptionEntry: TranscriptionEntry = {
    transcript: message.transcript,
    isFinal: message.isFinal,
    timestamp: message.timestamp,
    confidence: message.confidence || 0,
    speaker: message.speaker,
  }

  extensionState.transcriptions.push(transcriptionEntry)
  extensionState.transcriptions.sort((a, b) => a.timestamp - b.timestamp)

  if (extensionState.transcriptions.length > 100) {
    extensionState.transcriptions = extensionState.transcriptions.slice(-100)
  }

  await updateExtensionState({
    transcriptions: extensionState.transcriptions,
  })

  // Only generate coaching tips from agent's speech (final transcripts)
  if (message.isFinal && message.speaker === 'agent') {
    currentTranscriptBuffer.push(message.transcript)
    if (currentTranscriptBuffer.length > TRANSCRIPT_BUFFER_MAX) {
      currentTranscriptBuffer = currentTranscriptBuffer.slice(
        -TRANSCRIPT_BUFFER_MAX
      )
    }
    if (currentTranscriptBuffer.length % 3 === 0) {
      await generateCoachingTip(currentTranscriptBuffer.join(' '))
    }
  }
  break
```

**REPLACE WITH:**
```typescript
case 'TRANSCRIPTION_UPDATE':
  const speaker = message.speaker || 'unknown'
  console.log(
    `📝 [Background] Transcription from ${speaker.toUpperCase()} (${
      message.isFinal ? 'FINAL' : 'INTERIM'
    }): ${message.transcript}`
  )

  const transcriptionEntry: TranscriptionEntry = {
    transcript: message.transcript,
    isFinal: message.isFinal,
    timestamp: message.timestamp,
    confidence: message.confidence || 0,
    speaker: message.speaker,
  }

  extensionState.transcriptions.push(transcriptionEntry)
  extensionState.transcriptions.sort((a, b) => a.timestamp - b.timestamp)

  if (extensionState.transcriptions.length > 100) {
    extensionState.transcriptions = extensionState.transcriptions.slice(-100)
  }

  await updateExtensionState({
    transcriptions: extensionState.transcriptions,
  })

  // ========================================================================
  // AI COACHING INTEGRATION (NEW)
  // ========================================================================

  // Only process final transcriptions to reduce API costs
  if (message.isFinal) {
    // Get conversation history for context (last 10 messages)
    const conversationHistory = extensionState.transcriptions
      .filter(t => t.isFinal)
      .slice(-10)
      .map(t => ({
        speaker: t.speaker || 'unknown',
        text: t.transcript,
        timestamp: t.timestamp,
      }))

    // Call AI coaching service (async, non-blocking)
    aiCoachingService
      .getCoachingSuggestions({
        transcript: message.transcript,
        speaker: message.speaker,
        timestamp: message.timestamp,
        conversationHistory,
      })
      .then(aiSuggestion => {
        if (aiSuggestion) {
          console.log('🤖 [Background] AI coaching received:', aiSuggestion)

          // Broadcast AI coaching tip to UI
          const aiCoachingTip: CoachingTip = {
            tip: `${aiSuggestion.analysis}`,
            category: aiSuggestion.category === 'objection' ? 'warning' :
                     aiSuggestion.category === 'interest' ? 'positive' :
                     aiSuggestion.category === 'question' ? 'question' : 'suggestion',
            priority: aiSuggestion.priority === 'high' ? 'high' : 'normal',
            timestamp: aiSuggestion.timestamp,
          }

          extensionState.coachingTips.push(aiCoachingTip)

          // Broadcast to UI with suggestions
          broadcastToUI({
            type: 'AI_COACHING_TIP',
            tip: aiCoachingTip,
            suggestions: aiSuggestion.suggestions,
            speaker: message.speaker,
          })
        }
      })
      .catch(error => {
        console.error('❌ [Background] AI coaching error:', error)
      })
  }

  // ========================================================================
  // BASIC PATTERN MATCHING TIPS (Keep as fallback)
  // ========================================================================

  // Only generate coaching tips from agent's speech (final transcripts)
  if (message.isFinal && message.speaker === 'agent') {
    currentTranscriptBuffer.push(message.transcript)
    if (currentTranscriptBuffer.length > TRANSCRIPT_BUFFER_MAX) {
      currentTranscriptBuffer = currentTranscriptBuffer.slice(
        -TRANSCRIPT_BUFFER_MAX
      )
    }
    if (currentTranscriptBuffer.length % 3 === 0) {
      await generateCoachingTip(currentTranscriptBuffer.join(' '))
    }
  }
  break
```

**Why:**
- Calls AI coaching service when transcriptions arrive
- Sends conversation context (last 10 messages)
- Broadcasts AI suggestions to UI
- Keeps existing pattern-matching tips as fallback

---

### Change 1.5: Add Toggle Handler (Line 460, before default case)

**FIND:**
```typescript
case 'AUDIO_LEVEL_UPDATE':
  broadcastToUI({
    type: 'AUDIO_LEVEL',
    level: message.level,
  })
  break

default:
  console.warn('⚠️ [Background] Unknown message:', message.type)
```

**REPLACE WITH:**
```typescript
case 'AUDIO_LEVEL_UPDATE':
  broadcastToUI({
    type: 'AUDIO_LEVEL',
    level: message.level,
  })
  break

case 'TOGGLE_AI_COACHING':
  // Handle toggle from popup
  const enabled = message.enabled
  await chrome.storage.local.set({ aiCoachingEnabled: enabled })

  // Reinitialize service
  await aiCoachingService.initialize()

  console.log(`🤖 [Background] AI coaching ${enabled ? 'enabled' : 'disabled'}`)
  break

default:
  console.warn('⚠️ [Background] Unknown message:', message.type)
```

**Why:** Handle AI coaching toggle from popup

---

## Change #2: Popup Component

**File:** `src/popup/Popup.tsx`

### Change 2.1: Add AI Coaching State (Line 16, after existing state)

**FIND:**
```typescript
const [userEmail, setUserEmail] = useState<string | null>(null)
const [isCheckingAuth, setIsCheckingAuth] = useState(true)
```

**ADD AFTER:**
```typescript
// AI Coaching state
const [aiCoachingEnabled, setAiCoachingEnabled] = useState(false)
const [n8nWebhookUrl, setN8nWebhookUrl] = useState('')
```

**Why:** Track AI coaching settings in popup

---

### Change 2.2: Load AI Settings on Mount (Line 18)

**FIND:**
```typescript
useEffect(() => {
  chrome.storage.local.get(['userEmail'], result => {
    setUserEmail(result.userEmail || null)
    setIsCheckingAuth(false)
    if (result.userEmail) {
      console.log('📧 [Popup] User logged in:', result.userEmail)
    }
  })
}, [])
```

**REPLACE WITH:**
```typescript
useEffect(() => {
  chrome.storage.local.get(['userEmail', 'aiCoachingEnabled', 'n8nWebhookUrl'], result => {
    setUserEmail(result.userEmail || null)
    setAiCoachingEnabled(result.aiCoachingEnabled || false)
    setN8nWebhookUrl(result.n8nWebhookUrl || '')
    setIsCheckingAuth(false)
    if (result.userEmail) {
      console.log('📧 [Popup] User logged in:', result.userEmail)
    }
  })
}, [])
```

**Why:** Load AI coaching settings from storage

---

### Change 2.3: Add Toggle Handler (Line 128, after handleLogout)

**ADD this new function:**
```typescript
const handleToggleAICoaching = async (enabled: boolean) => {
  setAiCoachingEnabled(enabled)
  await chrome.storage.local.set({ aiCoachingEnabled: enabled })

  // Notify background
  chrome.runtime.sendMessage({
    type: 'TOGGLE_AI_COACHING',
    enabled,
  })

  console.log(`🤖 [Popup] AI coaching ${enabled ? 'enabled' : 'disabled'}`)
}
```

**Why:** Handle AI coaching toggle

---

### Change 2.4: Add AI Coaching UI Section (Line 391, BEFORE "Start AI Coaching" button)

**FIND:**
```typescript
{!isRecording && (
  <div className="px-6 pb-4">
    <button
      onClick={handleStartCoaching}
```

**ADD BEFORE the above block:**
```tsx
{/* AI Coaching Toggle Section */}
<div className="px-6 pb-4">
  <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
    <div className="flex items-center justify-between mb-3">
      <div>
        <h3 className="text-sm font-semibold text-white">AI Coaching</h3>
        <p className="text-xs text-gray-400 mt-1">
          Advanced AI suggestions via n8n
        </p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={aiCoachingEnabled}
          onChange={(e) => handleToggleAICoaching(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
      </label>
    </div>

    {aiCoachingEnabled && (
      <div className="mt-3 pt-3 border-t border-gray-700">
        <label className="text-xs text-gray-400 block mb-1">
          n8n Webhook URL
        </label>
        <input
          type="text"
          value={n8nWebhookUrl}
          onChange={(e) => {
            setN8nWebhookUrl(e.target.value)
            chrome.storage.local.set({ n8nWebhookUrl: e.target.value })
          }}
          placeholder="http://your-ec2-ip:5678/webhook/coaching"
          className="w-full px-3 py-2 bg-gray-700 text-white text-xs rounded border border-gray-600 focus:border-purple-500 focus:outline-none"
        />
        {!n8nWebhookUrl && (
          <p className="text-xs text-yellow-400 mt-2">
            ⚠️ Please configure webhook URL
          </p>
        )}
      </div>
    )}
  </div>
</div>
```

**Why:** Add UI for toggling AI coaching and configuring webhook URL

---

## Change #3: SidePanel Component

**File:** `src/sidepanel/SidePanel.tsx`

### Change 3.1: Add AI Suggestions State (Line 19, after deepgramStatus)

**FIND:**
```typescript
const [deepgramStatus, setDeepgramStatus] =
  useState<DeepgramStatus>("disconnected");
```

**ADD AFTER:**
```typescript
// AI coaching suggestions state
const [aiSuggestions, setAiSuggestions] = useState<Array<{
  text: string
  timestamp: number
  speaker: string
}>>([])
```

**Why:** Track AI suggestions separately from basic coaching tips

---

### Change 3.2: Handle AI Coaching Messages (Line 160, after COACHING_TIP case)

**FIND:**
```typescript
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
```

**ADD AFTER:**
```typescript
case "AI_COACHING_TIP":
  // Handle AI coaching suggestions
  const aiTip: CoachingTip = {
    id: message.tip.timestamp?.toString() || Date.now().toString(),
    type: message.tip.category || "suggestion",
    message: message.tip.tip,
    timestamp: message.tip.timestamp || Date.now(),
    priority: message.tip.priority || "normal",
  };
  useCallStore.getState().addCoachingTip(aiTip);

  // Store suggestions separately for display
  if (message.suggestions && message.suggestions.length > 0) {
    setAiSuggestions(prev => [
      ...prev,
      ...message.suggestions.map((s: string) => ({
        text: s,
        timestamp: message.tip.timestamp || Date.now(),
        speaker: message.speaker || 'unknown',
      }))
    ].slice(-10)) // Keep last 10 suggestions
  }

  console.log("🤖 [SidePanel] Added AI coaching tip with suggestions");
  break;
```

**Why:** Handle AI_COACHING_TIP messages and store suggestions separately

---

### Change 3.3: Add AI Suggestions Display (Line 440, AFTER Coaching Statistics section)

**FIND:**
```tsx
{/* Coaching Statistics */}
{stats && (
  <div className="p-4 bg-card rounded-lg border">
    ...
  </div>
)}
```

**ADD AFTER:**
```tsx
{/* AI Suggestions Section */}
{aiSuggestions.length > 0 && (
  <div className="p-4 bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-lg border border-purple-500/30">
    <div className="flex items-center gap-2 mb-3">
      <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
      </svg>
      <h2 className="font-semibold text-purple-100">AI Suggestions</h2>
      <span className="ml-auto text-xs text-purple-300">
        {aiSuggestions.length} suggestions
      </span>
    </div>
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {aiSuggestions.slice(-5).reverse().map((suggestion, index) => (
        <div
          key={`ai-${suggestion.timestamp}-${index}`}
          className="p-3 bg-white/10 backdrop-blur-sm rounded-lg border border-purple-400/20 hover:border-purple-400/40 transition-colors cursor-pointer"
        >
          <div className="flex items-start gap-2">
            <span className="text-purple-300 text-lg">💡</span>
            <div className="flex-1">
              <p className="text-sm text-white leading-relaxed">
                {suggestion.text}
              </p>
              <p className="text-xs text-purple-300/60 mt-1">
                {formatTime(suggestion.timestamp)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

**Why:** Display AI suggestions in purple gradient cards

---

## Summary of Changes

### Files Modified:
1. ✅ `src/background/index.ts` - 5 changes
2. ✅ `src/popup/Popup.tsx` - 4 changes
3. ✅ `src/sidepanel/SidePanel.tsx` - 3 changes

### Total Lines Changed:
- **Background**: ~80 lines added
- **Popup**: ~60 lines added
- **SidePanel**: ~50 lines added

### Risk Level: **LOW**
- All changes are additive (no existing functionality removed)
- Existing features continue to work
- AI coaching is opt-in (toggle off by default)
- Graceful degradation (works without n8n configured)

---

## Review Checklist

Before approving, verify:

- [ ] Import statements are correct
- [ ] No syntax errors in code
- [ ] Logic makes sense
- [ ] UI changes look good
- [ ] No breaking changes to existing features

---

## Next Steps After Approval

1. Apply changes to 3 files
2. Run `npm run build`
3. Load extension in Chrome
4. Test basic features (without AI first)
5. Set up n8n
6. Test AI coaching integration

**Ready to review? Check each change above and let me know if you approve!**
