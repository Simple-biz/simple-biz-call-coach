---
project_name: 'DevAssist-Call-Coach'
user_name: 'Cob'
date: '2025-12-17'
sections_completed: ['technology_stack', 'language_specific', 'framework_specific', 'testing', 'code_quality', 'workflow', 'critical_rules']
existing_patterns_found: 47
status: 'complete'
rule_count: 181
optimized_for_llm: true
last_updated: '2025-12-17'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

**Core Technologies:**
- **TypeScript**: 5.9.3 (ES2020 target, strict mode enabled)
- **React**: 19.2.0 with React DOM 19.2.0 (latest major version)
- **Node.js**: 20.x LTS (target runtime)
- **Vite**: 7.1.12 (build tool and dev server)

**Chrome Extension Framework:**
- **Manifest V3**: Chrome Extension architecture (NO Manifest V2 support)
- **@crxjs/vite-plugin**: 2.2.1 (Chrome extension dev plugin with HMR)
- **@types/chrome**: 0.1.27 (Chrome API type definitions)

**State Management:**
- **Zustand**: 5.0.8 (React state management)
- **Chrome Storage API**: Persistence across extension lifecycle

**UI & Styling:**
- **Tailwind CSS**: 4.1.16 with PostCSS 8.5.6
- **Framer Motion**: 12.23.24 (animations)
- **Class Utilities**: class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.3.1
- **Lucide React**: 0.548.0 (icons)

**External Integrations:**
- **Socket.io Client**: 4.8.1 (WebSocket for AI backend)
- **Deepgram**: Live transcription via WebSocket (nova-2 model)

**Testing:**
- **Playwright Utils**: @seontechnologies/playwright-utils 3.10.1

**Build Configuration:**
- **Module Type**: ESM (ES Modules only)
- **TypeScript moduleResolution**: "bundler"
- **Path Aliases**: `@/*` maps to `./src/*`

**Critical Version Constraints:**
- React 19.x requires matching type definitions (@types/react 19.2.2+)
- Tailwind CSS 4.x uses new PostCSS architecture (breaking change from v3)
- Chrome Manifest V3 ONLY - no backward compatibility with V2
- Node.js 20.x required for modern ESM and top-level await support

---

## Critical Implementation Rules

### Language-Specific Rules (TypeScript/JavaScript)

**TypeScript Configuration Requirements:**
- **Strict Mode Enabled**: All strict TypeScript checks are required (`strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- **Module Resolution**: Use `"bundler"` mode (NOT `"node"` or `"node16"`)
- **Path Aliases**: ALWAYS use `@/*` for imports from `src/` directory (e.g., `import { CallStore } from "@/stores/call-store"`)
- **JSX Transform**: Use React 17+ JSX transform (`"jsx": "react-jsx"`) - NO manual `import React` needed
- **No Emit**: TypeScript is for type checking only; Vite handles transpilation (`noEmit: true`)

**Type Definition Patterns:**
- **Centralized Types**: ALL shared types MUST be defined in `src/types/index.ts` (NOT scattered in component files)
- **Interface Naming**: PascalCase for all interfaces and types (`CallSession`, `AIRecommendation`, `TranscriptPayload`)
- **Union Type Patterns**: Use string literal unions for state values (e.g., `type CallState = "inactive" | "detecting" | "active"`)
- **Optional Properties**: Use `?` for optional fields, NOT `| undefined` in type definitions

**Import/Export Conventions:**
- **Named Exports**: Prefer named exports over default exports (easier to refactor)
- **Type Imports**: Use `import type` for type-only imports to ensure tree-shaking
- **Barrel Exports**: `src/types/index.ts` uses barrel pattern; import from barrel, not individual type files

**Chrome Extension Context Isolation:**
- **Content Scripts**: Run in isolated world - CANNOT access page's JavaScript variables directly
- **Page Context Injection**: Scripts injected via `<script>` tag run in page context and CAN access `window` objects
- **Cross-Context Communication**: Use `window.postMessage()` for page context ↔ content script communication
- **MessagePort Pattern**: Use MessagePort for high-performance streaming (audio data), NOT postMessage

**Async/Await Patterns:**
- **Chrome API Promises**: Modern Chrome APIs return promises; use async/await (NOT callbacks)
- **Error Handling**: ALWAYS wrap chrome API calls in try/catch blocks
- **Storage Operations**: `chrome.storage.local.get/set` are async - await them before using values

**Immutable State Updates:**
- **Zustand Pattern**: ALWAYS use immutable updates with spread operators
- **Correct**: `set((state) => ({ transcriptions: [...state.transcriptions, newItem] }))`
- **WRONG**: `state.transcriptions.push(newItem)` - NEVER mutate state directly

---

### Framework-Specific Rules (React & Chrome Extension)

**React 19.x Patterns:**
- **No Legacy Features**: React 19 removes legacy APIs - NO `ReactDOM.render`, use `ReactDOM.createRoot` only
- **Automatic Batching**: State updates are automatically batched in all contexts (events, promises, timeouts)
- **Concurrent Features**: React 19 is concurrent by default - be aware of re-rendering behavior
- **Hook Rules**: Follow Rules of Hooks strictly - hooks only in components/custom hooks, always at top level

**Component Structure Conventions:**
- **File Naming**: PascalCase for component files matching component name (`Popup.tsx`, `SidePanel.tsx`, `AITipsSection.tsx`)
- **Single Responsibility**: One primary component per file (helper components can be co-located if only used there)
- **Props Types**: Define props interface inline or in types file (e.g., `interface PopupProps { ... }`)

**Zustand State Management Patterns:**
- **Store Files**: One store per file in `src/stores/` directory (`call-store.ts`, `settings-store.ts`)
- **Immutable Updates**: ALWAYS use functional updates with spread operators
- **Persistence Pattern**: Sync critical state to `chrome.storage.local` manually (Zustand middleware not compatible with chrome.storage)
- **State Loading**: Load persisted state in store initialization with async `loadFromStorage()` action
- **Selectors**: Use selectors in components to prevent unnecessary re-renders: `const transcriptions = useCallStore(state => state.transcriptions)`

**Chrome Extension Architecture (Manifest V3):**
- **Service Worker Lifecycle**: Background service worker may sleep - design for stateless operation or persist state
- **Offscreen Document**: Required for tab audio capture; can only create ONE offscreen document at a time
- **Offscreen Lifecycle**: Check for existing offscreen with `chrome.offscreen.hasDocument()` before creating new one
- **Content Script Injection**: `run_at: "document_start"` REQUIRED for WebRTC interceptor (must load before page's WebRTC calls)
- **Web Accessible Resources**: Scripts in `web_accessible_resources` can be injected into page context via `<script>` tag

**Message Passing Architecture:**
- **Port Connections**: Use `chrome.runtime.connect()` for persistent connections (content ↔ background)
- **Port Reconnection**: Ports disconnect when service worker sleeps - implement reconnection logic with exponential backoff
- **Runtime Messages**: Use `chrome.runtime.sendMessage()` for one-off messages (popup/sidepanel ↔ background)
- **Storage Events**: Use `chrome.storage.onChanged` listener for state sync across contexts
- **Message Type Pattern**: All messages MUST have `{ type: string, payload?: any }` structure with SCREAMING_SNAKE_CASE types

**WebRTC Audio Capture Pattern:**
- **Interceptor Injection**: Inject `webrtc-interceptor.ts` into page context to proxy `RTCPeerConnection`
- **Stream Access**: Retrieve intercepted streams via `window.__getInterceptedStreams()` function exposed by interceptor
- **MessagePort for Audio**: Use MessageChannel for audio streaming (bypasses serialization overhead of postMessage)
- **Audio Format**: Convert Float32Array to Int16Array for Deepgram compatibility (linear16 encoding)
- **Dual Channel**: Support separate caller (remote) and agent (local) audio tracks with speaker labels

**Error Boundary Pattern:**
- **Required in UI Roots**: Wrap popup and sidepanel roots with ErrorBoundary component
- **Fallback UI**: Provide user-friendly error messages for component crashes
- **Error Logging**: Log errors to console with context for debugging

**Styling with Tailwind CSS 4.x:**
- **Utility-First**: Use Tailwind utility classes, avoid custom CSS when possible
- **Class Merging**: Use `tailwind-merge` for conditional classes to prevent conflicts
- **Variant Utilities**: Use `class-variance-authority` for component variants
- **Dynamic Classes**: Use `clsx` for conditional class names

---

### Testing Rules

**Test Framework Setup (Not Yet Implemented):**
- **E2E Testing**: Use Playwright with @seontechnologies/playwright-utils for Chrome extension testing
- **Unit Testing**: Recommend Vitest for unit tests (fast, Vite-native, ESM support)
- **Chrome Extension Testing**: Use Playwright's Chrome extension testing capabilities for end-to-end scenarios

**Test File Naming & Organization:**
- **Pattern**: `{filename}.test.ts` or `{filename}.test.tsx` (NOT `.spec.ts`)
- **Location**: Co-locate test files with source files OR create separate `tests/` directory
- **Example**: `src/stores/call-store.test.ts` or `tests/stores/call-store.test.ts`
- **E2E Tests**: Place in `tests/e2e/` directory separate from unit tests

**Chrome Extension Testing Challenges:**
- **Manifest V3**: Service worker lifecycle makes testing complex - use Playwright's extension testing
- **Context Isolation**: Content scripts and page scripts run in different contexts - test each separately
- **Async State**: Chrome storage operations are async - always await in tests
- **Port Connections**: Mock port connections for unit testing message passing
- **Offscreen Document**: Cannot easily test offscreen audio capture - mock MediaStream APIs

**Zustand Store Testing:**
- **Test Actions**: Test store actions update state correctly with immutable patterns
- **Test Selectors**: Verify selectors return correct derived state
- **Mock Storage**: Mock `chrome.storage.local` API for store persistence tests
- **Isolation**: Reset store state between tests to prevent test interdependence

**Component Testing:**
- **React Testing Library**: Use if unit testing React components (not yet configured)
- **Mock Chrome APIs**: Mock all `chrome.*` APIs in component tests
- **Mock Zustand Stores**: Provide test store instances with known state
- **Error Boundaries**: Test that ErrorBoundary catches and displays component errors

**Mock Patterns:**
- **Chrome API Mocking**: Create mock implementations of `chrome.runtime`, `chrome.storage`, `chrome.tabs`, etc.
- **WebSocket Mocking**: Mock Socket.io client for AI backend communication tests
- **Audio Stream Mocking**: Mock MediaStream and AudioContext for audio capture tests
- **Deepgram Mocking**: Mock WebSocket transcription responses for integration tests

**Test Coverage Goals (When Implemented):**
- **Stores**: 100% coverage (critical state management logic)
- **Services**: 90%+ coverage (business logic)
- **Components**: 70%+ coverage (UI logic, focus on interactive elements)
- **Type Definitions**: No coverage needed (TypeScript ensures correctness)

**Integration Test Priorities:**
- **Call Flow**: Test complete flow from call detection → audio capture → transcription → display
- **Message Passing**: Test background ↔ content script ↔ offscreen communication
- **State Sync**: Test state persistence and sync across extension contexts
- **Error Handling**: Test error recovery and reconnection logic

---

### Code Quality & Style Rules

**Linting & Formatting (Not Yet Configured):**
- **Recommended Setup**: ESLint + Prettier for consistent code quality
- **TypeScript ESLint**: Use `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`
- **React ESLint**: Use `eslint-plugin-react` and `eslint-plugin-react-hooks`
- **Auto-fix on Save**: Configure IDE to auto-fix linting issues on save

**File & Folder Structure:**
- **Source Organization**: All source code in `src/` directory
- **Component Organization**: Group by feature/domain (`popup/`, `sidepanel/`, `content/`, `background/`, `offscreen/`)
- **Shared Code**: Place in appropriate directories (`stores/`, `services/`, `types/`, `utils/`, `components/`)
- **No Barrel Exports**: Except for `types/index.ts` - import directly from specific files

**Naming Conventions (Observed Patterns):**
- **Files**:
  - Components: PascalCase (`Popup.tsx`, `SidePanel.tsx`)
  - Services: kebab-case (`ai-coaching-service.ts`, `ai-backend.service.ts`)
  - Stores: kebab-case with suffix (`call-store.ts`, `settings-store.ts`)
  - Types: `index.ts` (centralized)
- **Variables**: camelCase (`transcriptions`, `callState`, `audioLevel`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY_ATTEMPTS`, `DEEPGRAM_MODEL`)
- **Types/Interfaces**: PascalCase (`CallSession`, `AIRecommendation`, `TranscriptPayload`)
- **Functions**: camelCase (`startCall`, `addTranscription`, `handleMessage`)
- **React Components**: PascalCase function declarations (`function Popup()`, `function SidePanel()`)

**Code Organization Patterns:**
- **Imports Order**:
  1. External libraries (React, Zustand, etc.)
  2. Type imports (`import type { ... }`)
  3. Internal imports with `@/` alias
  4. Relative imports
- **Export Pattern**: Named exports at bottom of file (prefer over inline exports)
- **One Concern Per File**: Each file should have single, clear responsibility

**Documentation Requirements:**
- **Emoji Logging**: Use emoji prefixes for console logs to aid visual parsing:
  - 🚀 Initialization
  - 📞 Call events
  - 🎤 Audio capture
  - 📝 Transcription
  - 🔌 Connections
  - ⚠️ Warnings
  - ❌ Errors
  - ✅ Success
- **Complex Logic**: Add comments explaining "why" (not "what") for non-obvious code
- **Chrome Extension Constraints**: Document any workarounds for Manifest V3 limitations
- **Type Documentation**: Use JSDoc comments for complex types when needed

**Code Complexity Rules:**
- **Function Length**: Keep functions focused and concise (ideally < 50 lines)
- **File Length**: Keep files manageable (ideally < 300 lines, refactor if larger)
- **Nesting Depth**: Avoid deep nesting (max 3-4 levels), use early returns
- **DRY Principle**: Extract repeated logic into utility functions or hooks

**Error Handling Standards:**
- **Try-Catch Blocks**: Wrap all Chrome API calls and async operations
- **Error Logging**: Log errors with context (function name, operation, relevant data)
- **User-Facing Errors**: Show friendly messages, log technical details to console
- **Graceful Degradation**: Extension should function partially even if features fail

**Performance Considerations:**
- **Memo Unnecessary Re-renders**: Use React.memo for expensive components
- **Zustand Selectors**: Use specific selectors to prevent unnecessary re-renders
- **Audio Processing**: Use MessagePort (not postMessage) for high-frequency audio data
- **Storage Operations**: Batch chrome.storage writes when possible
- **WebSocket Reconnection**: Implement exponential backoff to prevent connection storms

**Security Practices:**
- **No Secrets in Code**: Never commit API keys or sensitive data
- **Content Security Policy**: Follow Chrome extension CSP restrictions
- **Validate External Data**: Validate all data from Deepgram, AI backend, page context
- **Sanitize User Input**: Escape any user input before rendering in UI

---

### Development Workflow Rules

**Git Branch Strategy:**
- **Main Branch**: `main` is the primary branch
- **Feature Branches**: Not currently used (direct commits to main observed)
- **Recommended**: Consider using feature branches for larger changes (`feature/ai-backend`, `fix/audio-loopback`)
- **Remote Repositories**: Multiple remotes configured (origin, aivate, cobb-simple)

**Commit Message Format:**
- **Conventional Commits**: Use semantic commit types:
  - `feat:` - New features (e.g., "feat: Deepgram WebSocket integration")
  - `fix:` - Bug fixes (e.g., "fix: Resolve UI display bugs in transcription side panel")
  - `docs:` - Documentation changes
  - `refactor:` - Code refactoring without behavior changes
  - `test:` - Adding or updating tests
  - `chore:` - Maintenance tasks (dependencies, configs)
  - `style:` - Formatting, whitespace changes
- **Format**: `<type>: <description>` with clear, concise description
- **Description**: Start with verb, describe what the commit does (not what you did)
- **Examples**:
  - ✅ `feat: Add WebSocket reconnection with exponential backoff`
  - ✅ `fix: Prevent offscreen document creation race condition`
  - ❌ `updated stuff` - too vague, no type prefix

**Build & Deployment Workflow:**
- **Development**: `npm run dev` - Vite dev server with HMR
- **Build**: `npm run build` - TypeScript compilation + Vite production build
- **Output**: `dist/` directory (gitignored, created on build)
- **Extension Loading**:
  1. Run `npm run build`
  2. Open `chrome://extensions/`
  3. Enable "Developer mode"
  4. Click "Load unpacked" → select `dist/` folder
  5. Reload extension after each rebuild

**Environment Variables:**
- **Not Committed**: `.env` and `.env.local` are gitignored
- **API Keys**: Store Deepgram API key, backend API key in chrome.storage (user-configured)
- **No .env for Extension**: Chrome extensions don't use .env files - store config in chrome.storage.local

**Git Ignore Patterns:**
- **Build Artifacts**: `dist/`, `build/`
- **Dependencies**: `node_modules/`, `package-lock.json` (gitignored but typically committed)
- **Environment**: `.env`, `.env.local`
- **IDE Settings**: `.vscode/`, `.idea/`
- **OS Files**: `.DS_Store`, `Thumbs.db`
- **Logs**: `*.log`, `npm-debug.log*`
- **Chrome Dev Profile**: `.chrome-dev-profile/` (for testing)
- **Claude Settings**: `.claude/settings.local.json` (personal settings)

**Code Review Guidelines (When Applicable):**
- **Test Manually**: Load extension and test affected functionality in Chrome
- **Check Console**: Verify no errors in background service worker, content script, or UI contexts
- **Verify Types**: Ensure TypeScript compilation passes with no errors
- **Test on CallTools.io**: Verify extension works on target domain
- **Check State Persistence**: Verify state persists across extension reload

**Development Best Practices:**
- **Hot Module Reload**: Use `npm run dev` for faster development iterations
- **Chrome DevTools**: Use appropriate context for debugging:
  - Background: `chrome://extensions` → "Inspect views: service worker"
  - Content script: Inspect CallTools.io page console
  - Popup: Right-click extension icon → "Inspect popup"
  - Side panel: Open side panel → right-click → "Inspect"
  - Offscreen: `chrome://extensions` → "Inspect views: offscreen.html"
- **Extension Reload**: Click reload button in `chrome://extensions/` after rebuilding
- **State Inspection**: Use Chrome DevTools to inspect `chrome.storage.local` for persisted state

**Release Process (Not Yet Defined):**
- **Version Bumping**: Update version in `package.json` and `vite.config.ts` manifest
- **Build for Production**: `npm run build` with production settings
- **Testing**: Full manual testing of all features before release
- **Distribution**: Zip `dist/` folder for Chrome Web Store submission

---

### Critical Don't-Miss Rules

**🚨 Chrome Extension Manifest V3 Critical Rules:**

**Offscreen Document Lifecycle (CRITICAL):**
- ❌ **NEVER create offscreen document without checking if one exists** - Can only have ONE at a time
- ✅ **ALWAYS check first**: `await chrome.offscreen.hasDocument()` before creating
- ❌ **NEVER call `getMediaStreamId()` before offscreen exists** - Will fail silently
- ✅ **Correct Order**: Create offscreen → then call getMediaStreamId → then send to offscreen
- 🐛 **Bug Risk**: Creating multiple offscreen documents crashes the extension

**WebRTC Interceptor Injection Timing (CRITICAL):**
- ❌ **NEVER inject interceptor after `document_end`** - CallTools WebRTC connection happens early
- ✅ **MUST use `run_at: "document_start"`** in manifest content_scripts
- ❌ **NEVER use content script to intercept** - Runs in isolated world, can't access page RTCPeerConnection
- ✅ **MUST inject into page context** - Use web_accessible_resources + script tag injection
- 🐛 **Bug Risk**: Missing audio streams if interceptor loads too late

**Context Isolation Communication (CRITICAL):**
- ❌ **NEVER try to access `window` objects from content script** - Different JavaScript contexts
- ✅ **Page Context → Content Script**: Use `window.postMessage()` only
- ✅ **Content Script → Background**: Use `chrome.runtime.connect()` for persistent connection
- ✅ **High-frequency Audio Data**: Use MessagePort (NOT postMessage) to avoid serialization overhead
- 🐛 **Bug Risk**: Undefined errors when trying to access page variables from content script

**Service Worker Sleep Handling (CRITICAL):**
- ❌ **NEVER assume background service worker stays alive** - Chrome puts it to sleep after 30 seconds
- ✅ **MUST implement port reconnection logic** - Ports disconnect when service worker sleeps
- ✅ **MUST persist critical state** to `chrome.storage.local` - In-memory state lost on sleep
- ❌ **NEVER use setInterval in service worker** - Gets cleared when worker sleeps
- 🐛 **Bug Risk**: Lost state, broken connections, missed messages after service worker wakes

**Audio Processing Critical Rules:**
- ❌ **NEVER send Float32Array directly to Deepgram** - Requires Int16 linear PCM
- ✅ **MUST convert Float32 → Int16**: Multiply by 32767 and clamp
- ❌ **NEVER use deprecated AudioContext methods** - Use ScriptProcessor (legacy but works)
- ⚠️ **TODO Migration**: ScriptProcessor deprecated, should migrate to AudioWorklet
- ✅ **Audio Loopback Required**: Connect processors to `audioContext.destination` so agents hear callers
- 🐛 **Bug Risk**: Silent audio if loopback disconnected, wrong audio format causes Deepgram errors

**State Management Critical Rules:**
- ❌ **NEVER mutate Zustand state directly** - `state.array.push()` breaks reactivity
- ✅ **ALWAYS use immutable updates**: `set((state) => ({ array: [...state.array, item] }))`
- ❌ **NEVER assume Zustand middleware works with chrome.storage** - Must sync manually
- ✅ **MUST await chrome.storage operations** - All chrome.storage APIs are async
- 🐛 **Bug Risk**: Silent state corruption, UI not updating, race conditions

**Message Passing Anti-Patterns:**
- ❌ **NEVER use runtime.sendMessage for persistent connections** - Use ports instead
- ❌ **NEVER forget to remove listeners** - Causes memory leaks and duplicate handlers
- ❌ **NEVER send MediaStream via postMessage** - Not serializable, use MessagePort
- ✅ **ALWAYS use SCREAMING_SNAKE_CASE** for message type strings
- ✅ **ALWAYS structure as**: `{ type: 'TYPE', payload: { ... } }`
- 🐛 **Bug Risk**: Memory leaks, missed messages, serialization errors

**WebSocket Connection Edge Cases:**
- ❌ **NEVER reconnect without exponential backoff** - Causes connection storms
- ❌ **NEVER send messages before connection is ready** - Socket.io buffers but can overflow
- ✅ **MUST implement reconnection logic** - Network drops, service worker sleep, server restarts
- ✅ **MUST handle conversation resumption** - Send conversationId to restore state after reconnect
- 🐛 **Bug Risk**: Infinite reconnection loops, lost messages, server overload

**Deepgram Integration Edge Cases:**
- ❌ **NEVER assume WebSocket stays connected** - Implement reconnection on close (unless code 1000)
- ❌ **NEVER ignore `is_final: false` transcripts** - Show interim results for real-time feel
- ✅ **MUST send keepalive messages** - Deepgram closes idle connections after 10 seconds
- ✅ **Audio Format MUST match**: linear16, 48000 Hz, mono
- 🐛 **Bug Risk**: Connection closes silently, transcription quality degrades, format errors

**React 19 Gotchas:**
- ❌ **NEVER use legacy ReactDOM.render** - Removed in React 19
- ❌ **NEVER call hooks conditionally** - Breaks React's internal state tracking
- ❌ **NEVER forget React.memo for expensive components** - Concurrent mode re-renders aggressively
- ✅ **MUST use ErrorBoundary** - Concurrent features make errors harder to debug
- 🐛 **Bug Risk**: Crashes, performance issues, state corruption

**Chrome Storage Limits:**
- ⚠️ **Storage Limit**: chrome.storage.local has 10MB limit (can request unlimited in manifest)
- ❌ **NEVER store large audio buffers** - Use IndexedDB for large data
- ✅ **MUST handle storage quota errors** - Catch and handle gracefully
- 🐛 **Bug Risk**: Extension fails silently when storage is full

**Security Critical Rules:**
- ❌ **NEVER commit API keys** - Store in chrome.storage, configured by user
- ❌ **NEVER trust data from page context** - Validate all postMessage data
- ❌ **NEVER use eval() or Function()** - Violates Content Security Policy
- ❌ **NEVER include external scripts directly** - CSP blocks inline scripts
- 🐛 **Bug Risk**: Security vulnerabilities, CSP violations, extension rejection

**Performance Gotchas:**
- ❌ **NEVER use postMessage for audio streams** - 30+ messages/second causes lag
- ❌ **NEVER create new AudioContext repeatedly** - Browser limits to 6 contexts
- ❌ **NEVER batch chrome.storage writes too frequently** - Rate limited by Chrome
- ✅ **MUST debounce UI updates** - Transcriptions arrive very fast (30/sec)
- 🐛 **Bug Risk**: UI freezes, audio drops, rate limiting errors

**CallTools.io Domain Restrictions:**
- ✅ **ONLY works on**: `*://*.calltools.io/*` domains
- ❌ **Will not work on other domains** - Manifest restricts content script injection
- ✅ **Call detection requires**: Timer element with HH:MM:SS format OR "On a Call" text OR red hangup button
- 🐛 **Bug Risk**: Extension appears broken on wrong domains, call detection fails if CallTools UI changes

---

## Document Maintenance

**When to Update This Document:**
- New technology dependencies added to project
- Breaking changes in framework versions (React, TypeScript, Chrome APIs)
- New architectural patterns established (new message types, state management changes)
- Critical bugs discovered that all agents should avoid
- New Chrome extension features added (new contexts, new communication patterns)

**Review Frequency:**
- After major version upgrades (React, TypeScript, Chrome Manifest)
- When onboarding new AI agents to the project
- After discovering critical bugs that weren't documented
- Quarterly review for accuracy and relevance

---

## Usage Guidelines

**For AI Agents:**
- Read this file BEFORE implementing any code in this project
- Follow ALL rules exactly as documented - these prevent common mistakes
- When in doubt between options, prefer the more restrictive/safer option
- If you discover new patterns or rules, suggest updates to this document
- Pay special attention to the "Critical Don't-Miss Rules" section

**For Human Developers:**
- Keep this file lean and focused on what AI agents might miss
- Update immediately when technology stack changes
- Add new rules after discovering critical bugs or patterns
- Review quarterly and remove rules that become obvious
- Consider this the "source of truth" for project conventions

**Integration with Development Workflow:**
- AI agents should reference this file at the start of each implementation task
- Include this file in the context window for complex refactoring or new features
- Update this file as part of architecture decision records
- Link to specific sections when reviewing code that violates patterns

**File Location:** `/docs/project_context.md`

**Last Updated:** 2025-12-17

