const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const MODEL = 'claude-haiku-4-5-20251001';

// Pull production prompt
const SCRIPTS_FILE = require('fs').readFileSync(require('path').join(__dirname, '../../infra/lib/lambda/shared/claude-client-optimized.ts'), 'utf8');
const GOLDEN_SCRIPTS = SCRIPTS_FILE.match(/const MARKS_GOLDEN_SCRIPTS = `([\s\S]*?)`;/)[1];
const SYSTEM_PROMPT = SCRIPTS_FILE.match(/const SYSTEM_PROMPT_COMPRESSED = `([\s\S]*?)`;/)[1];

// ============================================================================
// CUSTOMER: Ray — Carwash owner from Texas, business in Poughkeepsie
// ============================================================================
const CUSTOMER_PROMPT = `You are Ray, a 55-year-old man from Texas who owns "Ray's Shine & Go" car wash in Poughkeepsie, New York. You have a thick Texas drawl and speak casually.

YOUR SITUATION:
- You moved from Dallas to Poughkeepsie 3 years ago to open the car wash
- Business is doing okay but you know you're losing customers to the newer car wash down the road that has a fancy website with online booking
- You do NOT have a website — you've been relying on the big road sign out front and some Yelp reviews
- You had a bad experience with a web guy 2 years ago who took $2,000 and disappeared with a half-finished site
- You're at the car wash right now watching your guys work

YOUR PERSONALITY:
- Friendly but cautious — the burned experience made you skeptical
- You tell stories — when something reminds you of a past experience, you share it
- You use Texas expressions: "well shoot", "tell you what", "I'll be darned", "fixin' to"
- You're genuinely interested but need convincing because of the bad experience
- You eventually warm up if the agent listens to your stories and doesn't just pitch
- You care about: cost (burned before), owning the site (burned before), timeline, and online booking for the car wash

YOUR BEHAVIOR THROUGH THE CALL:
- Start skeptical: "I've been burned before"
- Tell the story about the web guy who took $2K
- Ask about ownership/control (big deal because of past experience)
- Ask about pricing (cautious)
- Ask industry-specific: "Can you do online booking for a car wash?"
- If agent handles objections well, warm up and agree to callback
- Give dry one-word answers at least twice to test engagement
- At some point say "hold on a sec" (distracted by something at the car wash)
- Eventually agree if you feel heard

RULES:
- Respond as Ray. 1-4 sentences. Mix short and long responses.
- Tell at least one story about the bad web guy experience.
- Use Texas expressions naturally.
- Output ONLY Ray's words.`;

// ============================================================================
// API CALLS
// ============================================================================
async function getCoachTip(transcript, stage, count, prevSuggestions) {
  const context = transcript.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n');
  // Take the LAST 1200 chars (most recent messages), not the first
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
    const role = t.speaker === 'agent' ? 'Agent (Caesar)' : 'Ray';
    return `${role}: ${t.text}`;
  }).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 150, temperature: 0.7,
      system: [{ type: 'text', text: CUSTOMER_PROMPT }],
      messages: [{ role: 'user', content: `Conversation so far:\n\n${convo}\n\nRespond as Ray. 1-4 sentences.` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text.trim().replace(/^(Ray:\s*)/i, '');
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

  const directSignals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "that's fine", "that works", "go ahead", "let's do it", "tell you what"];
  const indirectSignals = ["have bob call", "call me back", "they can call", "have them call", "bob can call", "give me a call", "i'll take a call", "he can call"];
  const callbackPatterns = ['call later', 'quick call', 'call you back', 'give you a call', 'bob or his partner'];

  const directlyAgreed = callerMsgs.some(msg => directSignals.some(s => msg.includes(s)));
  const indirectlyAgreed = callerMsgs.some(msg => indirectSignals.some(s => msg.includes(s)));
  const askedCb = agentMsgs.some(msg => callbackPatterns.some(p => msg.includes(p)));

  if ((directlyAgreed && askedCb) || indirectlyAgreed) {
    stage = 'conversion';
    const namePattern = /my name is|it's \w+|i'm \w+|ask for \w+|call me \w+|name's \w+/i;
    const timePattern = /after \d|before \d|around \d|at \d|this afternoon|this evening|tomorrow/i;
    const alreadyToldYou = /already (said|gave|told)|i got it|yeah yeah/i;
    const gaveName = callerMsgs.some(msg => namePattern.test(msg));
    const gaveTime = callerMsgs.some(msg => timePattern.test(msg));
    const frustrated = callerMsgs.some(msg => alreadyToldYou.test(msg));
    if ((gaveName && gaveTime) || frustrated) stage = 'signoff';
  }
  return stage;
}

// ============================================================================
// SIMULATION
// ============================================================================
async function main() {
  console.log('='.repeat(80));
  console.log('CARWASH OWNER SIMULATION');
  console.log("Agent: Caesar (Simple.Biz) | Customer: Ray (Ray's Shine & Go, Poughkeepsie NY)");
  console.log('='.repeat(80));

  const transcript = [];
  const prevSuggestions = [];
  const MAX_TURNS = 14;

  const opener = "Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute?";
  transcript.push({ speaker: 'agent', text: opener });
  console.log(`\n  AGENT: "${opener}"`);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const customerResponse = await getCustomerResponse(transcript);
    transcript.push({ speaker: 'caller', text: customerResponse });
    console.log(`\n  CUSTOMER: "${customerResponse}"`);

    const lower = customerResponse.toLowerCase();
    if (lower.includes('bye') || lower.includes('take care') || lower.includes('talk to you later') || lower.includes('gotta go') || lower.includes('hangs up')) {
      console.log('\n  [Call ended by customer]');
      break;
    }

    const stage = detectStage(transcript);
    const tip = await getCoachTip(transcript, stage, transcript.length, prevSuggestions);
    console.log(`\n  >> AI COACH [${tip.heading}] (${tip.stage}):`);
    console.log(`     "${tip.script.substring(0, 200)}"`);
    prevSuggestions.push(tip.script);

    let agentLine = tip.script
      .replace(/\[Agent\]/g, 'Caesar')
      .replace(/\[Location\]/g, 'Poughkeepsie')
      .replace(/\[Name\]/g, 'Ray');
    if (agentLine.length > 250) agentLine = agentLine.substring(0, 247) + '...';
    transcript.push({ speaker: 'agent', text: agentLine });
    console.log(`\n  AGENT: "${agentLine}"`);

    if (stage === 'signoff' || tip.script.toLowerCase().includes('have a beautiful day') || tip.script.toLowerCase().includes('take care') || tip.script.toLowerCase().includes('super excited for you')) {
      console.log('\n  [Agent signed off — call complete]');
      break;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Full transcript
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FULL TRANSCRIPT');
  console.log('='.repeat(80));
  const startTime = new Date(); startTime.setHours(10, 15, 0, 0);
  transcript.forEach((t, i) => {
    const time = new Date(startTime.getTime() + i * 8000);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = t.speaker === 'agent' ? 'You' : 'Customer';
    console.log(`\n[${timeStr}] ${label}: ${t.text}`);
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Total: ${transcript.length} | Agent: ${transcript.filter(t=>t.speaker==='agent').length} | Customer: ${transcript.filter(t=>t.speaker==='caller').length}`);
  console.log('='.repeat(80));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
