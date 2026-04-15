/**
 * Verify Identity Framing — Dumps FULL generated tips to verify prompt changes
 */

import { WebSocket } from 'ws';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

function loadEnv() {
  const envPath = resolve(PROJECT_ROOT, '.env.production');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return env;
}

const env = loadEnv();
const WS_URL = env.VITE_BACKEND_WS_URL || env.VITE_WS_URL;
const API_KEY = env.VITE_BACKEND_API_KEY;

// ── Test scenarios ──
// Each scenario triggers a different prompt path to verify framing
const SCENARIOS = [
  {
    name: 'GREETING — initial intro',
    transcripts: [
      { speaker: 'agent', text: "Hi is this [name] speaking?" },
      { speaker: 'caller', text: "Yeah this is me, who's calling?" },
    ],
  },
  {
    name: 'OBJECTION — pricing redirect (was "my partner Bob")',
    transcripts: [
      { speaker: 'agent', text: "Hi, Bob and I are local website designers. Do you have a website?" },
      { speaker: 'caller', text: "Maybe, how much does it cost though?" },
    ],
  },
  {
    name: 'IDENTITY CHALLENGE — "are you the owner?"',
    transcripts: [
      { speaker: 'agent', text: "My name is Mike, Bob and I are local website designers." },
      { speaker: 'caller', text: "Wait, are you the owner? What's your role exactly?" },
    ],
  },
  {
    name: 'OBJECTION — features/capabilities',
    transcripts: [
      { speaker: 'agent', text: "We design websites for local businesses." },
      { speaker: 'caller', text: "Do you also do SEO? How does that work exactly?" },
    ],
  },
];

function waitForMessage(ws, type, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${type}`));
    }, timeoutMs);
    function handler(raw) {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === type) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(data);
        }
      } catch { /* ignore */ }
    }
    ws.on('message', handler);
  });
}

function collectFullTip(ws, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let fullText = '';
    let metadata = {};
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve({ fullText, ...metadata });
    }, timeoutMs);

    function handler(raw) {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'TIP_CHUNK') {
          fullText += data.payload?.delta || '';
          if (data.payload?.heading) metadata.heading = data.payload.heading;
          if (data.payload?.stage) metadata.stage = data.payload.stage;
        }
        if (data.type === 'AI_TIP' || data.type === 'INTELLIGENCE_UPDATE') {
          setTimeout(() => {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            if (data.payload?.aiTip) {
              metadata.finalStage = data.payload.aiTip.stage;
              metadata.finalHeading = data.payload.aiTip.heading;
              metadata.finalSuggestion = data.payload.aiTip.suggestion;
            } else if (data.payload?.suggestion) {
              metadata.finalSuggestion = data.payload.suggestion;
            }
            resolve({ fullText, ...metadata });
          }, 200);
        }
      } catch { /* ignore */ }
    }
    ws.on('message', handler);
  });
}

async function runScenario(ws, conversationId, scenario) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  SCENARIO: ${scenario.name}`);
  console.log('═'.repeat(70));

  // Clear scenario by sending fresh transcripts
  for (const t of scenario.transcripts) {
    ws.send(JSON.stringify({
      action: 'transcript',
      conversationId,
      speaker: t.speaker,
      text: t.text,
      isFinal: true,
      timestamp: Date.now(),
    }));
    console.log(`  ${t.speaker.toUpperCase()}: "${t.text}"`);
    await new Promise(r => setTimeout(r, 150));
  }

  await new Promise(r => setTimeout(r, 500));

  const tipPromise = collectFullTip(ws);
  ws.send(JSON.stringify({
    action: 'getIntelligence',
    conversationId,
    skipTip: false,
    skipIntelligence: false,
    transcripts: scenario.transcripts,
    timestamp: Date.now(),
  }));

  const result = await tipPromise;

  console.log('\n  --- GENERATED TIP ---');
  if (result.fullText) {
    console.log(result.fullText);
  } else if (result.finalSuggestion) {
    console.log(`[Heading]: ${result.finalHeading}`);
    console.log(`[Stage]: ${result.finalStage}`);
    console.log(`[Script]: ${result.finalSuggestion}`);
  }
  console.log('  ---');
}

async function main() {
  console.log('================================================================');
  console.log('  Identity Framing Verification');
  console.log('================================================================');

  const ws = await new Promise((resolve, reject) => {
    const url = `${WS_URL}?apiKey=${encodeURIComponent(API_KEY)}`;
    const socket = new WebSocket(url);
    socket.on('open', () => resolve(socket));
    socket.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('timeout')), 15000);
  });

  const startP = waitForMessage(ws, 'CONVERSATION_STARTED');
  ws.send(JSON.stringify({
    action: 'startConversation',
    agentId: `verify-${Date.now()}`,
    metadata: { timestamp: Date.now(), apiKey: API_KEY },
  }));
  const startResp = await startP;
  const conversationId = startResp.payload.conversationId;
  console.log(`Connected. Conversation: ${conversationId.slice(0, 8)}...`);

  for (const scenario of SCENARIOS) {
    try {
      await runScenario(ws, conversationId, scenario);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  SCENARIO FAILED: ${err.message}`);
    }
  }

  ws.send(JSON.stringify({ action: 'endConversation', conversationId, timestamp: Date.now() }));
  await new Promise(r => setTimeout(r, 500));
  ws.close(1000);

  console.log('\n' + '═'.repeat(70));
  console.log('  VERIFICATION CHECKLIST');
  console.log('═'.repeat(70));
  console.log('  [ ] No "my partner Bob" anywhere');
  console.log('  [ ] Intros say "Bob and I are local website designers"');
  console.log('  [ ] Pricing redirect says "Bob can get into the details"');
  console.log('  [ ] Identity challenge acknowledges assistant role honestly');
  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
