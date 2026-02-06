# Next Steps - DevAssist-Call-Coach

**Version:** 1.0
**Created:** 2025-12-23
**Your Role:** Lead Developer
**Current Phase:** MVP Development (Weeks 1-8)

## Overview

Your project structure is complete with comprehensive documentation and architecture! This document outlines prioritized development tasks based on the approved PRD and 6-8 week implementation timeline across 12 milestones.

## ✅ Already Complete

- [x] Project structure created
- [x] Architecture documented (1,097 lines, production-ready)
- [x] PRD created and approved (5,200 words)
- [x] Tech stack decisions finalized
- [x] Documentation library established
- [x] UltraThink integration complete
- [x] Git repository initialized
- [x] Frontend dependencies installed (React 19, Vite 7, Zustand, Socket.io client)
- [x] README.md with comprehensive setup instructions
- [x] DEPLOYMENT-GUIDE.md for AWS and Chrome Web Store

## 🔧 Development Environment Setup

### Local Development Setup

1. **Install backend dependencies:**
   ```bash
   cd backend/
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   # Extension .env
   cp .env.example .env
   # Edit with:
   # VITE_DEEPGRAM_API_KEY=your_deepgram_key
   # VITE_BACKEND_WS_URL=ws://localhost:3000
   # VITE_BACKEND_API_KEY=dev_api_key_12345

   # Backend .env
   cd backend/
   cp .env.example .env
   # Edit with:
   # NODE_ENV=development
   # PORT=3000
   # DATABASE_URL=postgresql://localhost:5432/devassist_dev
   # OPENAI_API_KEY=sk-your-key
   # BACKEND_API_KEY=dev_api_key_12345
   # CORS_ORIGIN=chrome-extension://your-local-extension-id
   # LOG_LEVEL=debug
   ```

3. **Set up local PostgreSQL database:**
   ```bash
   # Install PostgreSQL (macOS)
   brew install postgresql@15
   brew services start postgresql@15

   # Create development database
   createdb devassist_dev

   # Run migrations (once backend migrations are created)
   cd backend/
   npm run migrate up
   ```

4. **Start development servers:**
   ```bash
   # Terminal 1: Backend
   cd backend/
   npm run dev

   # Terminal 2: Extension
   cd /Users/cob/DevAssist/Projects/DevAssist-Call-Coach
   npm run dev
   ```

5. **Load extension in Chrome:**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `dist/` folder
   - Note extension ID for CORS configuration

6. **Verify setup:**
   - [x] Backend runs on http://localhost:3000
   - [x] Extension loads without errors
   - [x] WebSocket connection establishes
   - [x] Deepgram transcription working (from existing implementation)

---

## 📋 MVP Development Timeline (6-8 Weeks, 12 Milestones)

### Week 1-2: Backend Foundation (Milestones 1-2)

#### ✅ Milestone 1: AWS Infrastructure Setup

**Tasks:**
- [ ] Create AWS account and configure credentials
- [ ] Provision Elastic Beanstalk environment (Node.js 20)
- [ ] Set up RDS PostgreSQL 15 instance
- [ ] Configure environment variables
- [ ] Test deployment to staging environment

**Acceptance Criteria:**
- Elastic Beanstalk environment running
- PostgreSQL database accessible from EB instances
- Environment variables configured correctly
- Health check endpoint responds 200 OK

**Reference:** [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) Part 1

---

#### 🔨 Milestone 2: Core Backend Services (HIGH PRIORITY)

**Priority 1: Database Schema & Migrations**

Create database schema based on architecture:

- [ ] Set up `node-pg-migrate` in backend
- [ ] Create migration 001: Initial schema
  - conversations table (id, agent_id, start_time, end_time, status, metadata)
  - transcripts table (id, conversation_id, speaker, text, timestamp, is_final)
  - ai_recommendations table (id, conversation_id, heading, suggestion, created_at)
  - conversation_summaries table (id, conversation_id, time_range, summary, created_at)
  - Indexes on conversation_id, timestamp, agent_id
  - Foreign keys with CASCADE DELETE
- [ ] Create migration 002: Data retention cleanup function
- [ ] Test migrations locally (up/down)
- [ ] Document database schema in README

**Files to create:**
- `backend/migrations/001_initial_schema.sql`
- `backend/migrations/002_retention_cleanup.sql`
- `backend/src/models/Conversation.ts`
- `backend/src/models/Transcript.ts`
- `backend/src/models/AIRecommendation.ts`

**Reference:** [architecture.md - Database Schema](architecture.md#database-schema)

---

**Priority 2: Socket.io WebSocket Server**

Implement real-time communication:

- [ ] Create `backend/src/server.ts` - Express + Socket.io setup
- [ ] Create `backend/src/services/WebSocketService.ts`
  - Handle connection/disconnection
  - Authenticate via API key on handshake
  - Room management per conversation
  - Event handlers: START_CONVERSATION, TRANSCRIPT, DISCONNECT
- [ ] Implement connection pooling for PostgreSQL (pg-pool)
- [ ] Add structured logging with Winston (JSON format for CloudWatch)
- [ ] Add Helmet.js security headers
- [ ] Configure CORS for extension origin
- [ ] Write unit tests for WebSocket event handlers

**Files to create:**
- `backend/src/server.ts`
- `backend/src/services/WebSocketService.ts`
- `backend/src/services/DatabaseService.ts`
- `backend/src/utils/logger.ts`
- `backend/tests/websocket.test.ts`

**Acceptance Criteria:**
- WebSocket server runs on PORT 3000
- Extension can connect via Socket.io client
- API key authentication works
- Transcripts persist to database
- Structured logs output to console

**Reference:** [architecture.md - API & Communication Patterns](architecture.md#communication-patterns-websocket)

---

### Week 2-3: AI Integration (Milestones 3-4)

#### 🔨 Milestone 3: OpenAI Integration (HIGH PRIORITY)

**Priority 1: AI Analysis Service**

Implement GPT-4o-mini analysis:

- [ ] Create `backend/src/services/AIAnalysisService.ts`
  - OpenAI client configuration (GPT-4o-mini)
  - Progressive analysis logic:
    - Detect 3-minute warmup completion
    - Trigger analysis every 30 seconds after warmup
    - Rate limiting: max 1 analysis per 30s per conversation
  - Prompt engineering:
    - System role: "You are a conversation coach for sales agents..."
    - Context: conversation summary + recent transcripts
    - Task: Generate 2-word heading + 1-sentence suggestion
  - Token usage tracking for cost monitoring
- [ ] Create `backend/src/services/PromptBuilder.ts`
  - Build system prompt
  - Format conversation context
  - Manage token limits (stay within GPT-4o-mini context window)
- [ ] Implement error handling with retry logic (3 attempts, exponential backoff)
- [ ] Write unit tests with mocked OpenAI responses

**Files to create:**
- `backend/src/services/AIAnalysisService.ts`
- `backend/src/services/PromptBuilder.ts`
- `backend/src/types/AITypes.ts`
- `backend/tests/ai-analysis.test.ts`

**Acceptance Criteria:**
- AI analysis triggered after 3-minute warmup
- Subsequent analyses every 30 seconds
- Coaching tips have 2-word heading + suggestion
- Errors handled gracefully (retry 3x, then fallback)
- Cost per 30-min call ~$0.045

**Reference:** [architecture.md - AI Analysis Strategy](architecture.md#ai-analysis-strategy)

---

**Priority 2: Progressive Summarization**

Manage context window efficiently:

- [ ] Create `backend/src/services/SummarizationService.ts`
  - Summarize conversations in 10-minute segments
  - Store summaries in conversation_summaries table
  - Use summaries + recent transcripts for AI context
  - Prevent token overflow
- [ ] Implement conversation state tracking (active, completed, summarized)
- [ ] Write integration tests for summarization logic

**Files to create:**
- `backend/src/services/SummarizationService.ts`
- `backend/tests/summarization.test.ts`

**Acceptance Criteria:**
- Summaries generated every 10 minutes
- AI context uses: summaries (older) + full transcripts (recent 2-3 min)
- Token count stays within GPT-4o-mini limits
- Summaries persisted to database

**Reference:** [architecture.md - Progressive Summarization](architecture.md#progressive-summarization)

---

#### ✅ Milestone 4: Error Handling & Resilience

**Tasks:**

- [ ] Implement exponential backoff retry logic (1s, 2s, 4s)
- [ ] Add auto-reconnection for WebSocket disconnects
- [ ] Implement graceful degradation:
  - If AI fails: continue transcription, notify extension
  - If database fails: log error, retry, notify extension
  - If OpenAI rate limited: pause analysis, resume after cooldown
- [ ] Create error response types and standardized error messages
- [ ] Add health check endpoint: `GET /health`
- [ ] Write error handling tests

**Files to create/update:**
- `backend/src/utils/retryLogic.ts`
- `backend/src/utils/errorHandler.ts`
- `backend/src/types/ErrorTypes.ts`
- `backend/tests/error-handling.test.ts`

**Acceptance Criteria:**
- 3 automatic retry attempts on failures
- Friendly error messages sent to extension
- Extension continues transcription if AI fails
- Health endpoint returns 200 OK with status

**Reference:** [architecture.md - Error Handling](architecture.md#error-handling)

---

### Week 3-4: Chrome Extension Integration (Milestones 5-6)

#### 🔨 Milestone 5: Extension Backend Service (HIGH PRIORITY)

**Priority 1: AIBackendService WebSocket Client**

Extend extension to communicate with backend:

- [ ] Create `src/services/AIBackendService.ts`
  - Socket.io client connection to backend WebSocket
  - Auto-reconnect with session resume (store conversation_id)
  - API key authentication on handshake
  - Event emitters:
    - `emit('START_CONVERSATION', { agentId })`
    - `emit('TRANSCRIPT', { conversationId, speaker, text, timestamp })`
  - Event listeners:
    - `on('AI_TIP', callback)` - receive coaching tips
    - `on('STATUS_UPDATE', callback)` - connection status
    - `on('ERROR', callback)` - error messages
- [ ] Implement reconnection logic with exponential backoff
- [ ] Store conversation state in chrome.storage.local
- [ ] Write unit tests with mocked Socket.io

**Files to create:**
- `src/services/AIBackendService.ts`
- `src/types/BackendTypes.ts`
- `tests/ai-backend-service.test.ts`

**Acceptance Criteria:**
- WebSocket connects to backend successfully
- API key sent on handshake
- Transcripts forwarded to backend in real-time
- AI tips received and logged
- Auto-reconnect works on network disconnection

**Reference:** [architecture.md - Extension Architecture](architecture.md#extension-architecture-additive-approach)

---

#### 🔨 Milestone 6: Extended Call Store

**Priority 1: Zustand State Management**

Extend existing call-store.ts with AI fields:

- [ ] Add AI-related fields to call store:
  ```typescript
  interface CallStore {
    // Existing fields (preserve):
    transcriptions: Transcription[];
    isRecording: boolean;
    // New AI fields:
    aiTips: AITip[];
    aiStatus: 'loading' | 'ready' | 'error' | 'reconnecting';
    conversationId: string | null;
    aiStartTime: number | null;
  }
  ```
- [ ] Add AI actions:
  - `setAIStatus(status)`
  - `addAITip(tip)`
  - `clearAITips()`
  - `setConversationId(id)`
- [ ] Ensure immutable state updates (no direct mutations)
- [ ] Integrate AIBackendService with call store
- [ ] Write tests for AI state updates

**Files to update/create:**
- `src/stores/call-store.ts` (extend existing)
- `src/types/CallTypes.ts` (add AI types)
- `tests/call-store.test.ts`

**Acceptance Criteria:**
- AI fields available in call store
- State updates trigger React re-renders
- Immutable update patterns followed
- Integration with existing transcription flow works

**Reference:** [architecture.md - State Management](architecture.md#state-management-zustand)

---

### Week 4-5: UI & User Experience (Milestones 7-8)

#### 🔨 Milestone 7: AI Tips UI Component (HIGH PRIORITY)

**Priority 1: AITipsSection React Component**

Create UI to display coaching tips:

- [ ] Create `src/sidepanel/components/AITipsSection.tsx`
  - Display list of AI coaching tips
  - 2-word heading in bold, large font
  - Suggestion text below heading
  - Timestamp for each tip
  - Auto-scroll to latest tip
  - "No tips yet" placeholder during warmup
- [ ] Create `src/sidepanel/components/AIStatusIndicator.tsx`
  - Loading: "🧠 AI is learning the conversation..." (0-3 min)
  - Ready: "✅ AI Ready" (after 3 min, continuous analysis)
  - Error: "⚠️ AI temporarily unavailable"
  - Reconnecting: "🔄 Reconnecting..."
- [ ] Style with Tailwind CSS (match existing UI design)
- [ ] Add animations with Framer Motion (smooth tip appearance)
- [ ] Integrate with call store (subscribe to aiTips and aiStatus)

**Files to create:**
- `src/sidepanel/components/AITipsSection.tsx`
- `src/sidepanel/components/AIStatusIndicator.tsx`
- `src/sidepanel/components/AITipCard.tsx`
- `src/sidepanel/styles/ai-tips.css` (if needed beyond Tailwind)

**Acceptance Criteria:**
- Tips display in side panel below transcription
- 2-word heading format enforced
- Auto-scroll to latest tip
- Status indicator updates based on AI state
- Responsive design works on different screen sizes

**Reference:** [architecture.md - Extension UI Components](architecture.md#ui-components)

---

#### ✅ Milestone 8: Start/Stop Controls

**Priority 1: AI Coaching Button**

Add user control for AI coaching:

- [ ] Create "Start AI Coaching" button in side panel
- [ ] On click:
  - Call `AIBackendService.startConversation(agentId)`
  - Update call store: `setAIStatus('loading')`
  - Show loading indicator
- [ ] Disable button during call (can't restart mid-call)
- [ ] Add "Stop AI Coaching" button (optional, for testing)
- [ ] Background processing - doesn't interrupt transcription
- [ ] Show error messages if connection fails

**Files to update:**
- `src/sidepanel/SidePanel.tsx` (add button)
- `src/sidepanel/components/AIControlButton.tsx` (new component)

**Acceptance Criteria:**
- Single-click activation
- Status changes: loading → ready after 3 min
- Doesn't interfere with transcription display
- User-friendly error messages

**Reference:** [PRD - User Stories](../../ultrathink-docs/DevAssist-Call-Coach/PRD-v1.0.md#user-stories)

---

### Week 5-6: Testing & Deployment (Milestones 9-10)

#### ✅ Milestone 9: Testing & QA

**Unit Tests:**
- [ ] Backend service tests (WebSocket, AI Analysis, Database)
- [ ] Extension component tests (AITipsSection, Status Indicator)
- [ ] State management tests (call-store with AI fields)
- Target: 80%+ code coverage

**Integration Tests:**
- [ ] WebSocket flow: Extension → Backend → Database → AI → Extension
- [ ] Error scenarios: Network disconnect, AI failure, database timeout
- [ ] Progressive analysis timing: 3-min warmup, 30s intervals

**Manual Testing:**
- [ ] Load test with 10 concurrent agents (simulate real usage)
- [ ] Test on live sales call (with permission)
- [ ] Verify AI suggestions are relevant and helpful
- [ ] Check cost per call (~$0.045 target)

**Files to create:**
- `backend/tests/integration/websocket-flow.test.ts`
- `backend/tests/integration/ai-analysis-flow.test.ts`
- `tests/integration/extension-backend-flow.test.ts`
- `tests/manual-test-plan.md`

**Acceptance Criteria:**
- All tests passing
- 80%+ code coverage
- No critical bugs
- Manual test plan executed successfully

---

#### ✅ Milestone 10: Production Deployment

**Backend Deployment:**
- [ ] Follow [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) Part 1
- [ ] Deploy to AWS Elastic Beanstalk
- [ ] Run database migrations in production
- [ ] Configure CloudWatch logging and alarms
- [ ] Test WebSocket connection from extension

**Extension Deployment:**
- [ ] Build production extension (`npm run build`)
- [ ] Test production build locally
- [ ] Follow [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) Part 2
- [ ] Submit to Chrome Web Store (private distribution)
- [ ] Update backend CORS with extension ID
- [ ] Distribute to sales team (5-10 agents for beta)

**Acceptance Criteria:**
- Backend deployed and accessible via WSS
- Extension available in Chrome Web Store
- Beta team has extension installed
- Monitoring and logging configured
- Backup and disaster recovery verified

---

### Week 6-8: Beta & Iteration (Milestones 11-12)

#### ✅ Milestone 11: Internal Beta

**Tasks:**
- [ ] Onboard 5-10 beta agents
- [ ] Provide training documentation
- [ ] Collect feedback via survey
- [ ] Monitor CloudWatch metrics:
  - AI latency (<1s P95)
  - WebSocket connection success (95%+)
  - Error rate (<5%)
  - Cost per call (~$0.045)
- [ ] Fix bugs identified during beta
- [ ] Optimize performance based on metrics

**Feedback Collection:**
- [ ] Create feedback form (Google Forms or Typeform)
- [ ] Track:
  - Suggestion relevance (1-5 scale)
  - UI usability (1-5 scale)
  - Performance (fast/slow)
  - Feature requests
  - Bugs encountered

**Acceptance Criteria:**
- 5-10 agents actively using for 1-2 weeks
- Feedback collected and analyzed
- Critical bugs fixed
- Performance metrics meet targets

---

#### ✅ Milestone 12: Full Rollout

**Tasks:**
- [ ] Onboard remaining sales team (up to 100 agents)
- [ ] Distribute training materials
- [ ] Set up #devassist-call-coach Slack channel for support
- [ ] Monitor metrics for 2 weeks post-rollout
- [ ] Create runbook for common operational issues
- [ ] Schedule weekly check-ins with team

**Success Metrics (track for 1 month):**
- [ ] Adoption Rate: 80%+ agents using within 2 weeks
- [ ] Daily Active Users: 60%+ agents using daily
- [ ] AI Latency: <1s P95
- [ ] Uptime: 99.9% during business hours
- [ ] Cost: <$0.05 per call
- [ ] Agent Satisfaction: 75%+ rate as "helpful" or "very helpful"

**Acceptance Criteria:**
- All agents onboarded successfully
- Success metrics tracking in place
- Support processes established
- Post-launch support plan activated

---

## 🚀 Recommended First Task

**Start Here (This Week):**

### 1. Set Up Backend Development Environment

```bash
# 1. Create backend package.json (if not exists)
cd backend/
npm init -y

# 2. Install core dependencies
npm install express socket.io pg dotenv winston helmet cors
npm install -D typescript @types/node @types/express ts-node-dev nodemon

# 3. Create tsconfig.json
npx tsc --init --target ES2022 --module commonjs --outDir dist

# 4. Create basic server.ts
mkdir -p src
touch src/server.ts

# 5. Add scripts to package.json:
# "dev": "ts-node-dev --respawn src/server.ts"
# "build": "tsc"
# "start": "node dist/server.js"
```

**Estimated Time:** 2-4 hours

**Success Criteria:**
- Backend runs on localhost:3000
- Health endpoint responds 200 OK
- Structured logging outputs to console

---

### 2. Implement Database Schema & Migrations

```bash
# 1. Install migration tool
npm install node-pg-migrate

# 2. Create migrations folder
mkdir -p migrations

# 3. Create first migration
npx node-pg-migrate create initial-schema

# 4. Edit migration file with schema from architecture.md
# See: Database Schema section

# 5. Run migration locally
npx node-pg-migrate up
```

**Estimated Time:** 4-6 hours

**Success Criteria:**
- All 4 tables created (conversations, transcripts, ai_recommendations, conversation_summaries)
- Indexes in place
- Foreign keys with CASCADE DELETE
- Can query tables via psql

---

### 3. Implement WebSocket Server

**See Milestone 2, Priority 2 above**

**Estimated Time:** 8-12 hours

**Success Criteria:**
- Extension can connect via Socket.io
- Transcripts persist to database
- Structured logs output

---

## 📚 Documentation to Review Before Coding

1. **[architecture.md](architecture.md)** - Read sections:
   - Database Schema
   - API & Communication Patterns
   - Implementation Patterns & Consistency Rules
   - Progressive Analysis Strategy

2. **[project_context.md](project_context.md)** - Critical rules for AI agents (read if using AI assistance)

3. **[PRD-v1.0.md](../../ultrathink-docs/DevAssist-Call-Coach/PRD-v1.0.md)** - User stories and success metrics

4. **[TECH-STACK.md](../../ultrathink-docs/DevAssist-Call-Coach/TECH-STACK.md)** - Technology choices and rationale

---

## 🎨 Visual Documentation Resources

Create diagrams using Excalidraw:

1. **User Flow Diagram:**
   - File: `../../ultrathink-docs/DevAssist-Call-Coach/diagrams/USER-FLOW-DIAGRAM-PROMPT.md`
   - Copy prompt → Paste in Excalidraw text-to-diagram

2. **Architecture Diagram:**
   - File: `../../ultrathink-docs/DevAssist-Call-Coach/diagrams/ARCHITECTURE-DIAGRAM-PROMPT.md`
   - Visualize system components and data flow

3. **Database Schema Diagram:**
   - File: `../../ultrathink-docs/DevAssist-Call-Coach/diagrams/DATABASE-SCHEMA-DIAGRAM-PROMPT.md`
   - Crow's foot notation with relationships

---

## 🔄 Development Workflow

### Daily Workflow

1. **Start development servers:**
   ```bash
   # Terminal 1: Backend
   cd backend && npm run dev

   # Terminal 2: Extension
   npm run dev

   # Terminal 3: Database (if needed)
   psql devassist_dev
   ```

2. **Make changes → Test → Commit:**
   ```bash
   # Make changes to files
   # Extension hot-reloads automatically

   # Test manually in Chrome
   # Check console logs

   # Commit when feature complete
   git add .
   git commit -m "feat: implement AI tips display component"
   git push origin main
   git push work main  # Multi-remote backup
   ```

3. **End of day:**
   - Document blockers or questions
   - Update progress in NEXT-STEPS.md (check off completed tasks)
   - Plan tomorrow's tasks

### Weekly Workflow

- **Monday:** Review week's milestone, plan daily tasks
- **Wednesday:** Mid-week check-in, adjust if behind schedule
- **Friday:** Review completed work, demo to stakeholders (if applicable), plan next week

---

## 🆘 Getting Help

### Internal Resources
- **Slack:** #devassist-call-coach
- **Email:** devassist-support@yourcompany.com
- **Documentation:** All docs in `docs/` and `ultrathink-docs/DevAssist-Call-Coach/`

### External Resources
- **Socket.io Docs:** https://socket.io/docs/v4/
- **OpenAI API Docs:** https://platform.openai.com/docs/
- **AWS Elastic Beanstalk:** https://docs.aws.amazon.com/elasticbeanstalk/
- **Chrome Extension Manifest V3:** https://developer.chrome.com/docs/extensions/mv3/
- **PostgreSQL Docs:** https://www.postgresql.org/docs/15/

---

## ✅ Progress Tracking

Update this section as you complete tasks:

**Week 1-2 (Backend Foundation):**
- [ ] Milestone 1: AWS Infrastructure Setup
- [ ] Milestone 2: Core Backend Services

**Week 2-3 (AI Integration):**
- [ ] Milestone 3: OpenAI Integration
- [ ] Milestone 4: Error Handling & Resilience

**Week 3-4 (Extension Integration):**
- [ ] Milestone 5: Extension Backend Service
- [ ] Milestone 6: Extended Call Store

**Week 4-5 (UI & UX):**
- [ ] Milestone 7: AI Tips UI Component
- [ ] Milestone 8: Start/Stop Controls

**Week 5-6 (Testing & Deployment):**
- [ ] Milestone 9: Testing & QA
- [ ] Milestone 10: Production Deployment

**Week 6-8 (Beta & Iteration):**
- [ ] Milestone 11: Internal Beta
- [ ] Milestone 12: Full Rollout

---

**🎯 You've got a solid foundation. Now build something amazing!**

**Generated by UltraThink Project Initialization** - 2025-12-23
