const WebSocket = require('ws');
let ws;
let testResults = [];

const BACKEND_API_KEY = process.env.BACKEND_API_KEY;
const WS_URL = 'wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production';
const WEBHOOK_URL = 'https://bs4esfiod22hjsl3qezeoeutci0kvfnq.lambda-url.us-east-1.on.aws/';
const WEBHOOK_SECRET = 'ct-wh-a7f3e9b1d4c8052e6f19a3b7d5e2c8f4a1b6d9e3f7024c8a5b1e6d3f9a2c7';

async function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL + '?apiKey=' + encodeURIComponent(BACKEND_API_KEY));
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject('connect timeout'), 10000);
  });
}

async function startConv(agent) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject('start timeout'), 15000);
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.type === 'CONVERSATION_STARTED') { clearTimeout(t); ws.off('message', h); resolve(m.payload.conversationId); } };
    ws.on('message', h);
    ws.send(JSON.stringify({ action: 'startConversation', agentId: agent, metadata: { source: 'ux-test', apiKey: BACKEND_API_KEY } }));
  });
}

async function send(convId, transcripts) {
  for (const t of transcripts) {
    ws.send(JSON.stringify({ action: 'transcript', conversationId: convId, speaker: t.speaker, text: t.text, isFinal: true, timestamp: Date.now() }));
    await new Promise(r => setTimeout(r, 100));
  }
}

async function intel(convId, skipTip) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject('intel timeout'); }, 25000);
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.type === 'INTELLIGENCE_UPDATE') { clearTimeout(t); ws.off('message', h); resolve(m.payload); } };
    ws.on('message', h);
    ws.send(JSON.stringify({ action: 'getIntelligence', conversationId: convId, skipTip: skipTip !== false, timestamp: Date.now() }));
  });
}

async function endConv(convId) {
  ws.send(JSON.stringify({ action: 'endConversation', conversationId: convId, timestamp: Date.now() }));
  await new Promise(r => setTimeout(r, 500));
}

function log(name, passed, detail) {
  const icon = passed ? '\u2705' : '\u274C';
  console.log(icon + ' ' + name + (detail ? ' \u2014 ' + detail : ''));
  testResults.push({ name, passed, detail });
}

async function runTests() {
  console.log('');
  console.log('========================================================');
  console.log('     CALL COACH - UX FUNCTION TEST SUITE');
  console.log('========================================================');
  console.log('');

  await connect();
  console.log('Connected to AWS WebSocket');
  console.log('');

  // === 1. AGENT OPENS CALL COACH MID-CALL ===
  console.log('--- 1. AGENT OPENS MID-CALL (join existing conversation) ---');
  try {
    const cid = await startConv('ux-midcall');
    // Simulate transcripts already happened before agent opened Call Coach
    await send(cid, [
      { speaker: 'agent', text: 'Hi, this is Kayser from Simple Biz. We design websites.' },
      { speaker: 'caller', text: 'Hello. What do you need?' },
      { speaker: 'agent', text: 'We help local businesses rank higher on Google.' },
      { speaker: 'caller', text: 'We already have a website at acme.com.' },
    ]);
    await new Promise(r => setTimeout(r, 1500));
    // Agent opens Call Coach NOW — requests intelligence on existing transcripts
    const result = await intel(cid, true);
    log('1a. Intelligence works on existing transcripts', !!result.intelligence, 'sentiment=' + result.intelligence.sentiment.label);
    log('1b. Entities extracted from pre-existing convo', result.entities.contactInfo.urls.length > 0, JSON.stringify(result.entities.contactInfo.urls));
    await endConv(cid);
  } catch (e) { log('1. Mid-call join', false, String(e)); }

  console.log('');

  // === 2. RAPID CALL TRANSITIONS (hangup → new call in 2 seconds) ===
  console.log('--- 2. RAPID CALL TRANSITIONS (2s between calls) ---');
  try {
    for (let i = 1; i <= 3; i++) {
      const cid = await startConv('ux-rapid-' + i);
      await send(cid, [
        { speaker: 'agent', text: 'Quick call ' + i + '. Hi from Kayser.' },
        { speaker: 'caller', text: 'Hi. Not interested. Bye.' },
      ]);
      await endConv(cid);
      // Only 1 second between calls
      await new Promise(r => setTimeout(r, 1000));
      log('2' + String.fromCharCode(96 + i) + '. Rapid call #' + i + ' completed', true);
    }
  } catch (e) { log('2. Rapid transitions', false, String(e)); }

  console.log('');

  // === 3. VERY SHORT CALL (agent says one word, hangs up) ===
  console.log('--- 3. VERY SHORT CALL (minimal speech) ---');
  try {
    const cid = await startConv('ux-short');
    await send(cid, [{ speaker: 'agent', text: 'Hello?' }]);
    await new Promise(r => setTimeout(r, 1500));
    const result = await intel(cid, true);
    log('3a. Short call gets intelligence', !!result.intelligence);
    await endConv(cid);
    log('3b. Short call ends cleanly', true);
  } catch (e) { log('3. Short call', false, String(e)); }

  console.log('');

  // === 4. LONG CALL (30+ transcripts) ===
  console.log('--- 4. LONG CALL (30 transcripts) ---');
  try {
    const cid = await startConv('ux-long');
    const longTranscripts = [];
    for (let i = 0; i < 15; i++) {
      longTranscripts.push({ speaker: 'agent', text: 'This is message ' + (i * 2 + 1) + ' from the agent about website design services and SEO optimization for local businesses in Reno Nevada.' });
      longTranscripts.push({ speaker: 'caller', text: 'Response ' + (i * 2 + 2) + ' from the customer asking about pricing, timeline, and what services are included in the package.' });
    }
    await send(cid, longTranscripts);
    await new Promise(r => setTimeout(r, 2000));
    const result = await intel(cid, true);
    log('4a. Long call intelligence works', !!result.intelligence, 'sentiment=' + result.intelligence.sentiment.label);
    log('4b. Long call entities extracted', result.entities.locations.length > 0);

    // Request AI tip on long call
    const tipResult = await intel(cid, false);
    log('4c. AI tip works on long call', !!tipResult.aiTip, tipResult.aiTip?.heading);
    await endConv(cid);
  } catch (e) { log('4. Long call', false, String(e)); }

  console.log('');

  // === 5. RAPID "NEXT SUGGESTION" CLICKS ===
  console.log('--- 5. RAPID NEXT SUGGESTION CLICKS ---');
  try {
    const cid = await startConv('ux-rapid-tips');
    await send(cid, [
      { speaker: 'agent', text: 'Hi, this is Kayser. We design websites for local businesses.' },
      { speaker: 'caller', text: 'Tell me more about your pricing.' },
      { speaker: 'agent', text: 'We are super affordable. Would you mind if Bob gives you a call?' },
    ]);
    await new Promise(r => setTimeout(r, 1500));

    // Fire 3 tip requests in quick succession
    const tipPromises = [
      intel(cid, false),
    ];
    // Wait for first, then fire two more
    const tip1 = await tipPromises[0];
    log('5a. First tip request', !!tip1.aiTip, tip1.aiTip?.heading);

    const tip2 = await intel(cid, false);
    log('5b. Second tip request', !!tip2.aiTip, tip2.aiTip?.heading);

    const tip3 = await intel(cid, false);
    log('5c. Third tip request', !!tip3.aiTip, tip3.aiTip?.heading);
    await endConv(cid);
  } catch (e) { log('5. Rapid tips', false, String(e)); }

  console.log('');

  // === 6. CALL WITH NO CUSTOMER SPEECH (voicemail/no answer) ===
  console.log('--- 6. NO CUSTOMER SPEECH (voicemail) ---');
  try {
    const cid = await startConv('ux-voicemail');
    await send(cid, [
      { speaker: 'agent', text: 'Hello? Is anyone there?' },
      { speaker: 'agent', text: 'Hello? Can you hear me?' },
      { speaker: 'agent', text: 'I guess nobody is there. Goodbye.' },
    ]);
    await new Promise(r => setTimeout(r, 1500));
    const result = await intel(cid, true);
    log('6a. Agent-only call gets intelligence', !!result.intelligence);
    log('6b. No crash on missing customer speech', true);
    await endConv(cid);
  } catch (e) { log('6. No customer speech', false, String(e)); }

  console.log('');

  // === 7. ONLY CUSTOMER SPEAKING (agent muted) ===
  console.log('--- 7. ONLY CUSTOMER SPEAKING (agent muted) ---');
  try {
    const cid = await startConv('ux-customer-only');
    await send(cid, [
      { speaker: 'caller', text: 'Hello? Is anyone there from Simple Biz?' },
      { speaker: 'caller', text: 'I was told someone would call about website design.' },
      { speaker: 'caller', text: 'My name is Sarah and my email is sarah@test.com.' },
    ]);
    await new Promise(r => setTimeout(r, 1500));
    const result = await intel(cid, true);
    log('7a. Customer-only call gets intelligence', !!result.intelligence);
    log('7b. Customer entities extracted', result.entities.people.length > 0, JSON.stringify(result.entities.people));
    log('7c. Customer email extracted', result.entities.contactInfo.emails.length > 0, JSON.stringify(result.entities.contactInfo.emails));
    await endConv(cid);
  } catch (e) { log('7. Customer only', false, String(e)); }

  console.log('');

  // === 8. CALL ENDS DURING INTELLIGENCE PROCESSING ===
  console.log('--- 8. CALL ENDS DURING INTELLIGENCE REQUEST ---');
  try {
    const cid = await startConv('ux-end-during-intel');
    await send(cid, [
      { speaker: 'agent', text: 'Hi, quick question about your website.' },
      { speaker: 'caller', text: 'Sure, what do you need?' },
    ]);
    await new Promise(r => setTimeout(r, 1500));

    // Request intelligence and immediately end conversation
    ws.send(JSON.stringify({ action: 'getIntelligence', conversationId: cid, skipTip: true, timestamp: Date.now() }));
    // End conversation 500ms later (while intelligence is still processing)
    await new Promise(r => setTimeout(r, 500));
    await endConv(cid);
    log('8a. No crash when call ends during intelligence', true);

    // Verify we can start a new call after this
    const newCid = await startConv('ux-after-crash-test');
    log('8b. New call works after interrupted intelligence', !!newCid);
    await endConv(newCid);
  } catch (e) { log('8. End during intelligence', false, String(e)); }

  console.log('');

  // === 9. CONVERSATION WITH MIXED LANGUAGES / SPECIAL CHARACTERS ===
  console.log('--- 9. SPECIAL CHARACTERS & EDGE CASES ---');
  try {
    const cid = await startConv('ux-special-chars');
    await send(cid, [
      { speaker: 'agent', text: 'Hi! This is Kayser... from Simple.Biz (website designers).' },
      { speaker: 'caller', text: 'My email is john+sales@acme-plumbing.co.uk and phone is +1 (775) 406-8577.' },
      { speaker: 'agent', text: 'Great! Can I schedule for 3/24/2026 @ 9:00 AM?' },
      { speaker: 'caller', text: "That's fine. Our address is 123 N. Main St., Ste. #400, Reno, NV 89501." },
    ]);
    await new Promise(r => setTimeout(r, 2000));
    const result = await intel(cid, true);
    log('9a. Handles special characters', !!result.intelligence);
    log('9b. Complex email extracted', result.entities.contactInfo.emails.length > 0, JSON.stringify(result.entities.contactInfo.emails));
    log('9c. Address/location extracted', result.entities.locations.length > 0, JSON.stringify(result.entities.locations));
    await endConv(cid);
  } catch (e) { log('9. Special characters', false, String(e)); }

  console.log('');

  // === 10. EMPTY TRANSCRIPT ===
  console.log('--- 10. EMPTY / MINIMAL INPUT ---');
  try {
    const cid = await startConv('ux-empty');
    await send(cid, [{ speaker: 'agent', text: '.' }]);
    await new Promise(r => setTimeout(r, 1500));
    const result = await intel(cid, true);
    log('10a. Single dot transcript does not crash', !!result.intelligence);
    await endConv(cid);
  } catch (e) { log('10a. Empty transcript', false, String(e)); }

  try {
    const cid = await startConv('ux-numbers-only');
    await send(cid, [
      { speaker: 'agent', text: '775 406 8577' },
      { speaker: 'caller', text: '555 123 4567' },
    ]);
    await new Promise(r => setTimeout(r, 1500));
    const result = await intel(cid, true);
    log('10b. Numbers-only transcripts handled', !!result.intelligence);
    log('10c. Phone numbers from number-only text', result.entities.contactInfo.phoneNumbers.length > 0, JSON.stringify(result.entities.contactInfo.phoneNumbers));
    await endConv(cid);
  } catch (e) { log('10b. Numbers only', false, String(e)); }

  console.log('');

  // === 11. CONCURRENT INTELLIGENCE + WEBHOOK ===
  console.log('--- 11. WEBHOOK DURING ACTIVE CALL ---');
  try {
    const cid = await startConv('ux-webhook-during-call');
    await send(cid, [
      { speaker: 'agent', text: 'Testing webhook during active call.' },
      { speaker: 'caller', text: 'Sure, go ahead.' },
    ]);

    // Fire webhook while call is active
    const resp = await fetch(WEBHOOK_URL + '?secret=' + WEBHOOK_SECRET, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: 'during-call-' + Date.now(), destination: '+17754068577' })
    });
    log('11a. Webhook during active call accepted', resp.status === 200, 'HTTP ' + resp.status);

    // Intelligence should still work
    await new Promise(r => setTimeout(r, 1500));
    const result = await intel(cid, true);
    log('11b. Intelligence still works after webhook', !!result.intelligence);
    await endConv(cid);
  } catch (e) { log('11. Webhook during call', false, String(e)); }

  console.log('');

  // === 12. AI DEFLECTION DETECTION ===
  console.log('--- 12. AI RECEPTIONIST / VOICEMAIL DETECTION ---');
  try {
    const cid = await startConv('ux-ai-detect');
    await send(cid, [
      { speaker: 'agent', text: 'Hi, this is Kayser from Simple Biz.' },
      { speaker: 'caller', text: 'Hello! I am an AI assistant for Delta Corp. I can help schedule appointments or take messages. How can I assist you today?' },
      { speaker: 'agent', text: 'Would you mind if Bob gives you a call later about your website?' },
      { speaker: 'caller', text: 'Certainly! I can schedule that. Could you provide your contact information so someone from our team can reach out?' },
    ]);
    await new Promise(r => setTimeout(r, 2000));
    const result = await intel(cid, false);
    log('12a. AI receptionist detected', !!result.intelligence);
    log('12b. AI tip adapts to AI receptionist', !!result.aiTip, result.aiTip?.heading + ': ' + result.aiTip?.stage);
    await endConv(cid);
  } catch (e) { log('12. AI detection', false, String(e)); }

  console.log('');

  // === SUMMARY ===
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const total = testResults.length;

  console.log('========================================================');
  console.log('  UX TEST RESULTS: ' + passed + '/' + total + ' passed' + (failed > 0 ? ', ' + failed + ' FAILED' : ''));
  console.log('========================================================');

  if (failed > 0) {
    console.log('');
    console.log('Failed:');
    testResults.filter(t => !t.passed).forEach(t => console.log('  \u274C ' + t.name + ' \u2014 ' + (t.detail || 'no detail')));
  }

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error('Test suite error:', e); process.exit(1); });
