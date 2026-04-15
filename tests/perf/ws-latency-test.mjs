/**
 * WebSocket Latency Performance Test
 *
 * Tests real end-to-end latency against the production AWS infrastructure.
 *
 * Usage:
 *   node tests/perf/ws-latency-test.mjs
 *   node tests/perf/ws-latency-test.mjs --rounds 5
 */

import { WebSocket } from 'ws';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ── Load config from .env.production ──
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

if (!WS_URL || !API_KEY) {
  console.error('Missing WS_URL or API_KEY in .env.production');
  process.exit(1);
}

const ROUNDS = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--rounds') || '3', 10);

// Realistic sales call transcript
const SAMPLE_TRANSCRIPTS = [
  { speaker: 'agent', text: "Hi there, this is Mike from Simple Biz. How are you doing today?" },
  { speaker: 'caller', text: "I'm doing okay, who is this?" },
  { speaker: 'agent', text: "Great to hear! I'm reaching out because we help small businesses get found online. Do you currently have a website?" },
  { speaker: 'caller', text: "No, we don't have one yet. We've been meaning to but haven't gotten around to it." },
  { speaker: 'agent', text: "That's actually really common. A lot of our clients were in the same boat. What kind of business do you run?" },
  { speaker: 'caller', text: "We have a plumbing company, been in business about 12 years." },
  { speaker: 'agent', text: "Oh that's great, 12 years is impressive. Are most of your customers coming from word of mouth right now?" },
  { speaker: 'caller', text: "Yeah mostly referrals and some Google stuff but I'm not sure how that works." },
  { speaker: 'agent', text: "Perfect, so what we do is set up a professional website and make sure when someone searches for plumbers in your area, your business shows up." },
  { speaker: 'caller', text: "Yeah that sounds interesting. How much does something like that cost?" },
];

// ── Helpers ──
class Metrics {
  constructor() { this.results = []; }

  record(label, ms) {
    this.results.push({ label, ms });
  }

  print() {
    console.log('\n' + '='.repeat(65));
    console.log('  PERFORMANCE RESULTS');
    console.log('='.repeat(65));

    const grouped = {};
    for (const r of this.results) {
      if (!grouped[r.label]) grouped[r.label] = [];
      grouped[r.label].push(r.ms);
    }

    for (const [label, values] of Object.entries(grouped)) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const sorted = [...values].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];

      console.log(`\n  ${label}`);
      console.log(`    avg: ${avg.toFixed(0)}ms | min: ${min.toFixed(0)}ms | max: ${max.toFixed(0)}ms | p95: ${p95.toFixed(0)}ms  (n=${values.length})`);
    }

    console.log('\n' + '='.repeat(65));
  }
}

function waitForMessage(ws, type, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${type} (${timeoutMs}ms)`));
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

function collectChunks(ws, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const chunks = [];
    let firstChunkTime = null;
    const startTime = performance.now();

    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve({ chunks, firstChunkTime, totalTime: performance.now() - startTime });
    }, timeoutMs);

    function handler(raw) {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'TIP_CHUNK') {
          if (!firstChunkTime) firstChunkTime = performance.now() - startTime;
          chunks.push(data.payload);
        }
        if (data.type === 'AI_TIP' || data.type === 'INTELLIGENCE_UPDATE') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve({
            chunks,
            firstChunkTime,
            totalTime: performance.now() - startTime,
            finalMessage: data,
          });
        }
      } catch { /* ignore */ }
    }
    ws.on('message', handler);
  });
}

// ── Main Test ──
async function runRound(roundNum, metrics) {
  console.log(`\n${'-'.repeat(50)}`);
  console.log(`  Round ${roundNum}`);
  console.log('-'.repeat(50));

  // 1. Connection
  let t0 = performance.now();
  const ws = await new Promise((resolve, reject) => {
    const url = `${WS_URL}?apiKey=${encodeURIComponent(API_KEY)}`;
    const socket = new WebSocket(url);
    socket.on('open', () => resolve(socket));
    socket.on('error', (e) => reject(new Error(`WS connect failed: ${e.message}`)));
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });
  const connectMs = performance.now() - t0;
  metrics.record('1. WS Connect', connectMs);
  console.log(`  [connect]           ${connectMs.toFixed(0)}ms`);

  // 2. Start conversation
  t0 = performance.now();
  const startPromise = waitForMessage(ws, 'CONVERSATION_STARTED');
  ws.send(JSON.stringify({
    action: 'startConversation',
    agentId: `perf-test-${Date.now()}`,
    metadata: { timestamp: Date.now(), apiKey: API_KEY },
  }));
  const startResp = await startPromise;
  const startMs = performance.now() - t0;
  metrics.record('2. Start Conversation', startMs);
  const conversationId = startResp.payload.conversationId;
  console.log(`  [startConversation] ${startMs.toFixed(0)}ms  (id: ${conversationId.slice(0, 8)}...)`);

  // 3. Send transcript turns (interim + final each)
  const transcriptLatencies = [];
  for (let i = 0; i < SAMPLE_TRANSCRIPTS.length; i++) {
    const turn = SAMPLE_TRANSCRIPTS[i];

    // Interim (fire-and-forget)
    ws.send(JSON.stringify({
      action: 'transcript',
      conversationId,
      speaker: turn.speaker,
      text: turn.text.slice(0, Math.floor(turn.text.length / 2)),
      isFinal: false,
      timestamp: Date.now(),
    }));

    // Final
    t0 = performance.now();
    ws.send(JSON.stringify({
      action: 'transcript',
      conversationId,
      speaker: turn.speaker,
      text: turn.text,
      isFinal: true,
      timestamp: Date.now(),
    }));

    await new Promise(r => setTimeout(r, 200));
    transcriptLatencies.push(performance.now() - t0);
  }
  const avgTranscript = transcriptLatencies.reduce((a, b) => a + b, 0) / transcriptLatencies.length;
  metrics.record('3. Transcript Send (avg/turn)', avgTranscript);
  console.log(`  [transcripts x${SAMPLE_TRANSCRIPTS.length}]  avg ${avgTranscript.toFixed(0)}ms per turn`);

  // 4. Intelligence only (auto-analysis: skipTip=true)
  t0 = performance.now();
  const intelPromise = waitForMessage(ws, 'INTELLIGENCE_UPDATE');
  ws.send(JSON.stringify({
    action: 'getIntelligence',
    conversationId,
    skipTip: true,
    skipIntelligence: false,
    timestamp: Date.now(),
  }));
  const intelResp = await intelPromise;
  const intelMs = performance.now() - t0;
  metrics.record('4. Intelligence Only (auto-analysis)', intelMs);
  const sentiment = intelResp.payload?.intelligence?.sentiment?.label || 'n/a';
  console.log(`  [intelligence]      ${intelMs.toFixed(0)}ms  (sentiment: ${sentiment})`);

  // 5. AI tip (manual click path: skipTip=false, client transcripts + cached intelligence)
  const clientTranscripts = SAMPLE_TRANSCRIPTS.map(t => ({ speaker: t.speaker, text: t.text }));
  const clientIntelligence = intelResp.payload ? {
    intelligence: intelResp.payload.intelligence || null,
    entities: intelResp.payload.entities || null,
    timestamp: Date.now(),
  } : undefined;

  t0 = performance.now();
  const tipCollector = collectChunks(ws);
  ws.send(JSON.stringify({
    action: 'getIntelligence',
    conversationId,
    skipTip: false,
    skipIntelligence: true,
    transcripts: clientTranscripts,
    clientIntelligence,
    timestamp: Date.now(),
  }));
  const tipResult = await tipCollector;
  const tipTotalMs = performance.now() - t0;

  metrics.record('5. AI Tip Total', tipTotalMs);
  if (tipResult.firstChunkTime) {
    metrics.record('5a. Time-to-First-Chunk (TTFC)', tipResult.firstChunkTime);
    console.log(`  [tip TTFC]          ${tipResult.firstChunkTime.toFixed(0)}ms`);
  }
  console.log(`  [tip total]         ${tipTotalMs.toFixed(0)}ms  (${tipResult.chunks.length} chunks)`);

  if (tipResult.finalMessage?.payload) {
    const p = tipResult.finalMessage.payload;
    const tipText = p.aiTip?.suggestion || p.suggestion || '(streamed)';
    const stage = p.aiTip?.stage || p.stage || 'n/a';
    console.log(`  [tip]               stage=${stage} "${tipText.slice(0, 70)}..."`);
  }

  // 6. Second tip (warm Lambda cache)
  t0 = performance.now();
  const tip2Collector = collectChunks(ws);
  ws.send(JSON.stringify({
    action: 'getIntelligence',
    conversationId,
    skipTip: false,
    skipIntelligence: true,
    transcripts: clientTranscripts,
    clientIntelligence,
    timestamp: Date.now(),
  }));
  const tip2Result = await tip2Collector;
  const tip2Ms = performance.now() - t0;
  metrics.record('6. AI Tip Warm Cache', tip2Ms);
  if (tip2Result.firstChunkTime) {
    metrics.record('6a. Warm TTFC', tip2Result.firstChunkTime);
    console.log(`  [warm TTFC]         ${tip2Result.firstChunkTime.toFixed(0)}ms`);
  }
  console.log(`  [warm total]        ${tip2Ms.toFixed(0)}ms  (${tip2Result.chunks.length} chunks)`);

  // 7. End conversation
  t0 = performance.now();
  const endPromise = waitForMessage(ws, 'CONVERSATION_ENDED', 10000).catch(() => null);
  ws.send(JSON.stringify({
    action: 'endConversation',
    conversationId,
    timestamp: Date.now(),
  }));
  await endPromise;
  const endMs = performance.now() - t0;
  metrics.record('7. End Conversation', endMs);
  console.log(`  [endConversation]   ${endMs.toFixed(0)}ms`);

  // 8. Ping/pong
  t0 = performance.now();
  const pongPromise = waitForMessage(ws, 'PONG', 5000);
  ws.send(JSON.stringify({ action: 'ping' }));
  await pongPromise;
  const pingMs = performance.now() - t0;
  metrics.record('8. Ping/Pong RTT', pingMs);
  console.log(`  [ping/pong]         ${pingMs.toFixed(0)}ms`);

  ws.close(1000);
  await new Promise(r => setTimeout(r, 500));
}

async function main() {
  console.log('================================================================');
  console.log('  Simple.Biz Call Coach - WebSocket Latency Test');
  console.log('================================================================');
  console.log(`  Target:  ${WS_URL}`);
  console.log(`  Rounds:  ${ROUNDS}`);
  console.log(`  Turns:   ${SAMPLE_TRANSCRIPTS.length} per round`);

  const metrics = new Metrics();

  for (let i = 1; i <= ROUNDS; i++) {
    try {
      await runRound(i, metrics);
    } catch (err) {
      console.error(`  Round ${i} FAILED: ${err.message}`);
    }
  }

  metrics.print();

  // CEO target check
  console.log('\n  CEO TARGET (<3000ms for AI tip):');
  const tipValues = metrics.results.filter(r => r.label === '5. AI Tip Total').map(r => r.ms);
  if (tipValues.length > 0) {
    const avg = tipValues.reduce((a, b) => a + b, 0) / tipValues.length;
    const max = Math.max(...tipValues);
    console.log(`    avg: ${avg.toFixed(0)}ms  max: ${max.toFixed(0)}ms  ${max < 3000 ? 'PASS' : 'FAIL'}`);
  }

  const ttfcValues = metrics.results.filter(r => r.label === '5a. Time-to-First-Chunk (TTFC)').map(r => r.ms);
  if (ttfcValues.length > 0) {
    const avg = ttfcValues.reduce((a, b) => a + b, 0) / ttfcValues.length;
    console.log(`    TTFC avg: ${avg.toFixed(0)}ms`);
  }
  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
