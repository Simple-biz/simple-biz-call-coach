# DevAssist Call Coach - Project Context

**Last Updated:** 2025-12-17
**Version:** 1.0
**Purpose:** This is the definitive reference for AI-assisted development. Follow these patterns exactly.

---

## 🎯 PROJECT OVERVIEW

**DevAssist Call Coach** is a Chrome extension providing real-time AI-powered coaching for sales agents during CallTools calls.

**Core Workflow:**
1. **Agent** starts call on CallTools platform
2. **WebRTC Capture** → Deepgram transcription (dual-channel: caller + agent)
3. **AI Analysis** → GPT-4o-mini generates coaching tips (AWS backend)
4. **Side Panel Display** → Real-time tips with 2-word headings + suggestions
5. **Progressive Analysis** → 3-min warmup, then continuous 30-second updates

**Design Philosophy:** Conversation-first coaching that keeps discussions flowing naturally, builds rapport, and maintains engagement. NOT pushy sales tactics. Premium, polished UI with smooth animations.

**Success Metrics:**
- AI tips appear within 3 seconds of analysis trigger
- <$0.10 per call in LLM costs
- 99.9% uptime during business hours
- Zero disruption to existing transcription features

---

## 🛠 TECH STACK

### Frontend (Chrome Extension)
- **React:** 19.2.0
- **TypeScript:** 5.9.3 (strict mode enabled)
- **Vite:** 7.1.12 (build tool + dev server)
- **@crxjs/vite-plugin:** 2.2.1 (Chrome extension bundler)

### Styling
- **Tailwind CSS:** 4.1.16 (utility-first styling)
- **PostCSS:** 8.5.6
- **Framer Motion:** 12.23.24 (animations)

### State Management
- **Zustand:** 5.0.8 (lightweight state)
- **chrome.storage.local** (persistence across sessions)

### Real-time Communication
- **Socket.io-client:** 4.8.1 (WebSocket to AWS backend)
- **Deepgram SDK** (WebRTC transcription, dual-channel)

### UI Components
- **Lucide React:** 0.548.0 (icons)
- **class-variance-authority:** 0.7.1 (component variants)
- **clsx + tailwind-merge:** Conditional classNames

### Chrome Extension APIs
- **Manifest V3** (service worker architecture)
- **tabCapture** (audio stream capture)
- **offscreen** (Deepgram WebSocket connection)
- **sidePanel** (coaching UI display)
- **chrome.storage** (settings + state persistence)

### Backend (AWS - Separate Repository)
- **Node.js 20** (Express + TypeScript)
- **Socket.io 4.x** (WebSocket server)
- **OpenAI GPT-4o-mini** (AI analysis)
- **PostgreSQL 15** (conversation storage)
- **AWS Elastic Beanstalk** (hosting)

---

## 🏗 ARCHITECTURE PATTERNS

### Chrome Extension Structure (Manifest V3)
```
src/
├── manifest.json                    # Extension config (permissions, scripts)
├── background/
│   └── index.ts                     # Service worker (WebSocket orchestration)
├── content/
│   ├── index.ts                     # Content script injector
│   └── webrtc-bridge.ts             # WebRTC audio capture bridge
├── injected/
│   ├── webrtc-interceptor.ts        # Intercepts getUserMedia calls
│   └── audio-processor.ts           # Audio processing worklet
├── offscreen/
│   └── index.ts                     # Deepgram WebSocket (offscreen document)
├── sidepanel/
│   ├── SidePanel.tsx                # Main side panel UI
│   └── components/                  # Side panel components
├── popup/
│   ├── Popup.tsx                    # Extension popup (login/settings)
│   └── Login.tsx                    # Authentication
├── services/
│   ├── ai-backend.service.ts        # WebSocket client for AI backend
│   └── ai-coaching-service.ts       # AI integration logic
├── stores/
│   ├── call-store.ts                # Zustand store (call state + AI tips)
│   └── settings-store.ts            # User settings store
├── components/
│   └── AITipsSection.tsx            # AI tips display component
└── types/
    └── index.ts                     # TypeScript type definitions
```

### Extension Lifecycle Flow
```
1. CallTools page loads → Content script injected
2. Content script injects webrtc-interceptor.ts into page context
3. User starts call → WebRTC capture begins
4. Background service worker:
   - Creates offscreen document for Deepgram
   - Connects to AI backend WebSocket
   - Forwards transcripts to backend
5. AI backend analyzes → sends tips back via WebSocket
6. Background stores tips in call-store
7. Side panel reactively displays tips
```

### WebSocket Communication Flow
```
Extension Background ←WebSocket→ AWS Backend ←REST→ OpenAI GPT-4o-mini
                                    ↓
                                PostgreSQL (conversation state)
```

**Message Protocol:**
- `START_CONVERSATION` → Backend assigns conversationId
- `TRANSCRIPT` → Extension sends transcription chunks
- `AI_TIP` → Backend sends coaching recommendations
- `STATUS_UPDATE` → Backend status (loading/ready/error)
- `RESUME_CONVERSATION` → Reconnect to existing session

---

## 🗄 DATA ARCHITECTURE

### Zustand Store Schema (call-store.ts)

```typescript
interface CallStore {
  // Call state
  session: CallSession | null
  callState: 'inactive' | 'active' | 'ending'
  audioState: 'idle' | 'capturing' | 'processing'
  audioLevel: number

  // Transcription (Deepgram)
  transcriptions: Transcription[]
  deepgramStatus: 'disconnected' | 'connected' | 'error'

  // AI Backend (NEW - additive only)
  aiBackendStatus: 'disconnected' | 'connecting' | 'ready' | 'error' | 'reconnecting'
  aiTips: AIRecommendation[]
  aiConversationId: string | null
  lastAIUpdate: number | null

  // Legacy coaching tips (pre-AI)
  coachingTips: CoachingTip[]
}
```

### Type Definitions (types/index.ts)

```typescript
interface Transcription {
  speaker: 'caller' | 'agent'
  text: string
  timestamp: number
  isFinal: boolean
}

interface AIRecommendation {
  conversationId: string
  heading: string          // Max 2 words (e.g., "Ask More", "Build Trust")
  suggestion: string       // One actionable sentence
  timestamp: number        // Unix timestamp (milliseconds)
}

type AIBackendStatus =
  | 'disconnected'  // Not connected
  | 'connecting'    // Initial connection
  | 'ready'         // Connected and receiving tips
  | 'error'         // Connection failed
  | 'reconnecting'  // Auto-reconnecting after disconnect
```

### Backend Database Schema (PostgreSQL)

```sql
conversations (
  id UUID PRIMARY KEY,
  agent_id VARCHAR,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  status VARCHAR,
  metadata JSONB
)

transcripts (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations,
  speaker VARCHAR,          -- 'caller' or 'agent'
  text TEXT,
  timestamp TIMESTAMP,
  is_final BOOLEAN
)

ai_recommendations (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations,
  heading VARCHAR(20),      -- Max 2 words
  suggestion TEXT,
  created_at TIMESTAMP
)

conversation_summaries (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations,
  time_range VARCHAR,       -- e.g., '0-10min'
  summary TEXT,
  created_at TIMESTAMP
)
```

**Data Retention:** 30 days rolling deletion (daily cron job).

---

## 📐 CODE CONVENTIONS

### File Naming
- **Components:** PascalCase → `AITipsSection.tsx`, `SidePanel.tsx`
- **Services:** kebab-case → `ai-backend.service.ts`, `ai-coaching-service.ts`
- **Stores:** kebab-case → `call-store.ts`, `settings-store.ts`
- **Types:** `index.ts` (centralized in types/ folder)
- **Tests:** `{filename}.test.ts` (placed in tests/ folder, NOT co-located)

### TypeScript Patterns
- **Strict mode enabled** - All types required, no implicit any
- **Interface over type** for object shapes
- **Path alias:** `@/*` resolves to `src/*`
- **Type imports:** `import type { ... }` for type-only imports
- **Enums:** PascalCase with SCREAMING_SNAKE_CASE values

```typescript
// Good
import type { AIRecommendation, CallState } from '@/types'
import { useCallStore } from '@/stores/call-store'

interface Props {
  tip: AIRecommendation
  onClose: () => void
}

export function TipCard({ tip, onClose }: Props) {
  // Component logic
}
```

### Naming Conventions (From Architecture Doc)

**TypeScript Code:**
- **Interfaces/Types:** `PascalCase` → `AIRecommendation`, `ConversationState`
- **Functions:** `camelCase` → `analyzeTranscript`, `connectToBackend`
- **Variables:** `camelCase` → `conversationId`, `aiStatus`
- **Constants:** `SCREAMING_SNAKE_CASE` → `MAX_RETRY_ATTEMPTS`, `WARMUP_DURATION_MS`

**Database (Backend):**
- **Tables:** `lowercase_snake_case` → `conversations`, `ai_recommendations`
- **Columns:** `lowercase_snake_case` → `agent_id`, `created_at`
- **JSONB fields:** `camelCase` keys internally

**WebSocket Messages:**
- **Event types:** `SCREAMING_SNAKE_CASE` → `START_CONVERSATION`, `AI_TIP`
- **Payload fields:** `camelCase` → `conversationId`, `agentId`, `timestamp`
- **Status values:** `lowercase` → `'loading'`, `'ready'`, `'error'`

### React Component Structure

```typescript
import { useCallStore } from '@/stores/call-store'
import type { AIRecommendation } from '@/types'

interface Props {
  // Props interface at top
}

export function ComponentName({ props }: Props) {
  // Zustand store selectors (specific fields only)
  const aiTips = useCallStore((state) => state.aiTips)
  const aiStatus = useCallStore((state) => state.aiBackendStatus)

  // Local state
  const [localState, setLocalState] = useState()

  // Effects
  useEffect(() => {
    // Side effects
  }, [dependencies])

  // Event handlers
  const handleAction = () => {
    // Logic
  }

  // Render
  return (
    <div className="...">
      {/* JSX */}
    </div>
  )
}
```

---

## 🔐 STATE MANAGEMENT PATTERNS

### Zustand Store Usage (call-store.ts)

**CRITICAL: ALWAYS use immutable updates. NEVER mutate state directly.**

```typescript
// ✅ CORRECT - Immutable update
addAITip: (tip: AIRecommendation) => set((state) => ({
  aiTips: [...state.aiTips, tip],
  lastAIUpdate: Date.now()
}))

setAIBackendStatus: (status: AIBackendStatus) => set({
  aiBackendStatus: status
})

// ❌ WRONG - Direct mutation
addAITip: (tip) => {
  state.aiTips.push(tip)  // NEVER DO THIS
  return state
}
```

### Zustand Selector Optimization

```typescript
// ✅ GOOD - Specific field selection (prevents unnecessary re-renders)
const aiTips = useCallStore((state) => state.aiTips)
const aiStatus = useCallStore((state) => state.aiBackendStatus)

// ❌ BAD - Selecting entire store (causes re-renders on any change)
const store = useCallStore()
```

### Chrome Storage Persistence

```typescript
// Save to chrome.storage.local
await chrome.storage.local.set({
  callState: get().callState,
  transcriptions: get().transcriptions
})

// Load from storage
const data = await chrome.storage.local.get(['callState', 'transcriptions'])
set({
  callState: data.callState || 'inactive',
  transcriptions: data.transcriptions || []
})
```

---

## 🌐 WEBSOCKET COMMUNICATION PATTERNS

### Message Format (Standard Structure)

```typescript
// All WebSocket messages follow this structure
{
  type: 'MESSAGE_TYPE',        // SCREAMING_SNAKE_CASE
  payload: {                   // camelCase fields
    conversationId: string,
    timestamp: number,         // Unix timestamp (milliseconds)
    ...additionalData
  }
}
```

### Extension → Backend Messages

```typescript
// Start conversation
socket.emit('START_CONVERSATION', {
  agentId: 'agent-123',
  timestamp: Date.now()
})

// Send transcript
socket.emit('TRANSCRIPT', {
  conversationId: 'uuid',
  speaker: 'caller',
  text: 'Hello, I need help with...',
  timestamp: Date.now()
})

// End conversation
socket.emit('END_CONVERSATION', {
  conversationId: 'uuid',
  timestamp: Date.now()
})
```

### Backend → Extension Messages

```typescript
// Conversation started
socket.on('CONVERSATION_STARTED', (data) => {
  const { conversationId } = data
  setAIConversationId(conversationId)
})

// AI tip received
socket.on('AI_TIP', (data) => {
  const { heading, suggestion, timestamp } = data
  addAITip({ heading, suggestion, timestamp, conversationId })
})

// Status update
socket.on('STATUS_UPDATE', (data) => {
  const { status } = data  // 'loading' | 'ready' | 'error'
  setAIBackendStatus(status)
})
```

### Reconnection Strategy

**Auto-reconnect with exponential backoff:**

```typescript
let retryCount = 0
const MAX_RETRIES = 3

async function connectWithRetry() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await connect()
      return
    } catch (error) {
      if (i === MAX_RETRIES - 1) {
        setAIBackendStatus('error')
        return
      }
      await sleep(Math.pow(2, i) * 1000)  // 1s, 2s, 4s
    }
  }
}
```

**Resume existing conversation:**

```typescript
socket.emit('RESUME_CONVERSATION', {
  conversationId: existingId,
  timestamp: Date.now()
})

socket.on('CONVERSATION_RESUMED', (data) => {
  const { aiTips, transcripts } = data
  // Backend sends existing state
})
```

---

## 🚨 CRITICAL RULES

### 1. NEVER Refactor Working Code
- **Extension audio pipeline is WORKING** - WebRTC → Deepgram → Transcriptions
- **ONLY ADD new AI features** - Don't touch existing transcription logic
- **Additive architecture** - Extend call-store.ts with AI fields, don't modify existing fields
- If you break transcriptions, the entire extension becomes useless

### 2. ALWAYS Use Immutable State Updates
- Zustand requires immutable updates for reactivity
- Use spread operators: `[...state.array, newItem]`
- Never: `state.array.push(newItem)` (breaks reactivity)

### 3. NEVER Hardcode Backend URLs
- Use environment variables or settings store
- Backend URL must be configurable per environment
- Example: `VITE_AI_BACKEND_URL=wss://backend.elasticbeanstalk.com`

### 4. ALWAYS Handle WebSocket Disconnections
- Implement auto-reconnect with exponential backoff
- Show user-friendly status messages ("Reconnecting...")
- Resume conversation state on reconnect (send conversationId)
- Gracefully degrade (transcriptions work even if AI fails)

### 5. NEVER Block the UI Thread
- Keep background service worker lightweight
- Heavy processing happens in offscreen documents or backend
- Use Web Workers for CPU-intensive tasks

### 6. ALWAYS Follow Message Format Conventions
- Event types: `SCREAMING_SNAKE_CASE`
- Payload fields: `camelCase`
- Timestamps: Unix milliseconds (`Date.now()`)
- Status values: `lowercase` strings

### 7. NEVER Store Sensitive Data in chrome.storage.local
- API keys should be in environment variables or secure backend
- Don't store full call recordings (send to backend immediately)
- Respect user privacy (30-day data retention policy)

### 8. ALWAYS Test Manifest V3 Service Worker Lifecycle
- Service workers can sleep and wake up unexpectedly
- Store critical state in chrome.storage.local, not memory
- Test extension behavior after service worker restart
- Offscreen documents have separate lifecycle

### 9. NEVER Skip TypeScript Strict Checks
- All variables must have explicit types
- No `any` types (use `unknown` if truly dynamic)
- Enable all strict flags in tsconfig.json
- Fix type errors before committing

### 10. ALWAYS Rate-Limit AI Analysis
- Minimum 30 seconds between analysis calls (backend enforces)
- 3-minute warmup before first analysis (data quality)
- Cost control: ~$0.045 per 30-minute call
- Don't spam OpenAI API on every transcript chunk

---

## 📱 UI/UX PATTERNS

### AI Tips Display Component (AITipsSection.tsx)

**Status Indicators:**
```typescript
const statusConfig = {
  disconnected: { color: 'bg-gray-500', text: 'Disconnected', icon: '○' },
  connecting: { color: 'bg-yellow-500', text: 'Connecting...', icon: '◐' },
  ready: { color: 'bg-green-500', text: 'AI Ready', icon: '●' },
  error: { color: 'bg-red-500', text: 'Error', icon: '✕' },
  reconnecting: { color: 'bg-orange-500', text: 'Reconnecting...', icon: '⟳' },
}
```

**Loading States:**
- **Warmup (0-3 min):** "🧠 AI is learning the conversation..."
- **Analysis:** "⏱️ AI Warming Up" (animated spinner)
- **Ready:** Display tips with 2-word headings
- **Error:** "⚠️ AI temporarily unavailable"
- **Reconnecting:** "🔄 AI Tips reconnecting..."

**Tip Display Format:**
```tsx
<div className="bg-white rounded-lg p-4 shadow-sm">
  <h3 className="text-sm font-bold text-blue-600 mb-2">
    {tip.heading} {/* Max 2 words */}
  </h3>
  <p className="text-sm text-gray-700">
    {tip.suggestion} {/* One actionable sentence */}
  </p>
</div>
```

### Tailwind CSS Patterns

```tsx
// Consistent spacing
className="p-4 mb-2 gap-2"

// Status colors
className="text-blue-600"  // Primary action
className="text-gray-500"  // Secondary text
className="text-red-500"   // Error state
className="text-green-500" // Success state

// Rounded corners
className="rounded-lg"      // Cards
className="rounded-full"    // Status badges

// Shadows
className="shadow-sm"       // Subtle elevation
className="shadow-md"       // More prominent
```

---

## 🔄 ERROR HANDLING PATTERNS

### Backend Error Response Format

```typescript
{
  error: {
    code: 'ERROR_CODE',        // SCREAMING_SNAKE_CASE
    message: string,           // User-friendly message
    details?: any              // Optional debug info (dev mode only)
  }
}
```

### Extension Error Handling

```typescript
try {
  await aiBackendService.connect(agentId)
  setAIBackendStatus('ready')
} catch (error) {
  console.error('❌ [AI Backend] Connection failed:', error)
  setAIBackendStatus('error')

  // Retry in background
  setTimeout(() => {
    connectWithRetry()
  }, 30000)
}
```

### Logging Pattern

```typescript
// Backend (Winston structured logs)
logger.info('AI analysis started', {
  conversationId,
  transcriptLength,
  timestamp: new Date().toISOString()
})

// Extension (console logs with prefixes)
console.log('🔊 [AI Backend] Connected to WebSocket')
console.error('❌ [AI Backend] Connection failed:', error)
console.log('✅ [AI Backend] Tip received:', tip)
```

---

## 🚀 CURRENT IMPLEMENTATION STATUS

### Completed (✅)
- Chrome extension base architecture (WebRTC, Deepgram, transcriptions)
- Side panel UI with transcription display
- Zustand state management with chrome.storage persistence
- WebRTC audio capture and processing
- Deepgram dual-channel transcription
- Content script injection and WebRTC interception

### In Progress (🔄)
- AI backend WebSocket integration (partially implemented)
- AITipsSection component (basic structure exists)
- Backend service in ai-backend.service.ts
- Call-store extension with AI fields

### Pending (⚠️)
- AWS Elastic Beanstalk backend deployment
- OpenAI GPT-4o-mini integration (backend)
- Progressive summarization logic (backend)
- PostgreSQL schema and migrations
- Production testing with live calls
- Cost monitoring and analytics

### Architecture Documentation
- **Full architecture spec:** `docs/architecture.md` (1097 lines)
- **Integration guide:** `INTEGRATION-GUIDE.md`
- **Handoff document:** `HANDOFF-2025-12-17.md`
- **Extension status:** `EXTENSION-INTEGRATION-STATUS.md`

---

## 📂 KEY FILES

### Configuration
- `tsconfig.json` - TypeScript config (strict mode, path aliases, ES2020)
- `package.json` - Dependencies and build scripts
- `vite.config.ts` - Vite + CRXJS plugin configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `src/manifest.json` - Chrome extension manifest (Manifest V3)

### Core Extension
- `src/background/index.ts` - Service worker (WebSocket orchestration)
- `src/content/index.ts` - Content script injector
- `src/content/webrtc-bridge.ts` - WebRTC audio capture
- `src/offscreen/index.ts` - Deepgram WebSocket handler
- `src/injected/webrtc-interceptor.ts` - getUserMedia interception

### State Management
- `src/stores/call-store.ts` - Main call state + AI tips (Zustand)
- `src/stores/settings-store.ts` - User settings

### Services
- `src/services/ai-backend.service.ts` - WebSocket client for AI backend
- `src/services/ai-coaching-service.ts` - AI integration logic

### UI Components
- `src/sidepanel/SidePanel.tsx` - Main side panel container
- `src/components/AITipsSection.tsx` - AI tips display
- `src/popup/Popup.tsx` - Extension popup (login/settings)

### Types
- `src/types/index.ts` - Centralized TypeScript type definitions

---

## 🚀 DEVELOPMENT COMMANDS

```bash
# Development
npm run dev          # Start Vite dev server (hot reload)

# Build
npm run build        # TypeScript compile + Vite build
npm run preview      # Preview production build

# Load in Chrome
1. npm run build
2. Chrome → chrome://extensions
3. Enable "Developer mode"
4. "Load unpacked" → select dist/ folder
```

### Backend Development (Separate Repository)

```bash
# Backend setup
cd ai-coaching-backend
npm install
npm run dev          # Start Express server with hot reload

# Database migrations
npm run migrate up   # Apply migrations
npm run migrate down # Rollback migrations

# Deployment
npm run build
eb deploy            # Deploy to Elastic Beanstalk
```

---

## 💡 AI DEVELOPMENT TIPS

1. **Read architecture.md first** - Complete technical specification (1097 lines)
2. **Never touch working code** - Additive approach only for AI features
3. **Follow naming conventions religiously** - Database snake_case, TypeScript camelCase, events SCREAMING_SNAKE_CASE
4. **Test service worker lifecycle** - Extension can restart mid-call
5. **Handle WebSocket disconnections gracefully** - Auto-reconnect is mandatory
6. **Respect immutability** - Zustand breaks if you mutate state directly
7. **Use TypeScript strict mode** - No shortcuts, fix all type errors
8. **Check implementation status** - Know what's done vs. pending
9. **Reference integration guide** - Step-by-step setup instructions
10. **Think about costs** - Every OpenAI API call costs money

---

## 🔗 RELATED DOCUMENTATION

- `docs/architecture.md` - Complete architectural specification (1097 lines)
- `INTEGRATION-GUIDE.md` - Step-by-step integration instructions (18KB)
- `HANDOFF-2025-12-17.md` - Recent project handoff (12KB)
- `EXTENSION-INTEGRATION-STATUS.md` - Current integration status (9KB)
- `CODE-CHANGES-REVIEW.md` - Recent code changes review (17KB)
- `DEMO-IMPLEMENTATION-SUMMARY.md` - Demo implementation summary (8KB)

---

**This is the source of truth. When in doubt, refer here or to architecture.md.**
