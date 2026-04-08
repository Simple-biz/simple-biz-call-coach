import WebSocket from 'ws';

const WS_URL = 'wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production';
const API_KEY = 'devassist-cce03814ca61352a852641fe9bb4542877975dd1d65d353ba0459add57c15efa';

// Scenario: Customer asks about pricing
const transcripts = [
  { speaker: 'caller', text: "Hello?" },
  { speaker: 'agent', text: "Hi, this is Kayser from Simple Biz. My partner Bob and I build websites for local businesses." },
  { speaker: 'caller', text: "Okay, how much does a website cost?" },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('Connecting...');
  const ws = new WebSocket(`${WS_URL}?apiKey=${API_KEY}`);

  let conversationId = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    // Capture conversationId from CONVERSATION_STARTED
    if (msg.type === 'CONVERSATION_STARTED' && msg.payload?.conversationId) {
      conversationId = msg.payload.conversationId;
      console.log(`Got conversationId: ${conversationId}`);
      return;
    }

    if (msg.type === 'aiTip' || msg.aiTip) {
      const tip = msg.aiTip || msg;
      console.log('\n========== AI TIP ==========');
      console.log(`Heading: ${tip.heading}`);
      console.log(`Stage: ${tip.stage}`);
      console.log(`Script: ${tip.suggestion}`);
      console.log(`Model: ${tip.model}`);
      console.log(`Context: ${tip.context || 'none'}`);
      console.log('============================\n');
    } else if (msg.type === 'INTELLIGENCE_UPDATE' && msg.payload?.aiTip) {
      const tip = msg.payload.aiTip;
      console.log('\n========== AI TIP ==========');
      console.log(`Heading: ${tip.heading}`);
      console.log(`Stage: ${tip.stage}`);
      console.log(`Script: ${tip.suggestion}`);
      console.log(`Context: ${tip.context || 'none'}`);
      console.log('============================\n');
    } else if (msg.type === 'STATUS_UPDATE' || msg.type === 'INTELLIGENCE_UPDATE') {
      // Suppress spam
    } else {
      console.log('MSG:', msg.type || msg.action || JSON.stringify(msg).substring(0, 120));
    }
  });

  await new Promise(r => ws.on('open', r));
  console.log('Connected!');

  // Start conversation with required agentId
  console.log('Starting conversation...');
  ws.send(JSON.stringify({ action: 'startConversation', agentId: 'test-agent-1' }));
  await sleep(3000);

  if (!conversationId) {
    console.error('ERROR: Never received conversationId! Aborting.');
    ws.close();
    return;
  }
  console.log(`Conversation started: ${conversationId}`);

  // Send transcripts
  for (const t of transcripts) {
    console.log(`>> [${t.speaker}] ${t.text}`);
    ws.send(JSON.stringify({
      action: 'transcript',
      conversationId,
      speaker: t.speaker,
      text: t.text,
      isFinal: true,
      timestamp: Date.now()
    }));
    await sleep(800);
  }

  // Wait for transcripts to save
  console.log('\nWaiting 3s for DB writes...');
  await sleep(3000);

  // Request tip
  console.log('Requesting AI tip (skipTip=false)...');
  ws.send(JSON.stringify({
    action: 'getIntelligence',
    skipTip: false,
    timestamp: Date.now()
  }));

  // Wait for response
  await sleep(15000);
  ws.close();
  console.log('Done.');
}

run().catch(console.error);
