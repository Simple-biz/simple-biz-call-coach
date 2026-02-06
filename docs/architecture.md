---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments: ["CLAUDE.md"]
workflowType: 'architecture'
lastStep: 5
project_name: 'DevAssist-Call-Coach'
user_name: 'Cob'
date: '2025-12-17'
hasProjectContext: false
featureType: 'enhancement'
baseArchitecture: 'existing'
status: 'complete'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

1. **Real-time Conversation Analysis** - AI must analyze ongoing sales conversations and provide coaching during live calls
2. **Batch Processing Strategy** - Process transcripts at 3-minute intervals (first batch at 3:00, then every 3 minutes)
3. **Context Accumulation** - Maintain full conversation history with previous context summaries for each analysis batch
4. **Conversation-First Coaching** - Generate suggestions that keep conversations flowing naturally, build rapport, and maintain engagement (not pushy sales tactics)
5. **Concise UI Integration** - Display recommendations with max 2-word headings + actionable suggestions in side panel
6. **Background Processing** - Analysis starts automatically when "Start AI Coaching" is clicked, runs invisibly until recommendations are ready
7. **Dual-Channel Awareness** - AI must understand speaker context (caller vs agent) to provide relevant coaching

**Non-Functional Requirements:**

- **Latency**: Sub-second recommendation delivery to maintain conversation flow
- **Reliability**: 99.9% uptime during business hours (critical for live sales calls)
- **Cost Efficiency**: Keep per-call LLM costs under $0.10 (client willing to pay but needs ROI)
- **Scalability**: Support 10+ concurrent agents initially, scale to 100+
- **Data Security**: Secure handling of call transcripts and customer conversations
- **Privacy**: Compliance with call recording regulations

**Scale & Complexity:**

- **Primary domain**: Chrome Extension + Real-time AI Integration + AWS Backend
- **Complexity level**: High (real-time streaming, stateful conversation tracking, LLM integration)
- **Estimated architectural components**: 8 (4 new components added to existing 7-component extension)

### Technical Constraints & Dependencies

**Existing Architecture Constraints:**
- Chrome Extension Manifest V3 (service worker lifecycle limitations)
- WebRTC audio capture already implemented and working
- Deepgram transcription producing dual-channel text streams
- Zustand + chrome.storage.local state management pattern

**New Requirements:**
- AWS infrastructure available (EC2/ECS, RDS, ElastiCache)
- LLM API integration (OpenAI GPT-4o-mini recommended for speed/cost)
- WebSocket communication between extension and backend
- PostgreSQL database for conversation persistence
- 3-minute batch timer with stateful tracking

**Browser Limitations:**
- Cannot run LLM models locally in browser (too resource-intensive)
- Limited storage capacity in chrome.storage.local
- Service worker may sleep, requiring persistent backend connection

### Cross-Cutting Concerns Identified

1. **State Synchronization** - Conversation state must be consistent between extension and backend
2. **Connection Resilience** - WebSocket reconnection handling for dropped connections during calls
3. **Context Window Management** - LLM token limits require intelligent conversation summarization
4. **Error Handling** - Graceful degradation when AI analysis fails (show transcriptions, hide AI tips)
5. **Cost Monitoring** - Track LLM API usage per agent/team for billing and optimization
6. **Conversation Timing** - Precise 3-minute interval tracking even if extension restarts
7. **Data Retention** - How long to store conversation history (compliance, storage cost)
8. **Testing Strategy** - How to test real-time conversation coaching without live calls

## Starter Template Evaluation

### Primary Technology Domain

**Node.js Backend Server** for AI conversation analysis with real-time WebSocket communication to Chrome extension

### Starter Options Considered

Evaluated three main approaches for the backend architecture:

**1. Express + TypeScript + Socket.io Boilerplate**
- Lightweight, production-ready structure
- Easy to customize for AI analysis service
- Three-tier architecture with clear separation of concerns
- **Best fit for this use case**

**2. NestJS Full Framework**
- Enterprise-grade with comprehensive features
- Built-in TypeORM, Auth, WebSocket support
- More opinionated and structured
- **Too heavy for focused AI analysis service**

**3. Minimal Express Starter**
- Simpler but lacks production structure
- **Insufficient for production deployment**

### Selected Approach: Custom Structure Based on Express + TypeScript

**Rationale for Selection:**

1. **Focused Architecture** - NestJS is overkill for a specialized AI analysis service; we need clean architecture without framework overhead
2. **AWS Elastic Beanstalk Compatibility** - Express works seamlessly with EB's Node.js 20 platform on Amazon Linux 2023
3. **WebSocket Support** - Application Load Balancer natively supports WebSockets (no special configuration needed)
4. **Technology Alignment** - Matches extension's TypeScript/JavaScript ecosystem for easier maintenance
5. **Development Velocity** - Building exactly what we need without framework constraints

### Initialization Approach

**Custom Scaffold** (not using CLI generator):

```
ai-coaching-backend/
├── src/
│   ├── services/
│   │   ├── websocket.service.ts    # Socket.io connection management
│   │   ├── ai-analysis.service.ts  # OpenAI GPT-4o-mini integration
│   │   ├── conversation.service.ts # 3-minute batch processing
│   │   └── database.service.ts     # PostgreSQL connection pool
│   ├── models/
│   │   ├── conversation.model.ts   # Conversation entity
│   │   ├── transcript.model.ts     # Transcript entity
│   │   └── recommendation.model.ts # AI recommendation entity
│   ├── utils/
│   │   ├── logger.ts               # Winston logger
│   │   └── prompt-builder.ts       # LLM prompt engineering
│   └── server.ts                   # Express + Socket.io setup
├── .ebextensions/                  # Elastic Beanstalk configuration
│   └── nodecommand.config          # EB platform hooks
├── package.json
├── tsconfig.json
└── .env.example
```

### Architectural Decisions Provided by This Structure

**Language & Runtime:**
- TypeScript 5.x with strict mode enabled
- Node.js 20.x LTS (latest EB platform)
- ES2022 target for modern JavaScript features
- Path aliases (@/services, @/models) for clean imports

**API Framework:**
- Express.js 4.x - Battle-tested, lightweight HTTP server
- Socket.io 4.x - WebSocket library with fallback support
- CORS middleware configured for Chrome extension origin
- Helmet for security headers

**Database Layer:**
- PostgreSQL 15 via AWS RDS
- `pg` driver with connection pooling (pg-pool)
- Raw SQL queries (no ORM overhead for simple CRUD)
- Migration management via `node-pg-migrate`
- JSONB columns for flexible transcript storage

**Build Tooling:**
- TypeScript compiler (tsc) for production builds
- ts-node-dev for development hot reload
- ESLint + Prettier for code quality
- npm scripts for build/dev/deploy workflows

**Testing Framework:**
- Jest 29.x for unit and integration tests
- Supertest for HTTP endpoint testing
- Mock Socket.io clients for WebSocket testing
- Test coverage reporting with Istanbul

**Code Organization:**
- **Service Layer Pattern** - Business logic separated from routes
- **Models** - Database entity definitions and queries
- **Utils** - Shared logging, prompt building, helpers
- **Single Entry Point** - server.ts bootstraps everything

**Development Experience:**
- Environment variables via dotenv
- Structured logging with Winston (JSON format for CloudWatch)
- Centralized error handling middleware
- TypeScript strict null checks
- Hot reload in development

**AWS Elastic Beanstalk Configuration:**

**Deployment Commands:**
```bash
# Install EB CLI
pip install awsebcli

# Initialize Elastic Beanstalk application
eb init -p "Node.js 20 running on 64bit Amazon Linux 2023" \
  ai-coaching-backend --region us-east-1

# Create production environment with RDS PostgreSQL
eb create production \
  --database.engine postgres \
  --database.username admin \
  --elb-type application \
  --instance-type t3.small

# Deploy application
eb deploy

# Configure environment variables
eb setenv OPENAI_API_KEY=sk-... \
  DEEPGRAM_API_KEY=... \
  NODE_ENV=production
```

**EB Configuration Files (.ebextensions/):**
- Application Load Balancer for WebSocket support
- Node.js 20 platform on AL2023
- Environment variables for RDS connection string
- CloudWatch logs integration
- Health check endpoints

**Note:** Backend initialization and deployment should be the first implementation story for this feature.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. ✅ Progressive Analysis Strategy (3-min warmup, then continuous)
2. ✅ WebSocket Auto-Reconnect with Resume
3. ✅ Progressive Summarization for Context Management
4. ✅ Extend Existing Call Store (no refactor needed)

**Important Decisions (Shape Architecture):**
5. ✅ Minimal Authentication (shared API key - internal tool)
6. ✅ Error Handling with Retry Logic
7. ✅ 30-Second Analysis Throttle for cost control
8. ✅ 30 Days Data Retention policy

**Deferred Decisions (Post-MVP):**
- Agent performance dashboard
- Team analytics and reporting
- Call recording archive to S3 for long-term storage

---

### Data Architecture

**Database: PostgreSQL 15 (AWS RDS)**
- Version: PostgreSQL 15.x on RDS
- Driver: `pg` with connection pooling (pg-pool)
- Schema approach: Simple normalized tables with JSONB for flexibility
- Migration: `node-pg-migrate` for version control

**Database Schema:**
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
  speaker VARCHAR, -- 'caller' or 'agent'
  text TEXT,
  timestamp TIMESTAMP,
  is_final BOOLEAN
)

ai_recommendations (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations,
  heading VARCHAR(20), -- Max 2 words
  suggestion TEXT,
  created_at TIMESTAMP
)

conversation_summaries (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES conversations,
  time_range VARCHAR, -- e.g., '0-10min'
  summary TEXT,
  created_at TIMESTAMP
)
```

**Data Retention Strategy:**
- 30 days rolling deletion
- Daily cron job: `DELETE FROM conversations WHERE start_time < NOW() - INTERVAL '30 days'`
- CASCADE delete on transcripts and recommendations
- Rationale: Balance between performance review needs and privacy/storage costs

**Caching Strategy:**
- No Redis for MVP (keep it simple)
- In-memory conversation state in backend
- PostgreSQL sufficient for 10-100 concurrent agents

---

### Authentication & Security

**Authentication Method: Minimal (Internal Tool)**
- Shared API key for all agents
- Stored in extension settings (chrome.storage.local)
- Validated on WebSocket handshake
- Environment variable: `BACKEND_API_KEY`

**Security Measures:**
- CORS restricted to extension origin: `chrome-extension://[extension-id]`
- Helmet.js for security headers
- API key transmitted in WebSocket auth message
- HTTPS/WSS only in production (Elastic Beanstalk ALB provides SSL)

**Rationale:**
- Internal team tool (trusted environment)
- Simple implementation - no token refresh during calls
- Can upgrade to per-agent API keys later if needed

---

### API & Communication Patterns

**WebSocket Communication (Socket.io 4.x)**

**Connection Flow:**
```
Extension → WSS://backend.elasticbeanstalk.com
1. Connect with API key authentication
2. Send: { type: 'START_CONVERSATION', agentId: 'xxx' }
3. Receive: { conversationId: 'uuid' }
4. Stream transcripts: { type: 'TRANSCRIPT', speaker, text, timestamp }
5. Receive tips: { type: 'AI_TIP', heading, suggestion }
```

**Message Types:**
- `START_CONVERSATION` - Begin new coaching session
- `TRANSCRIPT` - Send transcript chunk to backend
- `AI_TIP` - Receive AI recommendation from backend
- `STATUS_UPDATE` - AI status (loading/ready/error/reconnecting)
- `RESUME_CONVERSATION` - Reconnect to existing session with conversationId

**Reconnection Strategy: Auto-Reconnect with Resume**
- Extension detects disconnect via Socket.io events
- Auto-reconnect with exponential backoff (1s, 2s, 4s)
- Send `conversationId` to resume session
- Backend loads state from PostgreSQL
- Seamless for agent (brief "Reconnecting..." message only)

**Error Handling: Show Error + Retry**
- Display: "🔄 AI Tips reconnecting..."
- 3 automatic retry attempts (2-second intervals)
- Fallback to transcription-only after all retries fail
- Background retry every 30 seconds
- Agent can continue call with transcriptions working

---

### Extension Architecture (Additive Approach - No Refactor)

**Principle: Keep What Works, Add AI Cleanly**

**Existing Components (DON'T TOUCH):**
- ✅ WebRTC Bridge → Deepgram → Transcriptions (WORKING - keep as is)
- ✅ Offscreen document (Deepgram WebSocket)
- ✅ WebRTC Interceptor (audio capture)
- ✅ Call detection logic
- ✅ Side panel transcription display

**New Components (ADD ONLY):**

**1. AI Backend Service** - `src/services/ai-backend.service.ts`
```typescript
class AIBackendService {
  private socket: Socket | null
  private conversationId: string | null

  connect(agentId: string): void
  sendTranscript(speaker: string, text: string, timestamp: number): void
  onAITip(callback: (tip: AIRecommendation) => void): void
  onStatusChange(callback: (status: AIStatus) => void): void
  disconnect(): void
  reconnect(conversationId: string): void
}
```

**2. Extended Call Store** - `src/stores/call-store.ts`
```typescript
interface CallState {
  // Existing fields (don't change)
  transcriptions: Transcription[]
  coachingTips: CoachingTip[]
  isRecording: boolean
  // ... other existing fields

  // NEW fields only
  aiTips: AIRecommendation[]
  aiStatus: 'loading' | 'ready' | 'error' | 'reconnecting'
  lastAiUpdate: number
  conversationId: string | null

  // NEW actions
  addAITip: (tip: AIRecommendation) => void
  setAIStatus: (status: AIStatus) => void
  setConversationId: (id: string) => void
}
```

**3. Background Worker Updates** - `src/background/index.ts`
- Add WebSocket connection initialization when coaching starts
- Listen to transcript updates from chrome.storage
- Forward transcripts to AI backend via WebSocket
- Store AI tips back to call store
- Handle WebSocket reconnection

**4. New UI Component** - `src/sidepanel/components/AITipsSection.tsx`
- Displays AI recommendations with 2-word headings
- Shows status indicators (loading/error/ready)
- Positioned in side panel (replaces coaching statistics)
- Auto-scrolls to latest tip

**Architecture Flow:**
```
┌─────────────────────────────────────────┐
│ Chrome Extension (EXISTING)             │
│                                         │
│ WebRTC → Deepgram → Transcriptions ✅  │
│              ↓                          │
│         Call Store ← AI Tips (NEW)     │
│              ↓            ↑             │
│         Side Panel    Background (NEW)  │
│                           ↓             │
└───────────────────────────┼─────────────┘
                            │ WebSocket
                            ↓
            ┌───────────────────────────┐
            │ AWS Backend (NEW)         │
            │                           │
            │ Socket.io Server          │
            │       ↓                   │
            │ AI Analysis Service       │
            │       ↓                   │
            │ OpenAI GPT-4o-mini        │
            │       ↓                   │
            │ PostgreSQL                │
            └───────────────────────────┘
```

---

### AI Analysis Strategy

**Progressive Analysis Approach:**

**Phase 1: Warmup Period (0-3 minutes)**
- Backend accumulates transcripts from both speakers
- No AI analysis yet (waiting for stable, quality data)
- Agent sees: "🧠 AI is learning the conversation..."
- Rationale: Deepgram transcription quality improves after 2-minute mark

**Phase 2: First Analysis (3:00 mark)**
- Analyze accumulated 3 minutes of full transcript
- Generate first AI recommendations
- Agent sees first tips appear in side panel
- Prompt includes full conversation context + business domain (digital services sales)

**Phase 3: Continuous Analysis (3:00+)**
- Analyze every 30 seconds (rate-limited)
- Include conversation summary + recent transcripts
- Progressive summarization maintains full context
- Tips update continuously as conversation evolves

**Context Window Management: Progressive Summarization**

**Strategy:**
```
Minutes 0-10:  [Full transcript - ~5k tokens]
Minutes 10-20: [Summary of 0-10] + [Full 10-20] - ~4k tokens
Minutes 20-30: [Summary of 0-20] + [Full 20-30] - ~4k tokens
Minutes 30-40: [Summary of 0-30] + [Full 30-40] - ~4k tokens
```

**Summarization Process:**
- Trigger: Every 10 minutes
- GPT-4o-mini call: "Summarize this conversation segment focusing on: customer pain points, objections raised, rapport moments, buying signals, budget mentions"
- Store summary in `conversation_summaries` table
- Future analysis uses: [all summaries] + [recent full transcript]

**Cost Analysis (30-minute call):**
- 1 initial analysis (3-min mark): ~2k tokens input, 200 tokens output = $0.0004
- 54 continuous analyses (every 30s for 27 min): ~1.5k tokens each = $0.041
- 2 summarizations (10min, 20min marks): ~3k tokens = $0.002
- **Total cost per call: ~$0.045**

**Rate Limiting: 30-Second Analysis Throttle**
- Minimum 30 seconds between AI analyses
- Backend batches transcripts if they arrive faster
- Prevents runaway costs if agent talks very fast
- Still highly responsive for real-time coaching

**LLM Prompt Template:**
```
System: You are a conversation coach helping agents sell digital services
(SEO, website building, system administration) to small-medium businesses.
Keep conversations flowing naturally, build rapport, avoid pushy sales tactics.

Previous context: {conversation_summary}
Recent transcript (last 30 seconds):
  Caller: {caller_transcript}
  Agent: {agent_transcript}

Task: Generate ONE concise coaching tip.
Format:
- Heading: Exactly 2 words (e.g., "Ask More", "Build Trust")
- Suggestion: One actionable sentence (what to say or ask next)

Focus on: Keeping conversation natural, deepening rapport, active listening
```

---

### Infrastructure & Deployment

**Hosting Platform: AWS Elastic Beanstalk**
- Platform: Node.js 20 running on Amazon Linux 2023
- Load Balancer: Application Load Balancer (ALB) with native WebSocket support
- Instance Type: t3.small (2 vCPU, 2GB RAM) - auto-scaling group
- Region: us-east-1 (or your preference)

**Database: AWS RDS PostgreSQL**
- Instance: db.t3.micro (free tier eligible initially, can upgrade)
- Engine: PostgreSQL 15.x
- Storage: 20GB SSD (auto-scaling enabled)
- Automated backups: 7-day retention
- Multi-AZ: No (for cost savings initially)

**Cost Estimate (Monthly):**
- Elastic Beanstalk: ~$30/month (1 t3.small instance)
- RDS PostgreSQL: ~$15/month (db.t3.micro)
- Application Load Balancer: ~$16/month
- OpenAI API: ~$0.045 × 800 calls/month = ~$36/month
- **Total: ~$97/month for 10 agents**

**Environment Variables:**
```bash
NODE_ENV=production
OPENAI_API_KEY=sk-xxx
BACKEND_API_KEY=shared-secret-key
DATABASE_URL=postgresql://admin:password@rds-endpoint:5432/coaching
PORT=8080
CORS_ORIGIN=chrome-extension://[extension-id]
LOG_LEVEL=info
```

**Deployment Process:**
```bash
# One-time setup
pip install awsebcli
eb init -p "Node.js 20 running on 64bit Amazon Linux 2023" \
  ai-coaching-backend --region us-east-1

# Create production environment
eb create production \
  --database.engine postgres \
  --database.username admin \
  --elb-type application \
  --instance-type t3.small

# Configure environment variables
eb setenv OPENAI_API_KEY=sk-xxx \
  BACKEND_API_KEY=xxx \
  CORS_ORIGIN=chrome-extension://xxx

# Ongoing deployments
npm run build
eb deploy
```

**Monitoring & Logging:**
- CloudWatch Logs: Automatic integration with Elastic Beanstalk
- Custom Metrics: AI analysis latency, WebSocket connections, LLM token usage
- Alarms: High error rate (>5%), database connection failures
- Winston logger: Structured JSON logs for CloudWatch Insights

**Scaling Strategy:**
- Starting capacity: 1 instance (handles 20-30 concurrent agents)
- Auto-scaling trigger: 70% CPU utilization
- Maximum instances: 4 (handles 100+ concurrent agents)
- WebSocket sticky sessions: Enabled via ALB
- Database connection pooling: Max 20 connections per instance

---

### Decision Impact Analysis

**Implementation Sequence (Recommended Order):**

**Week 1: Backend Foundation**
1. Initialize Node.js + TypeScript project structure
2. PostgreSQL schema design + migrations
3. Socket.io server with API key authentication
4. Basic transcript storage endpoints
5. Database service with connection pooling

**Week 1-2: AI Integration**
6. OpenAI GPT-4o-mini client integration
7. Progressive analysis logic (3-min warmup + continuous)
8. Progressive summarization service
9. Error handling + retry logic
10. 30-second rate limiting

**Week 2: Extension Integration**
11. AI Backend Service client (WebSocket)
12. Extend call-store.ts with AI fields
13. Background worker WebSocket connection logic
14. Auto-reconnect implementation
15. Transcript forwarding from background to backend

**Week 2: UI Component**
16. AITipsSection React component
17. Status indicators (loading/error/ready)
18. 2-word heading + suggestion display styling
19. Replace coaching statistics section in side panel

**Week 2-3: AWS Deployment**
20. Elastic Beanstalk application setup
21. RDS PostgreSQL provisioning
22. Environment configuration (.ebextensions)
23. Load balancer WebSocket configuration
24. Production testing with live calls

**Cross-Component Dependencies:**

**Dependency Chain:**
1. **Transcriptions → Backend**: Background worker listens to call store transcriptions, forwards via WebSocket
2. **Backend → Database**: All conversations persisted to PostgreSQL for resume capability
3. **Database → AI Analysis**: Progressive summarization reads from conversation_summaries table
4. **AI Analysis → Backend WebSocket**: Tips sent back to extension in real-time
5. **Backend → Call Store**: AI tips stored in extended call store
6. **Call Store → UI**: AITipsSection component reads aiTips array

**Critical Path:**
Backend infrastructure must be deployed BEFORE extension changes, so WebSocket endpoint exists for testing.

**Integration Points:**
- Extension Background ↔ Backend: WebSocket message protocol
- Backend ↔ OpenAI: REST API for GPT-4o-mini
- Backend ↔ PostgreSQL: Connection pool for state management

---

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified

**5 Major Areas** where AI agents could make different implementation choices without explicit patterns:

1. **Database Naming** - Table/column casing and conventions
2. **TypeScript Naming** - Interface, function, variable naming
3. **WebSocket Messages** - Event type naming and payload structure
4. **File Organization** - Test locations and folder structure
5. **Error Handling** - Response formats and retry patterns

---

### Naming Patterns

**Database Naming Conventions (PostgreSQL):**
- **Tables**: `lowercase_snake_case` → `conversations`, `ai_recommendations`, `conversation_summaries`
- **Columns**: `lowercase_snake_case` → `agent_id`, `created_at`, `conversation_id`
- **Primary Keys**: `id` (UUID type)
- **Foreign Keys**: `{table_singular}_id` → `conversation_id`, `agent_id`
- **Indexes**: `idx_{table}_{column}` → `idx_conversations_agent_id`, `idx_transcripts_timestamp`
- **JSONB Columns**: `metadata`, `details` (store camelCase JSON internally)

**Examples:**
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  agent_id VARCHAR,
  start_time TIMESTAMP,
  metadata JSONB
);

CREATE INDEX idx_conversations_agent_id ON conversations(agent_id);
```

**TypeScript Code Naming:**
- **Interfaces/Types**: `PascalCase` → `AIRecommendation`, `ConversationState`, `TranscriptMessage`
- **Classes**: `PascalCase` → `AIAnalysisService`, `DatabaseService`, `WebSocketServer`
- **Functions**: `camelCase` → `analyzeTranscript`, `sendToExtension`, `summarizeConversation`
- **Variables**: `camelCase` → `conversationId`, `aiStatus`, `transcriptText`
- **Constants**: `SCREAMING_SNAKE_CASE` → `MAX_RETRY_ATTEMPTS`, `API_BASE_URL`, `WARMUP_DURATION_MS`
- **Enums**: `PascalCase` with `SCREAMING_SNAKE_CASE` values
- **Files**: Match primary export → `AIRecommendation.ts`, `conversation.service.ts`, `ai-analysis.service.ts`

**Examples:**
```typescript
// Interfaces
interface AIRecommendation {
  heading: string
  suggestion: string
  timestamp: number
}

// Constants
const MAX_RETRY_ATTEMPTS = 3
const WARMUP_DURATION_MS = 180000

// Functions
function analyzeTranscript(transcript: string): Promise<AIRecommendation>
```

**WebSocket Message Type Naming:**
- **Event Types**: `SCREAMING_SNAKE_CASE` → `START_CONVERSATION`, `AI_TIP`, `TRANSCRIPT`, `STATUS_UPDATE`
- **Payload Fields**: `camelCase` → `conversationId`, `agentId`, `timestamp`, `transcriptText`
- **Status Values**: `lowercase` → `'loading'`, `'ready'`, `'error'`, `'reconnecting'`

**Examples:**
```typescript
// Message types
socket.emit('START_CONVERSATION', { agentId: 'agent-123' })
socket.emit('TRANSCRIPT', {
  conversationId: 'uuid',
  speaker: 'caller',
  text: 'Hello...',
  timestamp: Date.now()
})
socket.emit('AI_TIP', {
  heading: 'Ask More',
  suggestion: 'Ask about their current website challenges'
})
```

---

### Structure Patterns

**Backend Project Organization:**
```
ai-coaching-backend/
├── src/
│   ├── services/              # Business logic services
│   │   ├── websocket.service.ts
│   │   ├── ai-analysis.service.ts
│   │   ├── conversation.service.ts
│   │   └── database.service.ts
│   ├── models/                # Database entity models
│   │   ├── conversation.model.ts
│   │   ├── transcript.model.ts
│   │   └── recommendation.model.ts
│   ├── utils/                 # Shared helpers
│   │   ├── logger.ts
│   │   └── prompt-builder.ts
│   └── server.ts              # Application entry point
├── migrations/                # Database migrations (node-pg-migrate)
│   ├── 001_initial_schema.sql
│   └── 002_add_summaries.sql
├── tests/                     # All tests (NOT in src/)
│   ├── unit/
│   │   ├── services/
│   │   └── models/
│   └── integration/
├── .ebextensions/             # Elastic Beanstalk config
├── package.json
├── tsconfig.json
└── .env.example
```

**Test File Naming & Location:**
- **Pattern**: `{filename}.test.ts` (NOT `.spec.ts`)
- **Location**: `tests/unit/` or `tests/integration/` (NOT co-located with src)
- **Example**: `tests/unit/services/ai-analysis.service.test.ts`
- **Rationale**: Clean separation, easier to exclude from build

**Extension File Organization (Additive Only):**
- **New Service**: `src/services/ai-backend.service.ts` (alongside existing services)
- **Store Extension**: Modify existing `src/stores/call-store.ts` (add fields only)
- **New Component**: `src/sidepanel/components/AITipsSection.tsx`
- **NO new top-level folders** - follow existing structure

---

### Format Patterns

**WebSocket Message Format (Standard Structure):**
```typescript
// All messages follow this structure
{
  type: 'MESSAGE_TYPE',        // SCREAMING_SNAKE_CASE
  payload: {                   // camelCase fields
    conversationId: string,
    timestamp: number,         // Unix timestamp (milliseconds)
    ...additionalData
  }
}

// Examples
{
  type: 'START_CONVERSATION',
  payload: {
    agentId: 'agent-123',
    timestamp: 1702845600000
  }
}

{
  type: 'AI_TIP',
  payload: {
    conversationId: 'uuid-here',
    heading: 'Build Trust',
    suggestion: 'Ask about their biggest website challenge',
    timestamp: 1702845720000
  }
}
```

**Error Response Format:**
```typescript
// Backend error responses
{
  error: {
    code: 'ERROR_CODE',        // SCREAMING_SNAKE_CASE
    message: string,           // User-friendly message
    details?: any              // Optional debug info (dev mode only)
  }
}

// Examples
{
  error: {
    code: 'AI_ANALYSIS_FAILED',
    message: 'AI temporarily unavailable',
    details: { retryIn: 30000 }
  }
}
```

**Database JSONB Format:**
```typescript
// metadata column uses camelCase keys (NOT snake_case)
{
  "agentName": "John Doe",
  "callDuration": 1800,
  "customerInfo": {
    "company": "Acme Corp",
    "industry": "Manufacturing"
  }
}
```

**Date/Time Formats:**
- **Database**: ISO 8601 timestamps → `2025-12-17T10:30:00Z`
- **WebSocket Messages**: Unix timestamp (ms) → `1702845600000`
- **Logs**: ISO 8601 → `2025-12-17T10:30:00.123Z`

---

### Communication Patterns

**WebSocket Event Lifecycle (Standard Flow):**
```
1. Extension → Backend: START_CONVERSATION { agentId }
2. Backend → Extension: CONVERSATION_STARTED { conversationId }
3. Extension → Backend: TRANSCRIPT { conversationId, speaker, text, timestamp }
4. Backend → Extension: STATUS_UPDATE { status: 'loading' }  // At 0-3 min
5. Backend → Extension: AI_TIP { heading, suggestion }       // At 3:00
6. Backend → Extension: AI_TIP { heading, suggestion }       // Every 30s after
7. Extension → Backend: END_CONVERSATION { conversationId }
8. Backend → Extension: CONVERSATION_ENDED { conversationId }
```

**Reconnection Flow:**
```
1. Extension detects disconnect
2. Extension → Backend: RESUME_CONVERSATION { conversationId }
3. Backend loads state from PostgreSQL
4. Backend → Extension: CONVERSATION_RESUMED { aiTips[], transcripts[] }
5. Continue normal flow
```

**State Update Pattern (Zustand - Immutable):**
```typescript
// CORRECT - Immutable updates (Zustand best practice)
addAITip: (tip) => set((state) => ({
  aiTips: [...state.aiTips, tip]  // Spread, don't mutate
}))

setAIStatus: (status) => set({ aiStatus: status })

// WRONG - Direct mutation
addAITip: (tip) => {
  state.aiTips.push(tip)  // ❌ Don't do this
}
```

---

### Process Patterns

**Error Handling Strategy:**

**Backend Error Handling:**
```typescript
// Catch, log, notify extension
try {
  const tips = await analyzeWithAI(transcript)
  socket.emit('AI_TIP', { ...tips, timestamp: Date.now() })
} catch (error) {
  logger.error('AI analysis failed', { error, conversationId })
  socket.emit('STATUS_UPDATE', {
    status: 'error',
    error: {
      code: 'AI_ANALYSIS_FAILED',
      message: 'AI temporarily unavailable'
    }
  })
}
```

**Extension Error Handling:**
```typescript
// Retry logic with exponential backoff
async function connectWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await connect()
      return
    } catch (error) {
      if (i === maxRetries - 1) {
        setAIStatus('error')
        return
      }
      await sleep(Math.pow(2, i) * 1000)  // 1s, 2s, 4s
    }
  }
}
```

**Loading State Pattern:**
```typescript
// Extension state management
aiStatus: 'loading' | 'ready' | 'error' | 'reconnecting'

// UI rendering based on status
{aiStatus === 'loading' && (
  <div className="text-gray-500">
    🧠 AI is learning the conversation...
  </div>
)}

{aiStatus === 'ready' && (
  <AITips tips={aiTips} />
)}

{aiStatus === 'error' && (
  <div className="text-red-500">
    ⚠️ AI temporarily unavailable
  </div>
)}

{aiStatus === 'reconnecting' && (
  <div className="text-yellow-500">
    🔄 AI Tips reconnecting...
  </div>
)}
```

**Logging Pattern:**
```typescript
// Winston structured logging (backend)
logger.info('AI analysis started', {
  conversationId,
  transcriptLength: transcript.length,
  timestamp: new Date().toISOString()
})

logger.error('OpenAI API error', {
  conversationId,
  error: error.message,
  statusCode: error.statusCode
})

// Console logging (extension)
console.log('🔊 [AI Backend] Connected to WebSocket')
console.error('❌ [AI Backend] Connection failed:', error)
```

---

### Enforcement Guidelines

**All AI Agents MUST:**

1. **Follow naming conventions exactly** - Database snake_case, TypeScript camelCase/PascalCase, events SCREAMING_SNAKE_CASE
2. **Use standard message formats** - All WebSocket messages have `type` + `payload` structure
3. **Handle errors gracefully** - Catch, log, notify user, implement retry logic
4. **Never mutate state directly** - Use immutable updates in Zustand
5. **Place tests in tests/ folder** - Not co-located with source code
6. **Use Unix timestamps in messages** - ISO 8601 only in database/logs
7. **Add, don't refactor** - Extension changes are additive only, no changes to existing working code

**Pattern Verification:**
- TypeScript compilation catches naming inconsistencies
- ESLint enforces code style
- Database migration review catches schema violations
- Code review checklist includes pattern compliance

**Pattern Updates:**
- Patterns can be updated if unanimous agreement
- Document rationale for any pattern changes
- Update this architecture document
- Notify all AI agents of changes

---

### Pattern Examples

**✅ Good Examples:**

**Database Query:**
```typescript
// Correct naming
const result = await pool.query(
  'SELECT id, agent_id, created_at FROM conversations WHERE conversation_id = $1',
  [conversationId]
)
```

**WebSocket Message:**
```typescript
// Correct structure
socket.emit('AI_TIP', {
  conversationId: 'uuid',
  heading: 'Show Interest',
  suggestion: 'Ask about their current SEO strategy',
  timestamp: Date.now()
})
```

**State Update:**
```typescript
// Correct immutable update
addAITip: (tip: AIRecommendation) => set((state) => ({
  aiTips: [...state.aiTips, tip],
  lastAiUpdate: Date.now()
}))
```

**❌ Anti-Patterns (Avoid These):**

**Wrong Database Naming:**
```typescript
// ❌ Wrong - mixed casing
const result = await pool.query(
  'SELECT Id, AgentId FROM Conversations WHERE conversationId = $1',
  [conversationId]
)
```

**Wrong Message Format:**
```typescript
// ❌ Wrong - inconsistent structure
socket.emit('ai-tip', {  // Wrong: should be SCREAMING_SNAKE_CASE
  conversation_id: 'uuid',  // Wrong: should be camelCase
  Heading: 'test',  // Wrong: should be camelCase
  tip: 'Do something'  // Wrong: should be 'suggestion'
})
```

**Wrong State Mutation:**
```typescript
// ❌ Wrong - direct mutation
addAITip: (tip) => {
  state.aiTips.push(tip)  // Mutates state directly
  return state
}
```

---

## Architecture Document Complete

This architecture defines the complete technical foundation for the AI conversation coaching feature. All major decisions, patterns, and implementation guidelines are documented to ensure consistent development across AI agents and human developers.

**Next Steps:**
1. Review and approve this architecture document
2. Create implementation stories from the "Implementation Sequence" section
3. Begin with backend foundation (Week 1)
4. Deploy and test incrementally

**Document Location:** `/Users/cob/DevAssist/Projects/DevAssist-Call-Coach/docs/architecture.md`
