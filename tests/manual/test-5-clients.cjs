const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }
const MODEL = 'claude-haiku-4-5-20251001';

// Pull production prompt
const SCRIPTS_FILE = require('fs').readFileSync(require('path').join(__dirname, '../../infra/lib/lambda/shared/claude-client-optimized.ts'), 'utf8');
const GOLDEN_SCRIPTS = SCRIPTS_FILE.match(/const MARKS_GOLDEN_SCRIPTS = `([\s\S]*?)`;/)[1];
const SYSTEM_PROMPT = SCRIPTS_FILE.match(/const SYSTEM_PROMPT_COMPRESSED = `([\s\S]*?)`;/)[1];

// ============================================================================
// 5 CLIENT PROFILES
// ============================================================================
const CLIENTS = [
  {
    name: 'Client 1: Rosa — Bakery Owner (Miami)',
    prompt: `You are Rosa, a 38-year-old Cuban-American woman who owns "Rosa's Dulce Vida Bakery" in Miami, FL. You've had the bakery for 6 years.

YOUR SITUATION:
- You have an old website your cousin made 4 years ago on Wix. It looks terrible and hasn't been updated since.
- You want online ordering badly — customers keep asking if they can order cakes online for pickup
- You're warm and talkative. You love sharing stories about your bakery and your abuela's recipes.
- You're on a budget but willing to spend if it makes sense
- You're in the bakery right now, it's a busy morning

YOUR BEHAVIOR:
- Start friendly — you're a people person
- Share a story about how a customer complained they couldn't find you online last week
- Ask about online ordering specifically
- Ask about pricing — you're careful with money
- Give a couple dry "mhm" or "okay" responses when thinking
- If the agent is nice and listens, agree to the callback quickly
- You speak with warmth: "honey", "sweetie", "mijo"

OUTPUT ONLY Rosa's spoken words. 1-4 sentences.`
  },
  {
    name: 'Client 2: Derek — Auto Mechanic (Detroit)',
    prompt: `You are Derek, a 47-year-old Black man who owns "D's Auto Repair" in Detroit, MI. Been in business 12 years.

YOUR SITUATION:
- No website at all. You've been surviving on Google Maps listing and word of mouth
- Your daughter keeps telling him he needs a website but he thinks it's a waste of money
- He's skeptical of sales calls — gets them constantly
- He's under a car right now, phone on speaker

YOUR BEHAVIOR:
- Start gruff and short — you're busy and skeptical
- Give one-word answers: "yeah", "nah", "maybe"
- When the agent asks about your business, open up slightly — you're proud of your shop
- Push back hard on pricing: "I ain't paying thousands for some website"
- Ask "how'd you get my number?"
- If the agent handles your pushback well and gives a straight price, soften up
- Eventually agree but make it clear you don't want BS

OUTPUT ONLY Derek's spoken words. 1-3 sentences. Keep it short and real.`
  },
  {
    name: 'Client 3: Priya — Yoga Studio Owner (Austin)',
    prompt: `You are Priya, a 33-year-old Indian-American woman who owns "Lotus Flow Yoga" in Austin, TX. Opened 2 years ago.

YOUR SITUATION:
- You have an Instagram with 3K followers that drives most of your business
- You don't have a website — you've been using Linktree for class signups
- You're interested but worried about managing another platform
- You want class scheduling and maybe online video content eventually
- You're between classes right now, have about 5 minutes

YOUR BEHAVIOR:
- Start interested but cautious — "tell me more"
- Ask specifically about integration with your Instagram
- Say "I just use Instagram, do I really need a website?"
- Ask about class scheduling features
- Mention you're worried about the time commitment of maintaining a site
- If the agent acknowledges your Instagram is working and positions the website as complementary, warm up
- You're articulate and ask good questions

OUTPUT ONLY Priya's spoken words. 1-3 sentences.`
  },
  {
    name: 'Client 4: Tommy — Plumber (Phoenix)',
    prompt: `You are Tommy, a 52-year-old Italian-American plumber who owns "Rossi Plumbing" in Phoenix, AZ. 20 years in business.

YOUR SITUATION:
- Your son built him a basic website 3 years ago but it looks amateur and doesn't rank on Google
- He gets most leads from HomeAdvisor and Angi but hates paying their fees
- He wants to stop depending on lead gen sites and get his own leads
- He's driving his work van between jobs

YOUR BEHAVIOR:
- Start impatient — "make it quick, I'm driving"
- Immediately ask about SEO — he knows the term but doesn't fully understand it
- Tell a story about how HomeAdvisor charges him $50 per lead and half of them are garbage
- Ask if the website can actually beat HomeAdvisor for leads
- Push for pricing right away
- Give a dry "uh huh" at least once
- If the agent connects SEO to getting free leads vs paying HomeAdvisor, get excited
- Agree to callback but want it on his terms — "have him call me tomorrow morning"

OUTPUT ONLY Tommy's spoken words. 1-3 sentences.`
  },
  {
    name: 'Client 5: Keisha — Hair Salon Owner (Atlanta)',
    prompt: `You are Keisha, a 41-year-old Black woman who owns "Crown & Glory Hair Studio" in Atlanta, GA. Been open 5 years.

YOUR SITUATION:
- You have a basic website but it's outdated and doesn't have booking
- You use Square for appointments but customers complain it's clunky
- You want a beautiful website that showcases your stylists' work with a portfolio gallery
- You're very particular about design — your brand matters to you
- You're at the salon between clients

YOUR BEHAVIOR:
- Start professional and direct — you know what you want
- Immediately say "I already have a website but it needs a serious upgrade"
- Ask about portfolio galleries and booking integration
- Ask "do I get to choose how it looks, or do you just give me a template?"
- Be skeptical about "affordable" — you've seen cheap websites and they look cheap
- Push back: "I need it to look high-end, not some cookie-cutter thing"
- If the agent handles the design concern well and mentions Bob can show samples, agree
- You won't tolerate being talked down to

OUTPUT ONLY Keisha's spoken words. 1-3 sentences.`
  }
];

// ============================================================================
// API CALLS
// ============================================================================
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

async function getCustomerResponse(transcript, customerPrompt) {
  const convo = transcript.map(t => {
    const role = t.speaker === 'agent' ? 'Agent (Caesar)' : 'Customer';
    return `${role}: ${t.text}`;
  }).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 150, temperature: 0.7,
      system: [{ type: 'text', text: customerPrompt }],
      messages: [{ role: 'user', content: `Conversation so far:\n\n${convo}\n\nRespond naturally. 1-4 sentences.` }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text.trim().replace(/^(Rosa|Derek|Priya|Tommy|Keisha|Customer):\s*/i, '');
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

  const directSignals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "that's fine", "that works", "go ahead", "let's do it", "tell you what", "i can do that", "that works for me"];
  const indirectSignals = ["have bob call", "call me back", "they can call", "have them call", "bob can call", "give me a call", "i'll take a call", "he can call", "have him call"];
  const callbackPatterns = ['call later', 'quick call', 'call you back', 'give you a call', 'bob or his partner', 'partner bob'];

  const directlyAgreed = callerMsgs.some(msg => directSignals.some(s => msg.includes(s)));
  const indirectlyAgreed = callerMsgs.some(msg => indirectSignals.some(s => msg.includes(s)));
  const askedCb = agentMsgs.some(msg => callbackPatterns.some(p => msg.includes(p)));

  if ((directlyAgreed && askedCb) || indirectlyAgreed) {
    stage = 'conversion';
    const namePattern = /my name is|it's \w+|i'm \w+|name's \w+|this is \w+/i;
    const timePattern = /after \d|before \d|around \d|at \d|this afternoon|this evening|tomorrow|morning/i;
    const alreadyToldYou = /already (said|gave|told)|i got it|yeah yeah/i;
    const gaveName = callerMsgs.some(msg => namePattern.test(msg));
    const gaveTime = callerMsgs.some(msg => timePattern.test(msg));
    const frustrated = callerMsgs.some(msg => alreadyToldYou.test(msg));
    if ((gaveName && gaveTime) || frustrated) stage = 'signoff';
  }
  return stage;
}

// ============================================================================
// RUN ONE CLIENT
// ============================================================================
async function runClient(client) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(client.name);
  console.log('═'.repeat(80));

  const transcript = [];
  const prevSuggestions = [];
  const MAX_TURNS = 10;

  const opener = "Hi, good morning! This is Caesar from Simple.Biz. I'm reaching out about your business website. Do you have a minute?";
  transcript.push({ speaker: 'agent', text: opener });
  console.log(`\n  AGENT: "${opener}"`);

  let result = 'INCOMPLETE';

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const customerResponse = await getCustomerResponse(transcript, client.prompt);
    transcript.push({ speaker: 'caller', text: customerResponse });
    console.log(`\n  CUSTOMER: "${customerResponse}"`);

    const lower = customerResponse.toLowerCase();
    if (lower.includes('bye') || lower.includes('take care') || lower.includes('talk to you later') || lower.includes('gotta go') || lower.includes('hangs up')) {
      result = lower.includes('bye') && !lower.includes('not interested') ? 'ENDED' : 'LOST';
      break;
    }

    const stage = detectStage(transcript);
    const tip = await getCoachTip(transcript, stage, transcript.length, prevSuggestions);
    console.log(`\n  >> AI [${tip.heading}] (${tip.stage}):`);
    console.log(`     "${tip.script.substring(0, 180)}"`);
    prevSuggestions.push(tip.script);

    let agentLine = tip.script.replace(/\[Agent\]/g, 'Caesar').replace(/\[Location\]/g, 'your area').replace(/\[Name\]/g, '');
    if (agentLine.length > 250) agentLine = agentLine.substring(0, 247) + '...';
    transcript.push({ speaker: 'agent', text: agentLine });
    console.log(`\n  AGENT: "${agentLine}"`);

    if (stage === 'signoff' || tip.script.toLowerCase().includes('have a beautiful day') || tip.script.toLowerCase().includes('super excited for you')) {
      result = 'CONVERTED';
      break;
    }
    if (stage === 'conversion') result = 'CONVERTING';

    await new Promise(r => setTimeout(r, 400));
  }

  if (result === 'CONVERTING') result = 'CONVERTED';

  console.log(`\n  [${'─'.repeat(20)} RESULT: ${result} ${'─'.repeat(20)}]`);
  return { name: client.name, result, turns: transcript.length };
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('='.repeat(80));
  console.log('5-CLIENT SIMULATION TEST');
  console.log('='.repeat(80));

  const results = [];
  for (const client of CLIENTS) {
    const r = await runClient(client);
    results.push(r);
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  for (const r of results) {
    const icon = r.result === 'CONVERTED' ? '✓' : r.result === 'LOST' ? '✗' : '?';
    console.log(`  ${icon} ${r.name.padEnd(50)} ${r.result.padEnd(12)} (${r.turns} exchanges)`);
  }
  const converted = results.filter(r => r.result === 'CONVERTED').length;
  console.log(`\n  CONVERTED: ${converted}/${results.length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
