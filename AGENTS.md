# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Chrome extension code: `background/` (service worker), `sidepanel/` and `popup/` (React UI), `offscreen/` (audio capture), `services/`, `stores/`, and shared `utils/`/`types/`.  
`tests/` is split by intent: `unit/`, `integration/`, `perf/`, and `manual/`.  
`infra/` holds AWS CDK stacks and Lambda handlers (`infra/lib/lambda/*`).  
`devassist-call-coach-backend/` is a separate legacy Socket.io backend.  
`public/` stores static extension assets; `dist/` is build output and should not be hand-edited.

## Build, Test, and Development Commands
Run commands from `simple-biz-call-coach/` unless noted.

- `npm ci`: install exact dependencies.
- `npm run dev`: start Vite for extension development.
- `npm run build`: TypeScript compile + production bundle to `dist/`.
- `npm test -- --run --exclude='tests/integration/**'`: match CI test behavior.
- `npm run test:coverage`: run tests with coverage output (`coverage/`).
- `cd infra && npm ci && npm run build && npm test`: build/test infrastructure code.
- `cd infra && npm run cdk -- synth`: synthesize CloudFormation templates.

## Coding Style & Naming Conventions
Use TypeScript strict-mode compatible code (`tsconfig.json` enforces `strict`, unused checks, and switch fallthrough checks).  
Use the `@/` import alias for app code (`@/services/...`).  
Follow existing file-local formatting; in this repo, most TS/TSX uses 2-space indentation and single quotes.  
Naming: React components in PascalCase (`SessionStats.tsx`), utility/store/service files in kebab-case (`call-store.ts`, `ai-coaching-service.ts`).

## Testing Guidelines
Primary framework is Vitest with Testing Library and `jsdom` (`vitest.config.ts`, `tests/setup.ts`).  
Name tests `*.test.ts` or `*.test.tsx` and place by scope (`tests/unit`, `tests/integration`).  
Integration tests depend on live backend services and are excluded in CI; run them intentionally during end-to-end verification.  
Before opening a PR, run root tests and `npm run build`.

## Commit & Pull Request Guidelines
Follow Conventional Commit style seen in history: `feat(scope): ...`, `fix(scope): ...`, `perf: ...`, `fix(ci): ...`.  
Keep commits focused and descriptive (example: `feat(history): add bulk delete for call history`).  
PRs should include: concise summary, linked issue/task, test evidence (commands run), and screenshots for UI changes (popup/sidepanel/history views).  
Do not commit secrets; use `.env.example` and GitHub Actions secrets for deployment values.
