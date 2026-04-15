/**
 * AI Tip Generation — Focused Performance Test
 *
 * Isolates the "Get Next Suggestion" path:
 *   - Sets up conversation + transcripts once
 *   - Warms intelligence cache
 *   - Then fires N tip requests measuring:
 *       - Time to first chunk (TTFC)
 *       - Inter-chunk latency
 *       - Time to complete tip
 *       - Chunk count + total tokens
 *       - Cold vs warm cache comparison
 *
 * Usage:
 *   node tests/perf/tip-generation-test.mjs
 *   node tests/perf/tip-generation-test.mjs --tips 10
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

if (!WS_URL || !API_KEY) {
  console.error('Missing WS_URL or API_KEY in .env.production');
  process.exit(1);
}

const TIP_COUNT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--tips') || '6', 10);

// Realistic 10-turn sales call
const TRANSCRIPTS = [
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

/**
 * Collect streaming tip with per-chunk timestamps
 */
function collectTipDetailed(ws, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const chunkTimestamps = []; // { delta, elapsed, heading?, stage? }
    let finalMsg = null;

    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      finish();
    }, timeoutMs);

    function finish() {
      const totalTime = performance.now() - startTime;
      const firstChunkMs = chunkTimestamps.length > 0 ? chunkTimestamps[0].elapsed : null;
      const lastChunkMs = chunkTimestamps.length > 0 ? chunkTimestamps[chunkTimestamps.length - 1].elapsed : null;

      // Inter-chunk gaps
      const interChunkGaps = [];
      for (let i = 1; i < chunkTimestamps.length; i++) {
        interChunkGaps.push(chunkTimestamps[i].elapsed - chunkTimestamps[i - 1].elapsed);
      }

      const fullText = chunkTimestamps.map(c => c.delta).join('');

      resolve({
        totalTime,
        firstChunkMs,
        lastChunkMs,
        streamDuration: lastChunkMs && firstChunkMs ? lastChunkMs - firstChunkMs : 0,
        chunkCount: chunkTimestamps.length,
        interChunkGaps,
        avgInterChunk: interChunkGaps.length > 0
          ? interChunkGaps.reduce((a, b) => a + b, 0) / interChunkGaps.length
          : 0,
        maxInterChunk: interChunkGaps.length > 0 ? Math.max(...interChunkGaps) : 0,
        fullText,
        charCount: fullText.length,
        heading: chunkTimestamps[0]?.heading || finalMsg?.payload?.aiTip?.heading || '',
        stage: chunkTimestamps[0]?.stage || finalMsg?.payload?.aiTip?.stage || '',
        finalMsg,
        chunkTimestamps,
      });
    }

    function handler(raw) {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'TIP_CHUNK') {
          chunkTimestamps.push({
            delta: data.payload?.delta || '',
            elapsed: performance.now() - startTime,
            heading: data.payload?.heading,
            stage: data.payload?.stage,
          });
        }
        if (data.type === 'AI_TIP' || data.type === 'INTELLIGENCE_UPDATE') {
          finalMsg = data;
          clearTimeout(timer);
          ws.removeListener('message', handler);
          // Small delay to catch any trailing chunks
          setTimeout(finish, 100);
        }
        if (data.type === 'ERROR') {
          finalMsg = data;
          clearTimeout(timer);
          ws.removeListener('message', handler);
          finish();
        }
      } catch { /* ignore */ }
    }
    ws.on('message', handler);
  });
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return 'n/a';
  return `${ms.toFixed(0)}ms`;
}

// ── Main ──

async function main() {
  console.log('================================================================');
  console.log('  AI Tip Generation - Performance Test');
  console.log('================================================================');
  console.log(`  Target:  ${WS_URL}`);
  console.log(`  Tips:    ${TIP_COUNT} requests`);
  console.log('');

  // ── Setup: connect + start conversation + seed transcripts ──
  console.log('--- SETUP ---');

  let t0 = performance.now();
  const ws = await new Promise((resolve, reject) => {
    const url = `${WS_URL}?apiKey=${encodeURIComponent(API_KEY)}`;
    const socket = new WebSocket(url);
    socket.on('open', () => resolve(socket));
    socket.on('error', (e) => reject(new Error(`Connect failed: ${e.message}`)));
    setTimeout(() => reject(new Error('Connection timeout')), 15000);
  });
  console.log(`  Connected in ${fmtMs(performance.now() - t0)}`);

  t0 = performance.now();
  const startP = waitForMessage(ws, 'CONVERSATION_STARTED');
  ws.send(JSON.stringify({
    action: 'startConversation',
    agentId: `tip-perf-${Date.now()}`,
    metadata: { timestamp: Date.now(), apiKey: API_KEY },
  }));
  const startResp = await startP;
  const conversationId = startResp.payload.conversationId;
  console.log(`  Conversation started in ${fmtMs(performance.now() - t0)} (${conversationId.slice(0, 8)}...)`);

  // Send all transcripts
  for (const turn of TRANSCRIPTS) {
    ws.send(JSON.stringify({
      action: 'transcript',
      conversationId,
      speaker: turn.speaker,
      text: turn.text,
      isFinal: true,
      timestamp: Date.now(),
    }));
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`  Sent ${TRANSCRIPTS.length} transcript turns`);

  // Warm intelligence cache
  t0 = performance.now();
  const intelP = waitForMessage(ws, 'INTELLIGENCE_UPDATE');
  ws.send(JSON.stringify({
    action: 'getIntelligence',
    conversationId,
    skipTip: true,
    skipIntelligence: false,
    timestamp: Date.now(),
  }));
  const intelResp = await intelP;
  const intelMs = performance.now() - t0;
  const cachedIntelligence = {
    intelligence: intelResp.payload?.intelligence || null,
    entities: intelResp.payload?.entities || null,
    timestamp: Date.now(),
  };
  console.log(`  Intelligence cache warmed in ${fmtMs(intelMs)} (sentiment: ${cachedIntelligence.intelligence?.sentiment?.label || 'n/a'})`);
  console.log('');

  // ── Tip Generation Runs ──
  console.log('--- TIP GENERATION RESULTS ---');
  console.log('');

  const clientTranscripts = TRANSCRIPTS.map(t => ({ speaker: t.speaker, text: t.text }));
  const allResults = [];

  for (let i = 1; i <= TIP_COUNT; i++) {
    const label = i === 1 ? 'COLD' : `WARM #${i - 1}`;

    // For the first request, don't pass cached intelligence to test cold path
    const useClientIntel = i > 1 ? cachedIntelligence : undefined;

    const result = collectTipDetailed(ws);
    const sendTime = performance.now();

    ws.send(JSON.stringify({
      action: 'getIntelligence',
      conversationId,
      skipTip: false,
      skipIntelligence: i > 1,  // skip intel refresh on warm requests
      transcripts: clientTranscripts,
      clientIntelligence: useClientIntel,
      timestamp: Date.now(),
    }));

    const r = await result;
    allResults.push({ ...r, label });

    console.log(`  [${label.padEnd(8)}] TTFC: ${fmtMs(r.firstChunkMs).padStart(7)} | Stream: ${fmtMs(r.streamDuration).padStart(7)} | Total: ${fmtMs(r.totalTime).padStart(7)} | Chunks: ${r.chunkCount} | Chars: ${r.charCount}`);

    if (r.heading) {
      console.log(`             Stage: ${r.stage} | Heading: "${r.heading}"`);
    }
    if (r.fullText) {
      console.log(`             Tip: "${r.fullText.slice(0, 90)}${r.fullText.length > 90 ? '...' : ''}"`);
    }

    if (r.interChunkGaps.length > 0) {
      console.log(`             Chunk gaps: avg=${fmtMs(r.avgInterChunk)} max=${fmtMs(r.maxInterChunk)} [${r.interChunkGaps.map(g => g.toFixed(0)).join(', ')}]ms`);
    }

    if (r.finalMsg?.type === 'ERROR') {
      console.log(`             ERROR: ${r.finalMsg.payload?.message || 'unknown'}`);
    }

    console.log('');

    // Wait between requests to let cache settle
    if (i < TIP_COUNT) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // ── Summary ──
  console.log('='.repeat(65));
  console.log('  SUMMARY');
  console.log('='.repeat(65));

  const cold = allResults.filter(r => r.label === 'COLD');
  const warm = allResults.filter(r => r.label !== 'COLD');

  function summarize(label, results) {
    if (results.length === 0) return;
    const ttfcs = results.map(r => r.firstChunkMs).filter(Boolean);
    const totals = results.map(r => r.totalTime);
    const streams = results.map(r => r.streamDuration);
    const chunks = results.map(r => r.chunkCount);

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = arr => Math.min(...arr);
    const max = arr => Math.max(...arr);
    const p95 = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || s[s.length - 1]; };

    console.log(`\n  ${label} (n=${results.length})`);
    if (ttfcs.length > 0) {
      console.log(`    TTFC:         avg=${fmtMs(avg(ttfcs)).padStart(7)}  min=${fmtMs(min(ttfcs)).padStart(7)}  max=${fmtMs(max(ttfcs)).padStart(7)}  p95=${fmtMs(p95(ttfcs)).padStart(7)}`);
    }
    console.log(`    Total:        avg=${fmtMs(avg(totals)).padStart(7)}  min=${fmtMs(min(totals)).padStart(7)}  max=${fmtMs(max(totals)).padStart(7)}  p95=${fmtMs(p95(totals)).padStart(7)}`);
    console.log(`    Stream time:  avg=${fmtMs(avg(streams)).padStart(7)}  min=${fmtMs(min(streams)).padStart(7)}  max=${fmtMs(max(streams)).padStart(7)}`);
    console.log(`    Chunks:       avg=${avg(chunks).toFixed(1).padStart(5)}    min=${min(chunks).toString().padStart(5)}    max=${max(chunks).toString().padStart(5)}`);
  }

  summarize('COLD (no cached intelligence)', cold);
  summarize('WARM (cached intelligence)', warm);

  // Target check
  const allTotals = allResults.map(r => r.totalTime);
  const allTtfcs = allResults.map(r => r.firstChunkMs).filter(Boolean);
  const avgTotal = allTotals.reduce((a, b) => a + b, 0) / allTotals.length;
  const maxTotal = Math.max(...allTotals);
  const avgTtfc = allTtfcs.length > 0 ? allTtfcs.reduce((a, b) => a + b, 0) / allTtfcs.length : 0;

  console.log('\n' + '-'.repeat(65));
  console.log('  TARGET CHECK');
  console.log('-'.repeat(65));
  console.log(`  <3000ms total:   avg=${fmtMs(avgTotal)}  max=${fmtMs(maxTotal)}  ${maxTotal < 3000 ? 'PASS' : 'FAIL'}`);
  console.log(`  TTFC:            avg=${fmtMs(avgTtfc)}`);
  if (warm.length > 0) {
    const warmTotals = warm.map(r => r.totalTime);
    const warmAvg = warmTotals.reduce((a, b) => a + b, 0) / warmTotals.length;
    const warmMax = Math.max(...warmTotals);
    console.log(`  Warm only:       avg=${fmtMs(warmAvg)}  max=${fmtMs(warmMax)}  ${warmMax < 3000 ? 'PASS' : 'FAIL'}`);
  }
  console.log('');

  // Cleanup
  ws.send(JSON.stringify({ action: 'endConversation', conversationId, timestamp: Date.now() }));
  await new Promise(r => setTimeout(r, 500));
  ws.close(1000);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
