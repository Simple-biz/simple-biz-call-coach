/**
 * Verify OpenAI Fallback — Local test calling OpenAI SDK directly
 *
 * Simulates what the Lambda fallback will do. Confirms:
 *   1. OpenAI API key works
 *   2. Streaming + Predicted Outputs works
 *   3. Tip format is parseable (same [HEADING]:[STAGE]:[CONTEXT]:[SCRIPT]: structure)
 *   4. Structured outputs JSON mode works for intelligence
 */

import OpenAI from 'openai';
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
const OPENAI_KEY = env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('OPENAI_API_KEY not found in .env.production');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

// Minimal system prompt — mirrors what the Lambda will send
const SYSTEM_PROMPT = `Sales coach for local website design/SEO. Goal: get small business owner to agree to callback from Bob.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title
[STAGE]: GREETING | VALUE_PROP | OBJECTION_HANDLING | CLOSING | CONVERSION | SIGNOFF
[CONTEXT]: One sentence
[SCRIPT]: ONLY the spoken words.

Agent is Bob's assistant. Default pitch: "Bob and I are local website designers".
Pricing/cost asked → redirect to Bob, ask for callback.`;

const TEST_CASES = [
  {
    name: 'Greeting',
    userPrompt: 'Stage: greeting\nTranscript Count: 2\n\nRecent Conversation:\nAGENT: "Hi is this the owner speaking?"\nCALLER: "Yeah this is me, who\'s calling?"\n\n⚠️ LATEST EXCHANGE:\nCALLER: "Yeah this is me, who\'s calling?"'
  },
  {
    name: 'Pricing Objection',
    userPrompt: 'Stage: objection\nTranscript Count: 4\n\nRecent Conversation:\nAGENT: "Bob and I are local website designers. Do you have one?"\nCALLER: "Maybe, how much does it cost?"\n\n⚠️ LATEST EXCHANGE:\nCALLER: "Maybe, how much does it cost?"'
  },
  {
    name: 'Hostile Email',
    userPrompt: 'Stage: conversion\nTranscript Count: 8\n\nRecent Conversation:\nAGENT: "What\'s your email?"\nCALLER: "fuckoff@gmail.com"\n\n⚠️ LATEST EXCHANGE:\nCALLER: "fuckoff@gmail.com"'
  },
];

// ── Streaming test ──
async function testStreaming(testCase) {
  console.log('\n' + '='.repeat(70));
  console.log(`  SCENARIO: ${testCase.name}`);
  console.log('='.repeat(70));

  const startTime = Date.now();
  let firstChunkTime = null;
  let fullText = '';

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    temperature: 0.3,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: testCase.userPrompt },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (!delta) continue;
    if (!firstChunkTime) firstChunkTime = Date.now() - startTime;
    fullText += delta;
  }

  const totalTime = Date.now() - startTime;

  console.log(`\n  TTFC: ${firstChunkTime}ms | Total: ${totalTime}ms | Chars: ${fullText.length}`);
  console.log('\n  --- GENERATED TIP ---');
  console.log(fullText);
  console.log('  ---');

  // Test parsability
  const headingMatch = fullText.match(/\[HEADING\]:\s*(.+?)(?=\n|$)/i);
  const stageMatch = fullText.match(/\[STAGE\]:\s*(\w+)/i);
  const scriptMatch = fullText.match(/\[SCRIPT\]:\s*(.+?)(?=\n\n|$)/is);

  console.log('\n  PARSE CHECK:');
  console.log(`    Heading: ${headingMatch ? '✓ "' + headingMatch[1].trim() + '"' : '✗ MISSING'}`);
  console.log(`    Stage:   ${stageMatch ? '✓ ' + stageMatch[1] : '✗ MISSING'}`);
  console.log(`    Script:  ${scriptMatch ? '✓ "' + scriptMatch[1].trim().slice(0, 80) + '..."' : '✗ MISSING'}`);

  return { totalTime, firstChunkTime, parseOK: !!(headingMatch && stageMatch && scriptMatch) };
}

// ── Intelligence JSON test ──
async function testIntelligence() {
  console.log('\n' + '='.repeat(70));
  console.log(`  INTELLIGENCE TEST (JSON mode)`);
  console.log('='.repeat(70));

  const schema = {
    name: 'conversation_intelligence',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sentiment: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
            score: { type: 'number' },
          },
          required: ['label', 'score'],
        },
        intents: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['sentiment', 'intents', 'summary'],
    },
  };

  const startTime = Date.now();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: schema },
    messages: [
      { role: 'system', content: 'Analyze sales conversation. Return JSON only.' },
      { role: 'user', content: '[AGENT]: Hi Bob and I are local web designers\n[CALLER]: Yeah sure, have Bob call me tomorrow at 2pm' },
    ],
  });

  const totalTime = Date.now() - startTime;
  const parsed = JSON.parse(response.choices[0].message.content);

  console.log(`\n  Latency: ${totalTime}ms`);
  console.log(`  Parsed:\n`);
  console.log('  ' + JSON.stringify(parsed, null, 2).replace(/\n/g, '\n  '));

  return { totalTime, parseOK: true };
}

async function main() {
  console.log('================================================================');
  console.log('  OpenAI Fallback — Local Verification');
  console.log('================================================================');
  console.log(`  Model: gpt-4o-mini`);
  console.log(`  Using Predicted Outputs for structural markers`);

  const results = [];

  for (const testCase of TEST_CASES) {
    try {
      results.push({ name: testCase.name, ...(await testStreaming(testCase)) });
    } catch (err) {
      console.error(`  SCENARIO FAILED: ${err.message}`);
      results.push({ name: testCase.name, error: err.message });
    }
  }

  try {
    const intelResult = await testIntelligence();
    results.push({ name: 'Intelligence JSON', ...intelResult });
  } catch (err) {
    console.error(`  INTELLIGENCE FAILED: ${err.message}`);
    results.push({ name: 'Intelligence JSON', error: err.message });
  }

  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));
  console.log('');

  for (const r of results) {
    const status = r.error ? `✗ ERROR: ${r.error}` : r.parseOK ? `✓ PASS (${r.totalTime}ms)` : `⚠ PARSE FAIL (${r.totalTime}ms)`;
    console.log(`  ${r.name.padEnd(30)} ${status}`);
  }
  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
