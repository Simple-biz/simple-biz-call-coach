const WebSocket = require('ws');
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }

const WS_URL = 'wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production';
const BACKEND_API_KEY = 'devassist-cce03814ca61352a852641fe9bb4542877975dd1d65d353ba0459add57c15efa';
const MODEL = 'claude-haiku-4-5-20251001';

const CUSTOMER_PROMPT = `You are Hector, a 44-year-old man who owns a taco truck called "Hector's Tacos" in San Antonio, TX. You're ON the taco truck right now during lunch rush.

YOU ARE CHAOTIC AND UNPREDICTABLE. This is NOT a normal sales call. You will:

1. Start by thinking this is a DIFFERENT call — you're expecting a call from your meat supplier about a late delivery. So you answer like "Yeah, is this about the brisket order?"
2. When you realize it's a website sales call, get slightly annoyed — "Oh, I thought you were my supplier"
3. Then your employee drops a tray of tacos in the background — you yell at them mid-conversation: "AY MIJO, PICK THAT UP!" then come back like nothing happened
4. Ask a weird question: "Can people order tacos from the website? Like for pickup?"
5. Then a CUSTOMER at the truck window interrupts — you take their order MID-CALL: "Hold on — yeah three al pastor and a horchata, that'll be fourteen fifty — okay sorry, go ahead"
6. Then randomly ask "Wait are you calling from a scam center? My cousin got scammed last month"
7. Then your truck's generator starts making a loud noise — "HOLD ON THE GENERATOR'S ACTING UP" — go silent for 5 seconds
8. Come back and say something like "Okay where were we. You were saying something about a website?"
9. Eventually get interested when you hear "affordable" because you've been thinking about a website to handle catering orders
10. Agree to the callback but give a WEIRD time — "Have him call me at like 9 PM, that's when I clean up the truck"

PERSONALITY:
- Loud, chaotic, funny, distracted
- Speaks Spanglish sometimes: "no mames", "orale", "mijo"
- Actually a smart business owner underneath the chaos
- You care about your business but you're drowning in the lunch rush right now

RULES: Keep responses 1-4 sentences. Be unpredictable. Output ONLY Hector's words.`;

async function getCustomerResponse(transcript) {
  const convo = transcript.map(t => `${t.speaker === 'agent' ? 'Agent' : 'Hector'}: ${t.text}`).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 80, temperature: 0.8,
      system: [{ type: 'text', text: CUSTOMER_PROMPT }],
      messages: [{ role: 'user', content: `${convo}\n\nHector:` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error('Customer AI: ' + data.error.message);
  return data.content[0].text.trim().replace(/^(Hector:\s*)/i, '');
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?apiKey=${encodeURIComponent(BACKEND_API_KEY)}`);
    ws.on('open', () => { console.log('  [WS] Connected'); resolve(ws); });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 10000);
  });
}

function waitForMessage(ws, type, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${type}`)), timeout);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) { clearTimeout(timer); ws.removeListener('message', handler); resolve(msg); }
      } catch (e) {}
    };
    ws.on('message', handler);
  });
}

async function main() {
  console.log('='.repeat(80));
  console.log('CHAOS SIMULATION — REAL AWS INFRASTRUCTURE');
  console.log("Agent: Caesar | Customer: Hector (Hector's Tacos, San Antonio TX)");
  console.log("Hector is on his taco truck during lunch rush. Total chaos.");
  console.log('='.repeat(80));

  const ws = await connectWebSocket();

  console.log('  [Starting conversation...]');
  ws.send(JSON.stringify({ action: 'startConversation', agentId: 'caesar-chaos', metadata: { timestamp: Date.now(), apiKey: BACKEND_API_KEY } }));
  const startMsg = await waitForMessage(ws, 'CONVERSATION_STARTED');
  const conversationId = startMsg.payload.conversationId;
  console.log(`  [Conversation: ${conversationId}]\n`);

  const transcript = [];
  const MAX_TURNS = 12;

  const opener = "Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute?";
  transcript.push({ speaker: 'agent', text: opener });
  console.log(`  AGENT: "${opener}"`);
  ws.send(JSON.stringify({ action: 'transcript', conversationId, speaker: 'agent', text: opener, isFinal: true, timestamp: Date.now() }));
  await new Promise(r => setTimeout(r, 500));

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const customerResponse = await getCustomerResponse(transcript);
    transcript.push({ speaker: 'caller', text: customerResponse });
    console.log(`\n  HECTOR: "${customerResponse}"`);

    ws.send(JSON.stringify({ action: 'transcript', conversationId, speaker: 'caller', text: customerResponse, isFinal: true, timestamp: Date.now() }));
    await new Promise(r => setTimeout(r, 500));

    const lower = customerResponse.toLowerCase();
    if (lower.includes('bye') || lower.includes('gotta go') || lower.includes('not interested')) {
      console.log('\n  [Call ended]');
      break;
    }

    console.log('  [Requesting AI tip from Lambda...]');
    ws.send(JSON.stringify({ action: 'getIntelligence', conversationId, skipTip: false, timestamp: Date.now() }));

    let aiTip;
    try {
      const msg = await waitForMessage(ws, 'INTELLIGENCE_UPDATE', 20000);
      aiTip = msg.payload?.aiTip;
      if (!aiTip) { console.log('  [No tip — skipping]'); continue; }
    } catch (e) { console.log(`  [Timeout: ${e.message}]`); continue; }

    console.log(`\n  >> AI [${aiTip.heading}] (${aiTip.stage}):`);
    console.log(`     "${aiTip.suggestion.substring(0, 200)}"`);

    let agentLine = aiTip.suggestion.replace(/\[Agent\]/g, 'Caesar').replace(/\[Location\]/g, 'San Antonio').replace(/\[Name\]/g, 'Hector');
    if (agentLine.length > 250) agentLine = agentLine.substring(0, 247) + '...';
    transcript.push({ speaker: 'agent', text: agentLine });
    console.log(`\n  AGENT: "${agentLine}"`);

    ws.send(JSON.stringify({ action: 'transcript', conversationId, speaker: 'agent', text: agentLine, isFinal: true, timestamp: Date.now() }));

    if (aiTip.stage === 'SIGNOFF' || aiTip.suggestion.toLowerCase().includes('have a beautiful day') || aiTip.suggestion.toLowerCase().includes('take care')) {
      console.log('\n  [Agent signed off]');
      break;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  ws.send(JSON.stringify({ action: 'endConversation', conversationId, timestamp: Date.now() }));
  await new Promise(r => setTimeout(r, 1000));
  ws.close();

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FULL TRANSCRIPT (REAL AWS INFRA)');
  console.log('='.repeat(80));
  const startTime = new Date(); startTime.setHours(12, 15, 0, 0);
  transcript.forEach((t, i) => {
    const time = new Date(startTime.getTime() + i * 8000);
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
