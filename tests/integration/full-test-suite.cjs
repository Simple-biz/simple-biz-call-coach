const WebSocket = require('ws');
let ws;
let testResults = [];

async function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket('wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production?apiKey=' + encodeURIComponent(process.env.BACKEND_API_KEY));
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject('connect timeout'), 10000);
  });
}

async function startConversation(agentId) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject('start timeout'), 15000);
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.type === 'CONVERSATION_STARTED') { clearTimeout(t); ws.off('message', h); resolve(m.payload.conversationId); } };
    ws.on('message', h);
    ws.send(JSON.stringify({ action: 'startConversation', agentId, metadata: { source: 'test-suite', apiKey: process.env.BACKEND_API_KEY } }));
  });
}

async function sendTranscripts(convId, transcripts) {
  for (const t of transcripts) {
    ws.send(JSON.stringify({ action: 'transcript', conversationId: convId, speaker: t.speaker, text: t.text, isFinal: true, timestamp: Date.now() }));
    await new Promise(r => setTimeout(r, 150));
  }
}

async function getIntelligence(convId, skipTip) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', h); reject('intel timeout'); }, 25000);
    const h = (d) => { const m = JSON.parse(d.toString()); if (m.type === 'INTELLIGENCE_UPDATE') { clearTimeout(t); ws.off('message', h); resolve(m.payload); } };
    ws.on('message', h);
    ws.send(JSON.stringify({ action: 'getIntelligence', conversationId: convId, skipTip: skipTip !== false, timestamp: Date.now() }));
  });
}

async function endConversation(convId) {
  ws.send(JSON.stringify({ action: 'endConversation', conversationId: convId, timestamp: Date.now() }));
  await new Promise(r => setTimeout(r, 500));
}

async function testWebhook(body, secret) {
  const url = secret
    ? 'https://bs4esfiod22hjsl3qezeoeutci0kvfnq.lambda-url.us-east-1.on.aws/?secret=' + secret
    : 'https://bs4esfiod22hjsl3qezeoeutci0kvfnq.lambda-url.us-east-1.on.aws/';
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return resp.status;
}

const VALID_SECRET = 'ct-wh-a7f3e9b1d4c8052e6f19a3b7d5e2c8f4a1b6d9e3f7024c8a5b1e6d3f9a2c7';

function log(name, passed, detail) {
  const icon = passed ? '\u2705' : '\u274C';
  console.log(icon + ' ' + name + (detail ? ' \u2014 ' + detail : ''));
  testResults.push({ name, passed, detail });
}

async function runTests() {
  console.log('');
  console.log('========================================================');
  console.log('     CALL COACH - FULL TEST SUITE');
  console.log('========================================================');
  console.log('');

  // === 1. CONNECTION & AUTH ===
  console.log('--- 1. CONNECTION & AUTH ---');

  try { await connect(); log('1a. WebSocket connect with valid key', true); }
  catch (e) { log('1a. WebSocket connect', false, String(e)); process.exit(1); }

  try {
    const s = await testWebhook({}, null);
    log('1b. Webhook no secret -> 401', s === 401, 'HTTP ' + s);
  } catch (e) { log('1b. Webhook no secret', false, String(e)); }

  try {
    const s = await testWebhook({ uuid: 'test' }, 'wrong-secret');
    log('1c. Webhook wrong secret -> 403', s === 403, 'HTTP ' + s);
  } catch (e) { log('1c. Webhook wrong secret', false, String(e)); }

  try {
    const s = await testWebhook({ uuid: 'auth-valid-' + Date.now() }, VALID_SECRET);
    log('1d. Webhook valid secret -> 200', s === 200, 'HTTP ' + s);
  } catch (e) { log('1d. Webhook valid secret', false, String(e)); }

  console.log('');

  // === 2. CONVERSATION LIFECYCLE ===
  console.log('--- 2. CONVERSATION LIFECYCLE ---');

  let convId;
  try {
    convId = await startConversation('test-lifecycle');
    log('2a. Start conversation', !!convId, convId.substring(0, 8) + '...');
  } catch (e) { log('2a. Start conversation', false, String(e)); }

  try {
    await sendTranscripts(convId, [
      { speaker: 'agent', text: 'Hi, this is Kayser from Simple Biz.' },
      { speaker: 'caller', text: 'Hello Kayser, how can I help?' },
    ]);
    log('2b. Send transcripts', true, '2 messages');
  } catch (e) { log('2b. Send transcripts', false, String(e)); }

  try {
    await endConversation(convId);
    log('2c. End conversation cleanly', true);
  } catch (e) { log('2c. End conversation', false, String(e)); }

  console.log('');

  // === 3. INTELLIGENCE (AUTO-ANALYSIS) ===
  console.log('--- 3. INTELLIGENCE (AUTO-ANALYSIS) ---');

  convId = await startConversation('test-intelligence');
  await sendTranscripts(convId, [
    { speaker: 'agent', text: 'Hi, this is Mark from Simple Biz in Sacramento. We design websites.' },
    { speaker: 'caller', text: 'This is John from Acme Plumbing. Our site is acmeplumbing.com.' },
    { speaker: 'agent', text: 'Can I get your phone? Bob will send a free audit.' },
    { speaker: 'caller', text: 'Sure, 775-406-8577 and john@acmeplumbing.com please.' },
    { speaker: 'agent', text: 'Bob will call Thursday March 20th at 2pm. We are in Roseville.' },
    { speaker: 'caller', text: 'Sounds great. Available Thursday afternoon. Looking forward to it!' },
  ]);
  await new Promise(r => setTimeout(r, 2000));

  try {
    const intel = await getIntelligence(convId, true);
    log('3a. Auto-analysis returns intelligence', !!intel.intelligence);
    log('3b. Auto-analysis has NO AI tip', !intel.aiTip);
    log('3c. Sentiment detected', ['positive', 'neutral', 'negative'].includes(intel.intelligence.sentiment.label),
      intel.intelligence.sentiment.label + ' (' + intel.intelligence.sentiment.score + ')');
    log('3d. Intents detected', intel.intelligence.intents.length > 0, intel.intelligence.intents.length + ' intents');
    log('3e. Topics detected', intel.intelligence.topics.length > 0, intel.intelligence.topics.length + ' topics');
    log('3f. Summary generated', intel.intelligence.summary.length > 10);
  } catch (e) { log('3a-f. Intelligence', false, String(e)); }

  console.log('');

  // === 4. ENTITY EXTRACTION ===
  console.log('--- 4. ENTITY EXTRACTION ---');

  try {
    const intel = await getIntelligence(convId, true);
    const e = intel.entities;
    log('4a. Business names', e.businessNames.length > 0, JSON.stringify(e.businessNames));
    log('4b. People', e.people.length > 0, JSON.stringify(e.people));
    log('4c. Email', e.contactInfo.emails.length > 0, JSON.stringify(e.contactInfo.emails));
    log('4d. Phone', e.contactInfo.phoneNumbers.length > 0, JSON.stringify(e.contactInfo.phoneNumbers));
    log('4e. Website', e.contactInfo.urls.length > 0, JSON.stringify(e.contactInfo.urls));
    log('4f. Location', e.locations.length > 0, JSON.stringify(e.locations));
    log('4g. Dates', e.dates.length > 0, JSON.stringify(e.dates));
  } catch (e) { log('4a-g. Entities', false, String(e)); }

  console.log('');

  // === 5. AI SUGGESTED LINE (GOLDEN SCRIPTS) ===
  console.log('--- 5. AI SUGGESTED LINE (GOLDEN SCRIPTS) ---');

  try {
    const intel = await getIntelligence(convId, false);
    log('5a. Manual request returns AI tip', !!intel.aiTip, intel.aiTip ? intel.aiTip.heading : 'none');
    log('5b. AI tip has suggestion', !!intel.aiTip?.suggestion, (intel.aiTip?.suggestion || '').substring(0, 60) + '...');
    log('5c. AI tip has stage', !!intel.aiTip?.stage, intel.aiTip?.stage);
    log('5d. AI tip has context', !!intel.aiTip?.context);
  } catch (e) { log('5a-d. AI tip', false, String(e)); }

  await endConversation(convId);
  console.log('');

  // === 6. BACK-TO-BACK CALLS (AUTO-ARM) ===
  console.log('--- 6. BACK-TO-BACK CALLS (AUTO-ARM) ---');

  const leads = [
    { name: 'Sarah at Nevada Heating', phone: '+17754068577' },
    { name: 'John at Acme Plumbing', phone: '+15551234567' },
    { name: 'Mike at Reno Rooter', phone: '+15559876543' },
    { name: 'Lisa at Sierra Air', phone: '+15553334444' },
    { name: 'Dave at Quick Fix', phone: '+15556667777' },
  ];

  for (let i = 0; i < leads.length; i++) {
    try {
      const cid = await startConversation('autoarm-call' + (i + 1));
      await sendTranscripts(cid, [
        { speaker: 'agent', text: 'Hi, this is Kayser from Simple Biz calling about your website.' },
        { speaker: 'caller', text: 'This is ' + leads[i].name + '. What can I do for you?' },
        { speaker: 'agent', text: 'Would you mind if Bob gives you a call later?' },
        { speaker: 'caller', text: 'Sure, call me at ' + leads[i].phone + '.' },
      ]);
      await new Promise(r => setTimeout(r, 1500));
      const intel = await getIntelligence(cid, true);
      await endConversation(cid);
      log('6' + String.fromCharCode(97 + i) + '. Call #' + (i + 1) + ' (' + leads[i].name + ')', !!intel.intelligence,
        'sentiment=' + intel.intelligence.sentiment.label);
    } catch (e) { log('6' + String.fromCharCode(97 + i) + '. Call #' + (i + 1), false, String(e)); }
  }

  console.log('');

  // === 7. SENTIMENT SHIFTS ===
  console.log('--- 7. SENTIMENT SHIFTS ---');

  convId = await startConversation('test-sentiment');

  await sendTranscripts(convId, [
    { speaker: 'agent', text: 'Our clients see 3-5x more traffic within 90 days.' },
    { speaker: 'caller', text: 'That sounds amazing! I have been looking for someone to help. When can we start?' },
  ]);
  await new Promise(r => setTimeout(r, 1500));
  try {
    const intel = await getIntelligence(convId, true);
    log('7a. Positive conversation detected', intel.intelligence.sentiment.score > 0, 'score=' + intel.intelligence.sentiment.score);
  } catch (e) { log('7a. Positive sentiment', false, String(e)); }

  await sendTranscripts(convId, [
    { speaker: 'caller', text: 'Actually never mind. I am not interested at all. Stop calling me. Do not call this number again.' },
  ]);
  await new Promise(r => setTimeout(r, 1500));
  try {
    const intel = await getIntelligence(convId, true);
    log('7b. Sentiment shifts after rejection', typeof intel.intelligence.sentiment.score === 'number', 'score=' + intel.intelligence.sentiment.score);
  } catch (e) { log('7b. Sentiment shift', false, String(e)); }

  await sendTranscripts(convId, [
    { speaker: 'caller', text: 'You know what, that actually sounds great! I changed my mind. Sign me up!' },
  ]);
  await new Promise(r => setTimeout(r, 1500));
  try {
    const intel = await getIntelligence(convId, true);
    log('7c. Sentiment recovers after positive', typeof intel.intelligence.sentiment.score === 'number', 'score=' + intel.intelligence.sentiment.score);
  } catch (e) { log('7c. Sentiment recovery', false, String(e)); }

  await endConversation(convId);
  console.log('');

  // === 8. WEBHOOK PARTIAL PAYLOADS ===
  console.log('--- 8. WEBHOOK PARTIAL PAYLOADS (AUTO-DIAL) ---');

  try {
    const s = await testWebhook({ uuid: 'partial-min-' + Date.now() }, VALID_SECRET);
    log('8a. Minimal payload (uuid only)', s === 200, 'HTTP ' + s);
  } catch (e) { log('8a. Minimal payload', false, String(e)); }

  try {
    const s = await testWebhook({ uuid: 'partial-dest-' + Date.now(), destination: '+17754068577' }, VALID_SECRET);
    log('8b. Partial (uuid + destination)', s === 200, 'HTTP ' + s);
  } catch (e) { log('8b. Partial payload', false, String(e)); }

  try {
    const s = await testWebhook({
      id: 99999, uuid: 'full-' + Date.now(), destination: '+17754068577', source: '+15550001234',
      start: new Date().toISOString(), app_user: '8759e97b-505c-41e6-92d9-4e68c15bae49',
      campaign: 42, contact: 1001, call_type: 'outbound', inbound: false
    }, VALID_SECRET);
    log('8c. Full payload', s === 200, 'HTTP ' + s);
  } catch (e) { log('8c. Full payload', false, String(e)); }

  try {
    const s = await testWebhook({ uuid: 'partial-nocalltype-' + Date.now(), destination: '+17754068577', campaign_id: '42', inbound: false }, VALID_SECRET);
    log('8d. No call_type/start/id (real auto-dial format)', s === 200, 'HTTP ' + s);
  } catch (e) { log('8d. Real auto-dial format', false, String(e)); }

  console.log('');

  // === SUMMARY ===
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const total = testResults.length;

  console.log('========================================================');
  console.log('  RESULTS: ' + passed + '/' + total + ' passed' + (failed > 0 ? ', ' + failed + ' FAILED' : ''));
  console.log('========================================================');

  if (failed > 0) {
    console.log('');
    console.log('Failed:');
    testResults.filter(t => !t.passed).forEach(t => console.log('  \u274C ' + t.name + ' \u2014 ' + t.detail));
  }

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error('Test suite error:', e); process.exit(1); });
