# DevAssist-Call-Coach

Real-time AI conversation coaching for sales agents during live customer calls. This Chrome extension analyzes ongoing conversations and delivers concise, conversation-first coaching suggestions directly in a side panel, helping sales teams build rapport, identify buying signals, and close more deals.

## Overview

DevAssist-Call-Coach is an intelligent Chrome extension built for internal use by a technical sales team of 10-100 concurrent agents. The system leverages WebRTC audio capture, Deepgram transcription, and OpenAI's GPT-4o-mini to provide contextual coaching suggestions within seconds, keeping conversations on track while maintaining authenticity.

**Project Type:** Chrome Extension with AWS Backend
**Status:** In Development
**Version:** 1.0.0

## Features

### MVP (Phase 1) - Core AI Coaching

**P0 - Critical for Launch:**
- ✅ Real-Time Transcription Display (WebRTC → Deepgram → Side Panel)
- ✅ Progressive AI Analysis (3-min warmup, then 30s intervals)
- ✅ AI Coaching Tips Display (2-word headings + actionable suggestions)
- ✅ WebSocket Backend Communication (Socket.io real-time bidirectional)
- ✅ Start/Stop AI Coaching Control (single-click activation)

**P1 - Important for MVP:**
- 🔨 Conversation State Management (PostgreSQL storage, 30-day retention)
- 🔨 Cost Control Mechanisms (rate limiting, progressive summarization)
- 🔨 Error Handling & Resilience (auto-retry, exponential backoff, graceful degradation)

### Planned (Phase 2) - Post-Launch Enhancements

**P2 - Valuable Additions:**
- Agent Performance Dashboard (conversation history, coaching analytics)
- Team Analytics & Reporting (manager view, conversion tracking)
- Customizable Coaching Personas (industry-specific, focus areas)
- Call Recording Archive (S3 storage, searchable replay)

## Tech Stack

### Frontend (Chrome Extension)
- **Framework:** React 19 + Vite 7
- **Language:** TypeScript 5.9
- **State Management:** Zustand 5.0
- **Styling:** Tailwind CSS 4.1
- **WebSocket Client:** Socket.io Client 4.8
- **Audio Capture:** WebRTC API
- **Transcription:** Deepgram API (real-time WebSocket)

### Backend (AWS)
- **Runtime:** Node.js 20 LTS + Express.js
- **Database:** PostgreSQL 15 (AWS RDS)
- **WebSocket:** Socket.io 4.x
- **AI:** OpenAI GPT-4o-mini (~$0.045/call)
- **Infrastructure:** AWS Elastic Beanstalk (t3.small, auto-scaling 1-4 instances)
- **Load Balancer:** Application Load Balancer with WebSocket support

See [TECH-STACK.md](../../ultrathink-docs/DevAssist-Call-Coach/TECH-STACK.md) for detailed rationale.

## Architecture

The system operates with an additive integration approach - extending existing WebRTC/Deepgram/transcription flow without refactoring working components. Progressive AI analysis strategy: 3-minute warmup collecting quality data, then continuous 30-second interval analysis via OpenAI GPT-4o-mini with context window management through progressive summarization. AWS Elastic Beanstalk deployment achieves 99.9% uptime target and ~$97/month infrastructure cost for 100 concurrent agents.

See [ARCHITECTURE-v1.0.md](../../ultrathink-docs/DevAssist-Call-Coach/ARCHITECTURE-v1.0.md) for complete architecture documentation.

## Getting Started

### Prerequisites

- **Node.js:** 18+ (LTS recommended)
- **npm:** 8+ (comes with Node.js)
- **Chrome Browser:** 110+ (Manifest V3 support)
- **AWS Account:** For backend deployment
- **API Keys:**
  - Deepgram API key (transcription)
  - OpenAI API key (GPT-4o-mini)

### Installation

```bash
# Clone the repository
git clone git@github.com-personal:username/DevAssist-Call-Coach.git
cd DevAssist-Call-Coach

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration:
# - VITE_DEEPGRAM_API_KEY=your_deepgram_key
# - VITE_BACKEND_WS_URL=ws://localhost:3000 (dev) or wss://your-backend.com (prod)
# - VITE_BACKEND_API_KEY=your_shared_api_key

# Run development server
npm run dev
```

### Configuration

**Extension Development:**
1. Run `npm run dev` to start Vite dev server
2. Open Chrome → `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select `dist/` folder from this project
6. Extension will hot-reload on code changes

**Backend Setup:**
See [backend/README.md](backend/README.md) for backend installation and deployment.

### Running the Extension

1. **Start Backend:** Ensure backend is running locally or deployed to AWS
2. **Load Extension:** Follow "Extension Development" steps above
3. **Start a Call:** Open a web page with audio/video call
4. **Activate AI Coaching:**
   - Click extension icon to open side panel
   - Click "Start AI Coaching" button
   - AI will begin analyzing after 3-minute warmup
   - Coaching tips appear every 30 seconds

## Project Structure

```
DevAssist-Call-Coach/
├── backend/                 # Node.js + Express backend (AWS Elastic Beanstalk)
│   ├── src/
│   │   ├── services/       # AI analysis, WebSocket, database services
│   │   ├── models/         # PostgreSQL models
│   │   └── server.ts       # Entry point
│   ├── migrations/         # Database migrations (node-pg-migrate)
│   └── package.json
├── src/                    # Chrome Extension source
│   ├── background/         # Service worker
│   ├── sidepanel/          # React side panel UI
│   ├── offscreen/          # Deepgram WebSocket connection
│   ├── content/            # Content scripts (if needed)
│   └── utils/              # Shared utilities
├── assets/
│   └── icons/              # Extension icons
├── docs/                   # Project documentation
│   ├── architecture.md     # Complete architecture document
│   ├── prd.md              # Product requirements
│   ├── project_context.md  # AI-generated project context
│   ├── DEPLOYMENT-GUIDE.md # Production deployment instructions
│   └── NEXT-STEPS.md       # Prioritized development tasks
├── public/                 # Static assets
├── manifest.json           # Chrome extension manifest V3
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
├── tailwind.config.js      # Tailwind CSS configuration
└── package.json
```

## Documentation

All project documentation is available:

**In this repository:**
- **[architecture.md](docs/architecture.md)** - Complete system architecture (1,097 lines)
- **[project_context.md](docs/project_context.md)** - Critical rules and patterns for AI agents
- **[DEPLOYMENT-GUIDE.md](docs/DEPLOYMENT-GUIDE.md)** - Production deployment instructions
- **[NEXT-STEPS.md](docs/NEXT-STEPS.md)** - Prioritized development tasks

**In UltraThink documentation library:**
- **PRD-v1.0.md** - Product Requirements Document (5,200 words)
- **ARCHITECTURE-v1.0.md** - Integrated architecture
- **TECH-STACK.md** - Technology choices and rationale
- **diagrams/** - Visual documentation (Excalidraw prompts)
  - USER-FLOW-DIAGRAM-PROMPT.md
  - ARCHITECTURE-DIAGRAM-PROMPT.md
  - DATABASE-SCHEMA-DIAGRAM-PROMPT.md

## Development

### Running Tests

```bash
# Run unit tests (when implemented)
npm test

# Run with coverage
npm run test:coverage
```

### Building for Production

```bash
# Build extension
npm run build
# Output: dist/ folder

# Package for Chrome Web Store
cd dist && zip -r ../devassist-call-coach.zip . && cd ..
# Upload devassist-call-coach.zip to Chrome Web Store Developer Dashboard
```

### Code Quality

```bash
# Lint code
npm run lint

# Format code (if configured)
npm run format
```

## Deployment

### Extension Deployment

1. **Build production version:** `npm run build`
2. **Test build:** Load `dist/` folder in Chrome as unpacked extension
3. **Create Chrome Web Store package:** `zip -r extension.zip dist/`
4. **Upload to Chrome Web Store:** Developer Dashboard → Upload new package
5. **Submit for review:** Provide privacy policy, screenshots, description

### Backend Deployment

See [DEPLOYMENT-GUIDE.md](docs/DEPLOYMENT-GUIDE.md) for complete AWS Elastic Beanstalk deployment instructions.

**Quick summary:**
1. Install AWS CLI and EB CLI
2. Configure AWS credentials
3. Create Elastic Beanstalk environment (Node.js 20)
4. Set up RDS PostgreSQL database
5. Configure environment variables
6. Deploy: `eb deploy`
7. Run database migrations
8. Verify deployment and monitor logs

## API Documentation

The backend exposes a WebSocket API for real-time communication:

**WebSocket Connection:**
```javascript
// Extension connects to backend
const socket = io('wss://your-backend.com', {
  auth: { apiKey: 'your_shared_api_key' }
});

// Events
socket.on('connect', () => { /* connected */ });
socket.emit('START_CONVERSATION', { agentId });
socket.emit('TRANSCRIPT', { conversationId, speaker, text, timestamp });
socket.on('AI_TIP', ({ heading, suggestion }) => { /* display tip */ });
socket.on('STATUS_UPDATE', ({ status }) => { /* update UI */ });
```

See [API documentation in architecture.md](docs/architecture.md#api-endpoints) for complete WebSocket event specifications.

## Next Steps

See [NEXT-STEPS.md](docs/NEXT-STEPS.md) for prioritized development tasks.

**Current Phase:** MVP Development (6-8 weeks)
**Current Milestone:** Backend Foundation + AI Integration

**Immediate priorities:**
1. Complete backend AI Analysis Service integration
2. Implement progressive summarization logic
3. Extend Chrome extension Call Store with AI fields
4. Build AITipsSection React component
5. Implement auto-reconnect WebSocket logic
6. Write unit and integration tests
7. Deploy to AWS Elastic Beanstalk staging environment

## Contributing

This is an internal tool for our sales team. Code contributions should follow:

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Make your changes
3. Write/update tests
4. Ensure tests pass (`npm test`)
5. Commit changes (`git commit -m 'feat: add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Create Pull Request for review

## License

Proprietary - Internal Tool

## Contact

**Project Team:** DevAssist Sales Engineering
**Maintained by:** Cob
**Support:** Internal Slack #devassist-call-coach

---

## Key Metrics & Success Criteria

- **Adoption Rate:** Target 80%+ of sales agents within 2 weeks
- **Performance:** <1 second AI latency (P95), 99.9% uptime
- **Cost Efficiency:** <$0.05 per 30-minute call
- **User Satisfaction:** 75%+ agents report AI coaching as "helpful" or "very helpful"

## Architecture Highlights

- **Progressive Analysis:** 3-min warmup → continuous 30-second intervals
- **Cost Control:** Rate limiting + progressive summarization = ~$0.045/call
- **Reliability:** Auto-reconnect with exponential backoff, graceful fallback to transcription-only
- **Scalability:** Auto-scaling 1-4 instances supports 100+ concurrent agents
- **Security:** HTTPS/WSS only, API key auth, CORS restricted to extension origin

---

**🤖 Generated with [UltraThink Project Initialization](https://github.com/ultrathink)** - 2025-12-23

Co-Authored-By: Jarvis (UltraThink Orchestrator) <noreply@ultrathink.ai>
Co-Authored-By: Maven (Product Manager) <noreply@ultrathink.ai>
Co-Authored-By: Aria (Frontend Architect) <noreply@ultrathink.ai>
Co-Authored-By: Atlas (Backend Architect) <noreply@ultrathink.ai>
