const WebSocket = require('ws');
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }

const WS_URL = 'wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production';
const BACKEND_API_KEY = 'devassist-cce03814ca61352a852641fe9bb4542877975dd1d65d353ba0459add57c15efa';
const MODEL = 'claude-haiku-4-5-20251001';

// Dry customer persona
const CUSTOMER_PROMPT = `You are Linda, a 48-year-old woman who owns "Linda's Flower Boutique" in Austin, Texas. You're arranging flowers right now and half-distracted.

YOUR PERSONALITY:
- You give SHORT answers. Not rude, just busy and distracted.
- You answer with 1-8 words usually
- You occasionally say "hold on" because you're helping a customer in the shop
- You DO have an old Facebook page but no real website
- You've been meaning to get a website but never got around to it
- You're interested if someone can make it easy for you
- You worry about cost
- When asked good questions, you open up a LITTLE more
- You eventually agree if the agent is respectful of your time

RULES: 1-8 words per response. Short. Busy. Distracted. Output ONLY Linda's words.`;

// ============================================================================
// CUSTOMER AI
// ============================================================================
async function getCustomerResponse(transcript) {
  const convo = transcript.map(t => `${t.speaker === 'agent' ? 'Agent' : 'Linda'}: ${t.text}`).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 40, temperature: 0.7,
      system: [{ type: 'text', text: CUSTOMER_PROMPT }],
      messages: [{ role: 'user', content: `${convo}\n\nLinda:` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error('Customer AI error: ' + data.error.message);
  return data.content[0].text.trim().replace(/^(Linda:\s*)/i, '');
}

// ============================================================================
// AWS WEBSOCKET CLIENT
// ============================================================================
function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const url = `${WS_URL}?apiKey=${encodeURIComponent(BACKEND_API_KEY)}`;
    const ws = new WebSocket(url);
    ws.on('open', () => {
      console.log('  [WS] Connected to AWS');
      resolve(ws);
    });
    ws.on('error', (err) => reject(err));
    setTimeout(() => reject(new Error('WS connect timeout')), 10000);
  });
}

function sendMessage(ws, message) {
  ws.send(JSON.stringify(message));
}

function waitForMessage(ws, type, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
  });
}

// ============================================================================
// MAIN SIMULATION
// ============================================================================
async function main() {
  console.log('='.repeat(80));
  console.log('REAL INFRASTRUCTURE SIMULATION');
  console.log("Connecting to AWS WebSocket → Lambda → Claude Haiku");
  console.log("Agent: Caesar | Customer: Linda (Linda's Flower Boutique, Austin TX)");
  console.log('='.repeat(80));

  // 1. Connect
  console.log('\n  [Connecting to AWS WebSocket...]');
  const ws = await connectWebSocket();

  // 2. Start conversation
  console.log('  [Starting conversation...]');
  sendMessage(ws, {
    action: 'startConversation',
    agentId: 'caesar-test',
    metadata: { timestamp: Date.now(), apiKey: BACKEND_API_KEY }
  });

  const startMsg = await waitForMessage(ws, 'CONVERSATION_STARTED');
  const conversationId = startMsg.payload.conversationId;
  console.log(`  [Conversation started: ${conversationId}]\n`);

  const transcript = [];
  const MAX_TURNS = 10;

  // Agent opener
  const opener = "Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute?";
  transcript.push({ speaker: 'agent', text: opener });
  console.log(`  AGENT: "${opener}"`);

  // Send opener as transcript
  sendMessage(ws, { action: 'transcript', conversationId, speaker: 'agent', text: opener, isFinal: true, timestamp: Date.now() });
  await new Promise(r => setTimeout(r, 500));

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // 1. Customer responds
    const customerResponse = await getCustomerResponse(transcript);
    transcript.push({ speaker: 'caller', text: customerResponse });
    console.log(`\n  LINDA: "${customerResponse}"`);

    // Send customer transcript to AWS
    sendMessage(ws, { action: 'transcript', conversationId, speaker: 'caller', text: customerResponse, isFinal: true, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 500));

    // Check end
    const lower = customerResponse.toLowerCase();
    if (lower.includes('bye') || lower.includes('gotta go') || lower.includes('not interested')) {
      console.log('\n  [Call ended by customer]');
      break;
    }

    // 2. Request AI tip from AWS (getIntelligence with skipTip=false)
    console.log('  [Requesting AI tip from AWS Lambda...]');
    sendMessage(ws, { action: 'getIntelligence', conversationId, skipTip: false, timestamp: Date.now() });

    let aiTip;
    try {
      const intelligenceMsg = await waitForMessage(ws, 'INTELLIGENCE_UPDATE', 20000);
      aiTip = intelligenceMsg.payload?.aiTip;
      if (!aiTip) {
        console.log('  [No AI tip in response — skipping]');
        continue;
      }
    } catch (e) {
      console.log(`  [AI tip timeout — ${e.message}]`);
      continue;
    }

    console.log(`\n  >> AI [${aiTip.heading}] (${aiTip.stage}):`);
    console.log(`     "${aiTip.suggestion.substring(0, 200)}"`);

    // 3. Agent follows the tip
    let agentLine = aiTip.suggestion
      .replace(/\[Agent\]/g, 'Caesar')
      .replace(/\[Location\]/g, 'Austin')
      .replace(/\[Name\]/g, 'Linda');
    if (agentLine.length > 250) agentLine = agentLine.substring(0, 247) + '...';

    transcript.push({ speaker: 'agent', text: agentLine });
    console.log(`\n  AGENT: "${agentLine}"`);

    // Send agent transcript
    sendMessage(ws, { action: 'transcript', conversationId, speaker: 'agent', text: agentLine, isFinal: true, timestamp: Date.now() });

    // Check sign off
    if (aiTip.suggestion.toLowerCase().includes('have a beautiful day') || aiTip.suggestion.toLowerCase().includes('take care') || aiTip.stage === 'SIGNOFF') {
      console.log('\n  [Agent signed off]');
      break;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // End conversation
  sendMessage(ws, { action: 'endConversation', conversationId, timestamp: Date.now() });
  await new Promise(r => setTimeout(r, 1000));
  ws.close();

  // Print full transcript
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FULL TRANSCRIPT (via AWS Infrastructure)');
  console.log('='.repeat(80));
  const startTime = new Date(); startTime.setHours(10, 0, 0, 0);
  transcript.forEach((t, i) => {
    const time = new Date(startTime.getTime() + i * 7000);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = t.speaker === 'agent' ? 'You' : 'Customer';
    console.log(`\n[${timeStr}] ${label}: ${t.text}`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total: ${transcript.length} | Agent: ${transcript.filter(t=>t.speaker==='agent').length} | Customer: ${transcript.filter(t=>t.speaker==='caller').length}`);
  console.log('Route: WebSocket → API Gateway → Lambda → Claude Haiku → Lambda → WebSocket');
  console.log('='.repeat(80));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
