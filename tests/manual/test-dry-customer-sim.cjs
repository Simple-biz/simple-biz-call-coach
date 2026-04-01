const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const MODEL = 'claude-haiku-4-5-20251001';

const SCRIPTS_FILE = require('fs').readFileSync(require('path').join(__dirname, '../../infra/lib/lambda/shared/claude-client-optimized.ts'), 'utf8');
const GOLDEN_SCRIPTS = SCRIPTS_FILE.match(/const MARKS_GOLDEN_SCRIPTS = `([\s\S]*?)`;/)[1];
const SYSTEM_PROMPT = SCRIPTS_FILE.match(/const SYSTEM_PROMPT_COMPRESSED = `([\s\S]*?)`;/)[1];

const CUSTOMER_PROMPT = `You are Steve, a 60-year-old man who owns a small tire shop called "Steve's Tires" in El Paso, Texas. You are the DRIEST, most unresponsive customer possible.

YOUR PERSONALITY:
- You give the shortest possible answers. One word if you can.
- You don't volunteer any information unless directly asked
- You're not rude, just... quiet. You don't talk much.
- You answer questions but never elaborate
- You grunt, say "mhm", "yep", "nah", "okay", "I guess"
- If the agent asks about your business, you give a 3-4 word answer max
- You're mildly interested but won't show it
- You eventually warm up SLIGHTLY if the agent keeps engaging, but you never become talkative
- At some point just say "okay" to the callback — you're tired of talking

EXAMPLES OF YOUR RESPONSES:
- "Yep."
- "Nah."
- "Tire shop."
- "Mhm."
- "I guess."
- "Don't have one."
- "Okay."
- "Maybe."
- "Word of mouth."

RULES:
- 1-5 words MAX per response. Never more.
- No full sentences. No punctuation excitement.
- Output ONLY Steve's spoken words.`;

async function getCoachTip(transcript, stage, count, prevSuggestions) {
  const context = transcript.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n');
  let userPrompt = `Stage: ${stage}\nTranscript Count: ${count}\n\nRecent Conversation:\n${context.length > 1200 ? context.slice(-1200) : context}`;
  if (prevSuggestions.length > 0) {
    const prevList = prevSuggestions.slice(-5).map((s, i) => `${i+1}. "${s.substring(0, 80)}"`).join('\n');
    userPrompt += `\n\n⚠️ ALREADY SUGGESTED (do NOT repeat):\n${prevList}`;
  }
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
  let script = raw.match(/\[SCRIPT\]:\s*(.+?)$/is)?.[1]?.trim() || '?';
  script = script.split(/\n\s*[-—*#]/)[0].trim().split(/\s*---/)[0].trim();
  script = script.split(/\s*(?:Rationale|Reasoning|REASONING|Note):/i)[0].trim();
  script = script.replace(/^["']|["']$/g, '');
  return { heading, stage: stg, script };
}

async function getCustomerResponse(transcript) {
  const convo = transcript.map(t => {
    return `${t.speaker === 'agent' ? 'Agent' : 'Steve'}: ${t.text}`;
  }).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 30, temperature: 0.7,
      system: [{ type: 'text', text: CUSTOMER_PROMPT }],
      messages: [{ role: 'user', content: `${convo}\n\nSteve:` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text.trim().replace(/^(Steve:\s*)/i, '');
}

function detectStage(transcript) {
  const count = transcript.length;
  let stage;
  if (count < 5) stage = 'greeting';
  else if (count < 10) stage = 'discovery';
  else if (count < 20) stage = 'objection';
  else stage = 'closing';

  const recent = transcript.slice(-10);
  const callerMsgs = recent.filter(t => t.speaker === 'caller').map(t => t.text.toLowerCase());
  const agentMsgs = recent.filter(t => t.speaker === 'agent').map(t => t.text.toLowerCase());

  const directSignals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "that's fine", "that works", "go ahead"];
  const indirectSignals = ["have bob call", "call me back", "he can call"];
  const callbackPatterns = ['call later', 'quick call', 'call you back', 'give you a call', 'bob or his partner', 'partner bob'];

  const directlyAgreed = callerMsgs.some(msg => directSignals.some(s => msg.includes(s)));
  const indirectlyAgreed = callerMsgs.some(msg => indirectSignals.some(s => msg.includes(s)));
  const askedCb = agentMsgs.some(msg => callbackPatterns.some(p => msg.includes(p)));

  if ((directlyAgreed && askedCb) || indirectlyAgreed) {
    stage = 'conversion';
    const namePattern = /my name is|it's \w+|i'm \w+|name's \w+/i;
    const timePattern = /after \d|before \d|around \d|at \d|this afternoon|tomorrow|morning/i;
    const alreadyToldYou = /already (said|gave|told)/i;
    const gaveName = callerMsgs.some(msg => namePattern.test(msg));
    const gaveTime = callerMsgs.some(msg => timePattern.test(msg));
    const frustrated = callerMsgs.some(msg => alreadyToldYou.test(msg));
    if ((gaveName && gaveTime) || frustrated) stage = 'signoff';
  }
  return stage;
}

async function main() {
  console.log('='.repeat(80));
  console.log('DRY CUSTOMER SIMULATION');
  console.log("Agent: Caesar (Simple.Biz) | Customer: Steve (Steve's Tires, El Paso TX)");
  console.log("Steve gives 1-5 word answers MAX. The driest customer possible.");
  console.log('='.repeat(80));

  const transcript = [];
  const prevSuggestions = [];
  const MAX_TURNS = 12;

  const opener = "Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute?";
  transcript.push({ speaker: 'agent', text: opener });
  console.log(`\n  AGENT: "${opener}"`);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const customerResponse = await getCustomerResponse(transcript);
    transcript.push({ speaker: 'caller', text: customerResponse });
    console.log(`\n  STEVE: "${customerResponse}"`);

    const lower = customerResponse.toLowerCase();
    if (lower.includes('bye') || lower.includes('gotta go') || lower.includes('not interested')) {
      console.log('\n  [Call ended]');
      break;
    }

    const stage = detectStage(transcript);
    const tip = await getCoachTip(transcript, stage, transcript.length, prevSuggestions);
    console.log(`\n  >> AI [${tip.heading}] (${tip.stage}):`);
    console.log(`     "${tip.script.substring(0, 200)}"`);
    prevSuggestions.push(tip.script);

    let agentLine = tip.script.replace(/\[Agent\]/g, 'Caesar').replace(/\[Location\]/g, 'El Paso').replace(/\[Name\]/g, 'Steve');
    if (agentLine.length > 250) agentLine = agentLine.substring(0, 247) + '...';
    transcript.push({ speaker: 'agent', text: agentLine });
    console.log(`\n  AGENT: "${agentLine}"`);

    if (stage === 'signoff' || tip.script.toLowerCase().includes('have a beautiful day') || tip.script.toLowerCase().includes('take care')) {
      console.log('\n  [Agent signed off]');
      break;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FULL TRANSCRIPT');
  console.log('='.repeat(80));
  const startTime = new Date(); startTime.setHours(10, 0, 0, 0);
  transcript.forEach((t, i) => {
    const time = new Date(startTime.getTime() + i * 6000);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = t.speaker === 'agent' ? 'You' : 'Customer';
    console.log(`\n[${timeStr}] ${label}: ${t.text}`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total: ${transcript.length} | Agent: ${transcript.filter(t=>t.speaker==='agent').length} | Customer: ${transcript.filter(t=>t.speaker==='caller').length}`);
  console.log('='.repeat(80));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
