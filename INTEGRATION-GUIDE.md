# AI Coaching Integration Guide

This guide shows how to integrate the n8n AI coaching service with the Call Coach extension.

## Files Created

1. **n8n-workflow-coaching-demo.json** - n8n workflow configuration
2. **src/services/ai-coaching-service.ts** - AI coaching service module
3. **INTEGRATION-GUIDE.md** - This file

## Files Modified

1. **src/types/index.ts** - Added `aiCoachingEnabled` to Settings interface
2. **src/stores/settings-store.ts** - Added AI coaching toggle state
3. **src/background/index.ts** - Integrate coaching service (see below)
4. **src/popup/Popup.tsx** - Add AI coaching toggle (see below)
5. **src/sidepanel/SidePanel.tsx** - Display AI suggestions (see below)

---

## Step 1: Update Background Service Worker

### File: `src/background/index.ts`

#### Change 1: Add import at the top (after line 1)

```typescript
// Background Service Worker - ROBUST VERSION
console.log('🚀 [Background] Service worker started')

// Import AI coaching service
import { aiCoachingService } from '@/services/ai-coaching-service'
import type { CoachingSuggestion } from '@/services/ai-coaching-service'
```

#### Change 2: Initialize coaching service on startup (after line 262)

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

#### Change 3: Add listener for settings changes (after line 262)

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

#### Change 4: Call AI coaching service on transcriptions (replace lines 388-430)

Find this section:
```typescript
case 'TRANSCRIPTION_UPDATE':
```

Replace the entire case block with:

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
    speaker: message.speaker,  // 'caller' or 'agent'
  }

  extensionState.transcriptions.push(transcriptionEntry)

  // Sort by timestamp to maintain correct order (dual streams may arrive out of order)
  extensionState.transcriptions.sort((a, b) => a.timestamp - b.timestamp)

  // Keep last 100 transcriptions (increased from 50 for dual streams)
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

          // Broadcast to UI
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

  // Only generate basic tips from agent's speech (final transcripts)
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

#### Change 5: Add new message type for AI coaching tips (after line 460)

```typescript
case 'AI_LEVEL_UPDATE':
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

---

## Step 2: Update Popup to Add AI Coaching Toggle

### File: `src/popup/Popup.tsx`

#### Change 1: Add state for AI coaching (after line 15)

```typescript
export default function Popup() {
  const { audioState, audioLevel } = useCallStore()
  const [isStarting, setIsStarting] = useState(false)
  const [isCallToolsTab, setIsCallToolsTab] = useState(true)
  const [isCheckingTab, setIsCheckingTab] = useState(true)
  const [hasUsedBefore, setHasUsedBefore] = useState(false)
  const [isCallDetected, setIsCallDetected] = useState(false)
  const [isCheckingCall, setIsCheckingCall] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  // NEW: AI Coaching state
  const [aiCoachingEnabled, setAiCoachingEnabled] = useState(false)
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState('')
```

#### Change 2: Load AI coaching settings on mount (after line 24)

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

#### Change 3: Add toggle handler

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

#### Change 4: Add AI coaching section in UI (before the "Start AI Coaching" button, around line 391)

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

---

## Step 3: Update SidePanel to Display AI Suggestions

### File: `src/sidepanel/SidePanel.tsx`

#### Change 1: Add state for AI suggestions (after line 18)

```typescript
const [deepgramStatus, setDeepgramStatus] =
  useState<DeepgramStatus>("disconnected");

// NEW: AI coaching suggestions state
const [aiSuggestions, setAiSuggestions] = useState<Array<{
  text: string
  timestamp: number
  speaker: string
}>>([])
```

#### Change 2: Handle AI coaching messages (in handleMessage function, after line 160)

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

case "AI_COACHING_TIP":
  // NEW: Handle AI coaching suggestions
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

#### Change 3: Add AI Suggestions display section (after the Coaching Tips section, around line 440)

```tsx
{/* AI Suggestions Section (NEW) */}
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
          className="p-3 bg-white/10 backdrop-blur-sm rounded-lg border border-purple-400/20 hover:border-purple-400/40 transition-colors"
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

---

## Step 4: AWS EC2 + n8n Setup Guide

### Prerequisites

- AWS account with EC2 access
- SSH client (Terminal on Mac/Linux, PuTTY on Windows)
- Domain name (optional, for HTTPS)

### 1. Launch EC2 Instance

```bash
# Instance type: t3.medium (2 vCPU, 4GB RAM)
# OS: Ubuntu 22.04 LTS
# Storage: 20GB gp3
# Security Group: Allow ports 22 (SSH), 5678 (n8n), 443 (HTTPS optional)
```

### 2. Connect and Install Docker

```bash
# Connect to instance
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker ubuntu

# Log out and log back in for group changes to take effect
exit
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
```

### 3. Run n8n

```bash
# Create data directory
mkdir -p ~/.n8n

# Run n8n container
docker run -d \\
  --name n8n \\
  -p 5678:5678 \\
  -v ~/.n8n:/home/node/.n8n \\
  --restart unless-stopped \\
  n8nio/n8n

# Check if running
docker ps

# View logs
docker logs -f n8n
```

### 4. Access n8n

Open browser and go to: `http://YOUR_EC2_IP:5678`

- Create admin account
- Set up OpenAI credentials:
  1. Click user icon (top right) → Settings → Credentials
  2. Click "Add Credential"
  3. Search for "OpenAI"
  4. Enter your OpenAI API key
  5. Save

### 5. Import Workflow

1. Go to Workflows → "+" → Import from File
2. Select `n8n-workflow-coaching-demo.json`
3. Update the OpenAI node credentials
4. Click "Save" and "Activate"

### 6. Get Webhook URL

1. Click on the "Webhook Trigger" node
2. Copy the "Test URL" or "Production URL"
3. It will look like: `http://YOUR_EC2_IP:5678/webhook/coaching`
4. Paste this URL in the extension popup settings

### 7. Test the Integration

```bash
# Test webhook manually
curl -X POST http://YOUR_EC2_IP:5678/webhook/coaching \\
  -H "Content-Type: application/json" \\
  -d '{
    "transcript": "This seems too expensive for our budget",
    "speaker": "caller",
    "timestamp": 1234567890,
    "conversationHistory": []
  }'
```

You should receive a JSON response with coaching suggestions!

### 8. (Optional) Set up HTTPS

For production, use nginx + Let's Encrypt:

```bash
# Install nginx and certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Configure nginx reverse proxy
sudo nano /etc/nginx/sites-available/n8n

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

---

## Testing the Complete Integration

1. **Start CallTools call**
2. **Open extension popup** and:
   - Toggle "AI Coaching" ON
   - Enter your n8n webhook URL
   - Click "Start AI Coaching"
3. **Speak during call** (as agent or caller)
4. **Check side panel** for:
   - Live transcriptions
   - Basic coaching tips (pattern-based)
   - AI suggestions (purple cards with suggestions)

---

## Troubleshooting

### No AI suggestions appearing

- Check browser console for errors
- Verify n8n webhook URL is correct
- Check n8n logs: `docker logs -f n8n`
- Verify OpenAI API key is configured in n8n
- Check EC2 security group allows port 5678

### AI suggestions are slow

- Normal latency: 2-5 seconds (Deepgram → n8n → OpenAI → Extension)
- If slower, check:
  - EC2 instance region (closer to you = faster)
  - OpenAI API status
  - Network connectivity

### Webhook errors

```bash
# Check n8n is running
docker ps

# Restart n8n if needed
docker restart n8n

# Check firewall
sudo ufw status
sudo ufw allow 5678
```

---

## Cost Estimates (for demo/testing)

- **EC2 t3.medium**: ~$30/month (can stop when not testing)
- **Deepgram**: ~$0.0043/min × 10 hours = ~$2.50
- **OpenAI GPT-3.5-turbo**: ~$0.002/request × 100 calls = ~$0.20
- **Total for demo**: ~$33/month (EC2 running full-time) or ~$3 (EC2 stopped when not testing)

---

## Next Steps

After successful demo:

1. **Scale to production**: Migrate to Lambda + API Gateway (serverless)
2. **Add authentication**: Secure webhook endpoint
3. **Implement caching**: Store suggestions to reduce API costs
4. **Add analytics**: Track coaching effectiveness
5. **Custom prompts**: Allow users to customize coaching style

---

## Support

For issues or questions:
1. Check Chrome DevTools console for errors
2. Check n8n execution logs in the workflow
3. Check EC2 system logs: `docker logs n8n`
