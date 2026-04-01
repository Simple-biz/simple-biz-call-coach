const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const MODEL = 'claude-haiku-4-5-20251001';

// Pull the latest prompt directly from production file
const SCRIPTS = require('fs').readFileSync(require('path').join(__dirname, '../../infra/lib/lambda/shared/claude-client-optimized.ts'), 'utf8');

// Extract MARKS_GOLDEN_SCRIPTS
const scriptsMatch = SCRIPTS.match(/const MARKS_GOLDEN_SCRIPTS = `([\s\S]*?)`;/);
const GOLDEN_SCRIPTS = scriptsMatch ? scriptsMatch[1] : '';

// Extract SYSTEM_PROMPT_COMPRESSED
const promptMatch = SCRIPTS.match(/const SYSTEM_PROMPT_COMPRESSED = `([\s\S]*?)`;/);
const SYSTEM_PROMPT = promptMatch ? promptMatch[1] : '';

if (!GOLDEN_SCRIPTS || !SYSTEM_PROMPT) {
  console.error('Failed to extract prompts from production file');
  process.exit(1);
}

console.log(`Loaded ${GOLDEN_SCRIPTS.length} chars of scripts, ${SYSTEM_PROMPT.length} chars of prompt`);

// ============================================================================
// 20 SCENARIOS
// ============================================================================
const SCENARIOS = [
  // --- ENGAGEMENT (dry/vague) ---
  { name: '1. Flat "yeah" after pitch', expect: 'engagement question',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website, since we're super affordable." },
      { s: 'caller', t: "Yeah." },
    ]},
  { name: '2. "Maybe, I\'m not sure"', expect: 'engagement question',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "Maybe. I'm not sure." },
    ]},
  { name: '3. "Hmm" — dead response', expect: 'engagement question',
    context: [
      { s: 'agent', t: "We're super affordable and we just don't want you to miss out." },
      { s: 'caller', t: "Hmm." },
    ]},

  // --- GREETING / TRUST ---
  { name: '4. "Who is this?"', expect: 'Basic Intro',
    context: [
      { s: 'agent', t: "Hi, good morning." },
      { s: 'caller', t: "Who is this? What do you want?" },
    ]},
  { name: '5. "How did you get my number?"', expect: 'Trust/Source',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz." },
      { s: 'caller', t: "How did you get my number?" },
    ]},
  { name: '6. "Is this a scam?"', expect: 'Skeptical/Scam Concern',
    context: [
      { s: 'agent', t: "Hi, this is Caesar. We're local website designers." },
      { s: 'caller', t: "Is this a scam? This sounds like a scam call." },
    ]},

  // --- OBJECTION HANDLING ---
  { name: '7. "I already have a website"', expect: 'SEO/Revamp Pivot',
    context: [
      { s: 'agent', t: "We're reaching out about your business website." },
      { s: 'caller', t: "I already have a website." },
    ]},
  { name: '8. "My nephew handles my website"', expect: 'Revamp/SEO Pivot',
    context: [
      { s: 'agent', t: "We're reaching out about your business website." },
      { s: 'caller', t: "My nephew does my website for me." },
    ]},
  { name: '9. "We just use Instagram and Facebook"', expect: 'Digital Marketing Pivot',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "We just use Instagram and Facebook. Don't really need a website." },
    ]},
  { name: '10. "Not right now"', expect: 'Have One/Busy',
    context: [
      { s: 'agent', t: "We're just wondering if you're interested in building or updating your website." },
      { s: 'caller', t: "Not right now." },
    ]},

  // --- PRICING / TIMELINE ---
  { name: '11. "What do you charge?" (first ask)', expect: 'Pricing redirect to Bob',
    context: [
      { s: 'agent', t: "We're local website designers here in Las Vegas." },
      { s: 'caller', t: "What do you guys charge?" },
    ]},
  { name: '12. "Give me a ballpark number" (second ask)', expect: 'Pricing Ballpark — few hundred not thousands',
    context: [
      { s: 'agent', t: "Pricing depends on what you need. Would you mind if Bob gives you a quick call to talk about pricing?" },
      { s: 'caller', t: "I need a ballpark before I commit to another call. Are we talking hundreds or thousands?" },
    ]},
  { name: '13. "How long does it take?"', expect: 'Timeline Ballpark or redirect',
    context: [
      { s: 'agent', t: "We build and optimize websites for local businesses." },
      { s: 'caller', t: "How long does it take to build a website?" },
    ]},

  // --- DEFLECTION ---
  { name: '14. "Just send me an email"', expect: 'Email Deflection',
    context: [
      { s: 'agent', t: "Would you mind if Bob gives you a quick call later?" },
      { s: 'caller', t: "Just send me an email instead." },
    ]},
  { name: '15. "I\'m not the right person"', expect: 'Ask who is the right person',
    context: [
      { s: 'agent', t: "We're reaching out about your business website." },
      { s: 'caller', t: "I'm not the right person to talk to about that." },
    ]},
  { name: '16. "I\'m driving right now"', expect: 'Quick Intro + callback redirect',
    context: [
      { s: 'agent', t: "Do you have a minute?" },
      { s: 'caller', t: "I'm driving right now, can't really talk." },
    ]},

  // --- AI RECEPTIONIST (NEW) ---
  { name: '17. AI receptionist offers callback', expect: 'Accept offer + give Bob\'s number',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz. I'm reaching out about your business website." },
      { s: 'caller', t: "I'm here to help. How can I assist you today?" },
      { s: 'agent', t: "We're local website designers. Is the owner available?" },
      { s: 'caller', t: "I can arrange for someone to return your call. Could you provide me with your phone number?" },
    ]},
  { name: '18. AI receptionist generic greeting', expect: 'Ask for human/owner',
    context: [
      { s: 'agent', t: "Hi, good morning. This is Caesar from Simple.Biz." },
      { s: 'caller', t: "Thank you for calling. How can I assist you today? I'm here to help with any questions you may have." },
    ]},

  // --- CONVERSION ---
  { name: '19. "Do not call list" — hard rejection', expect: 'Respectful compliance',
    context: [
      { s: 'agent', t: "Hi, this is Caesar from Simple.Biz." },
      { s: 'caller', t: "Put me on the do not call list. Don't call me again." },
    ]},
  { name: '20. "Yeah whatever, go ahead" — apathetic agreement', expect: 'Conversion — collect details',
    context: [
      { s: 'agent', t: "Would you mind if I can have Bob or his partner give you a quick call later to talk about your website?" },
      { s: 'caller', t: "Yeah whatever, go ahead." },
    ]},
];

// ============================================================================
// API CALL
// ============================================================================
async function callClaude(context, count) {
  const stage = count < 5 ? 'greeting' : count < 10 ? 'discovery' : count < 20 ? 'objection' : 'closing';
  const userPrompt = `Stage: ${stage}\nTranscript Count: ${count}\n\nRecent Conversation:\n${context}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 150, temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM_PROMPT }, { type: 'text', text: GOLDEN_SCRIPTS }],
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content[0].text;
  const heading = raw.match(/\[HEADING\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '?';
  const stg = raw.match(/\[STAGE\]:\s*(\w+)/i)?.[1]?.trim() || '?';
  const ctxLine = raw.match(/\[CONTEXT\]:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || '';
  let script = raw.match(/\[SCRIPT\]:\s*(.+?)$/is)?.[1]?.trim() || '?';
  script = script.split(/\n\s*[-—*#]/)[0].trim();
  script = script.split(/\s*---/)[0].trim();
  script = script.replace(/^["']|["']$/g, '');
  return { heading, stage: stg, context: ctxLine, script };
}

// ============================================================================
// RUN
// ============================================================================
async function main() {
  console.log('='.repeat(80));
  console.log('20-CASE TEST — FINAL PROMPT (pulled from production file)');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const sc of SCENARIOS) {
    const context = sc.context.map(c => `${c.s.toUpperCase()}: "${c.t}"`).join('\n');
    const count = sc.context.length;

    console.log(`\n${'─'.repeat(80)}`);
    console.log(sc.name);
    console.log(`Expected: ${sc.expect}`);
    console.log(`${'─'.repeat(80)}`);
    for (const c of sc.context) {
      console.log(`  ${c.s === 'agent' ? 'AGENT' : 'CUSTOMER'}: "${c.t}"`);
    }

    try {
      const tip = await callClaude(context, count);
      console.log(`\n  >> [${tip.heading}] (${tip.stage})`);
      if (tip.context) console.log(`     Why: ${tip.context}`);
      console.log(`     "${tip.script.substring(0, 160)}${tip.script.length > 160 ? '...' : ''}"`);

      results.push({ name: sc.name, expect: sc.expect, heading: tip.heading, stage: tip.stage, script: tip.script.substring(0, 120), why: tip.context });
      passed++;
    } catch (e) {
      console.log(`  >> ERROR: ${e.message}`);
      results.push({ name: sc.name, expect: sc.expect, heading: 'ERROR', stage: 'ERROR', script: e.message, why: '' });
      failed++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} errors out of ${SCENARIOS.length}`);
  console.log('='.repeat(80));

  // Print summary table
  console.log('\nSUMMARY TABLE:');
  console.log('─'.repeat(120));
  console.log(`${'#'.padEnd(4)} ${'Scenario'.padEnd(42)} ${'Heading'.padEnd(22)} ${'Stage'.padEnd(18)} Script (truncated)`);
  console.log('─'.repeat(120));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${String(i+1).padEnd(4)} ${r.name.substring(0,40).padEnd(42)} ${r.heading.substring(0,20).padEnd(22)} ${r.stage.padEnd(18)} ${r.script.substring(0,50)}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
