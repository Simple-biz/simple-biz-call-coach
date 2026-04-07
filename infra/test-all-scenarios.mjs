import WebSocket from 'ws';

const WS_URL = 'wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production';
const API_KEY = 'devassist-cce03814ca61352a852641fe9bb4542877975dd1d65d353ba0459add57c15efa';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SCENARIOS = [
  {
    name: '1. GREETING — Customer says "Who is this?"',
    expect: 'Should suggest intro script with agent name + Bob',
    transcripts: [
      { speaker: 'caller', text: "Who is this?" },
    ],
  },
  {
    name: '2. DISCOVERY — Agent already introduced, customer says "tell me about it"',
    expect: 'Should use Bob Transition (skip agent name), NOT repeat intro',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. I'm reaching out about your business website. Do you have a minute?" },
      { speaker: 'caller', text: "Yeah sure Kayser. Tell me about it." },
    ],
  },
  {
    name: '3. SEO PROBLEM — Customer describes website SEO issues',
    expect: 'Should use SEO Problem Empathy, empathize first, then Bob callback',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. Do you have a minute?" },
      { speaker: 'caller', text: "Yeah sure." },
      { speaker: 'agent', text: "My partner Bob and I are local website designers. What kind of business do you run?" },
      { speaker: 'caller', text: "I run a plumbing business." },
      { speaker: 'agent', text: "That's awesome. Do you currently have a website?" },
      { speaker: 'caller', text: "Yeah I have one but it's not showing up on Google. My SEO is terrible and the site is basically dead." },
    ],
  },
  {
    name: '4. CONVERSION — Customer agrees to callback + gives time',
    expect: 'Should acknowledge the TIME (4PM tomorrow), ask for name',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. Do you have a minute?" },
      { speaker: 'caller', text: "Sure, what's this about?" },
      { speaker: 'agent', text: "My partner Bob and I are local website designers. What kind of business do you run?" },
      { speaker: 'caller', text: "I run a clothing store." },
      { speaker: 'agent', text: "That's awesome. Do you have a website or is that something you've been thinking about?" },
      { speaker: 'caller', text: "I've been thinking about it. I only use Instagram right now." },
      { speaker: 'agent', text: "A website works great alongside Instagram for SEO. Would you mind if my partner Bob gives you a quick call to show you how?" },
      { speaker: 'caller', text: "Yeah definitely. But I'm busy right now, can we do tomorrow at 4PM?" },
    ],
  },
  {
    name: '5. DECLINE — Customer says "not interested"',
    expect: 'Should use Respect Decline — polite goodbye, NO pushback',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. I'm reaching out about your business website." },
      { speaker: 'caller', text: "I'm not interested. Thanks though." },
    ],
  },
  {
    name: '6. PRICING — Customer asks how much it costs',
    expect: 'Should redirect to Bob for pricing, NOT give numbers',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. My partner Bob and I build websites for local businesses." },
      { speaker: 'caller', text: "Okay, how much does a website cost?" },
    ],
  },
  {
    name: '7. BUSY — Customer says "I\'m busy right now"',
    expect: 'Should ask if they have a website or offer quick pitch',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. I'm reaching out about your business website. Do you have a minute?" },
      { speaker: 'caller', text: "Not really, I'm pretty busy right now." },
    ],
  },
  {
    name: '8. SIGNOFF — Customer already gave name + time + number',
    expect: 'Should sign off, NOT ask for more info',
    transcripts: [
      { speaker: 'caller', text: "Hello?" },
      { speaker: 'agent', text: "Hi, this is Kayser. My partner Bob and I build websites. Would you mind if Bob gives you a call?" },
      { speaker: 'caller', text: "Sure, sounds good." },
      { speaker: 'agent', text: "Great! And your name is?" },
      { speaker: 'caller', text: "It's Maria." },
      { speaker: 'agent', text: "Nice to meet you Maria. What's the best number to reach you?" },
      { speaker: 'caller', text: "You can call me at 555-123-4567." },
      { speaker: 'agent', text: "Got it. And what time works best?" },
      { speaker: 'caller', text: "Tomorrow around 2 works." },
    ],
  },
];

async function runScenario(scenario, index) {
  return new Promise(async (resolve) => {
    const ws = new WebSocket(`${WS_URL}?apiKey=${API_KEY}`);
    let conversationId = null;
    let tipResult = null;

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'CONVERSATION_STARTED' && msg.payload?.conversationId) {
        conversationId = msg.payload.conversationId;
      }
      if (msg.type === 'INTELLIGENCE_UPDATE' && msg.payload?.aiTip) {
        tipResult = msg.payload.aiTip;
      }
    });

    ws.on('error', (err) => {
      console.log(`  ❌ WebSocket error: ${err.message}`);
      resolve(null);
    });

    await new Promise(r => ws.on('open', r));

    // Start conversation
    ws.send(JSON.stringify({ action: 'startConversation', agentId: `test-${index}` }));
    await sleep(2000);

    if (!conversationId) {
      console.log(`  ❌ No conversationId received`);
      ws.close();
      resolve(null);
      return;
    }

    // Send transcripts
    for (const t of scenario.transcripts) {
      ws.send(JSON.stringify({
        action: 'transcript',
        conversationId,
        speaker: t.speaker,
        text: t.text,
        isFinal: true,
        timestamp: Date.now()
      }));
      await sleep(400);
    }

    // Wait for DB writes
    await sleep(2000);

    // Request tip
    ws.send(JSON.stringify({
      action: 'getIntelligence',
      skipTip: false,
      timestamp: Date.now()
    }));

    // Wait for response
    await sleep(8000);
    ws.close();
    resolve(tipResult);
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CALL COACH — COMPREHENSIVE SCENARIO TEST');
  console.log('  Testing against LIVE AWS infrastructure (Haiku-only)');
  console.log('═══════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    console.log(`\n━━━ ${s.name} ━━━`);
    console.log(`  Expected: ${s.expect}`);

    const tip = await runScenario(s, i);

    if (tip) {
      console.log(`  ✅ Heading:  ${tip.heading}`);
      console.log(`  ✅ Stage:    ${tip.stage}`);
      console.log(`  ✅ Script:   "${tip.suggestion}"`);
      if (tip.context) console.log(`  ✅ Context:  ${tip.context}`);
      passed++;
    } else {
      console.log(`  ❌ NO TIP RECEIVED (fallback or error)`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${SCENARIOS.length}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
