/**
 * End-to-end call simulation: an AI-played LEAD talks to an agent who reads the
 * coach's suggestion VERBATIM every turn.
 *
 * Uses the real production code paths — generateConversationIntelligence and
 * generateAITipStreaming — and mirrors the stage / conversion / signoff logic in
 * lambda/intelligence/index.ts. Intelligence lags one turn, as it does in prod
 * (background cache refresh). Every coach line is checked against the script
 * guidelines (doc/reference/official-call-script.md).
 *
 * Usage (from infra/):
 *   npm run sim -- --live --random            one random lead, streamed line by line
 *   npm run sim -- --live receptionist        one named persona, streamed
 *   npm run sim -- --random 10 --seed 42      10 random leads in parallel (replayable)
 *   npm run sim                               all 8 fixed personas in parallel
 *   npm run sim -- --list                     list fixed personas
 *
 * Flags: --live (stream each line as it happens; runs calls one after another)
 *        --random [N] (N generated personas, default 1)  --seed S (repeat a random run)
 *        --verbose (keep the Lambda code's own console logging)
 *
 * Needs the `simple-biz` AWS profile: the Anthropic key is read from Secrets
 * Manager `call-coach/api-keys`, exactly as the Lambdas do.
 */
import './sim-env';
import Anthropic from '@anthropic-ai/sdk';
import { generateAITipStreaming } from '../lib/lambda/shared/claude-client-optimized';
import { generateConversationIntelligence } from '../lib/lambda/shared/intelligence-client';
import { getSecret } from '../lib/lambda/shared/secrets-client';

const LEAD_MODEL = process.env.LEAD_MODEL || 'claude-sonnet-5-5';
const AGENT_NAME = 'Jen';
const AGENT_PLACE = 'Topeka'; // agent's discretion — the coach must leave [Place] alone
const BOB_NUMBER = '785-555-0142';
const MAX_LEAD_TURNS = 12;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
};
const LIVE = flag('live');
const VERBOSE = flag('verbose');
const RANDOM = flag('random') ? Number(opt('random') ?? 1) : 0;
const SEED = Number(opt('seed') ?? Math.floor(Math.random() * 1e9));
const optValues = new Set([opt('random'), opt('seed')].filter(Boolean));
const named = argv.filter(a => !a.startsWith('--') && !optValues.has(a));

// Our own output goes straight to stdout; console.log is silenced for the Lambda code's noise.
const say = (s: string) => process.stdout.write(s + '\n');
const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2), bold = c(1), red = c(31), green = c(32), yellow = c(33), cyan = c(36), magenta = c(35);

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
const PERSONAS: Record<string, string> = {
  'busy-owner-has-site':
    "You are Mike, owner of Mike's Roofing. You have an old Wix site that gets no calls. You're on a job site and busy. You start short, but if they mention getting you found on Google you warm up and will accept a callback. You are the decision maker.",
  receptionist:
    "You are Dana, the front-desk receptionist at Bright Smile Dental. The owner, Dr. Patel, handles the website. You are polite, won't give out the owner's cell, but you're fine with someone calling back. You are NOT the decision maker.",
  'skeptic-questions':
    "You are Carla, owner of a landscaping company. You're skeptical. You ask how much a website costs, where they're located, and whether they can do online booking. Only if your questions get straight, non-pushy answers do you agree to a callback. You are the decision maker.",
  'firm-no':
    "You are Tom, owner of a small plumbing company. You are not interested, you don't need a website, word of mouth is enough. You say so clearly and want off the phone.",
  'future-date':
    "You are Priya, owner of a bakery. You'd like a better website but you say you won't be ready to do anything until next year. If pressed politely you'll allow a short call today. You are the decision maker.",
  'non-engaging':
    "You are Gary, owner of an auto shop. You give flat, one-word, noncommittal answers ('eh', 'I dunno', 'whatever', 'maybe'). You never clearly say yes or no. If directly asked whether it's to build a new site or update your existing one, you say 'update I guess'.",
  'no-site-wants-email':
    "You are Luis, owner of a new food truck. You don't have a website. You ask them to just email you information. Your email is luis@tacoluis.com. You'd accept a call if they keep it easy. You are the decision maker.",
  confused:
    "You are Ruth, 68, owner of a small antique shop. You don't understand what they're calling about at first and say so. Once it's explained simply you're mildly interested and accept a callback. You are the decision maker.",
};

// Seeded RNG (mulberry32) so `--seed` replays the same leads.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = {
  first: ['Mike', 'Dana', 'Carla', 'Tom', 'Priya', 'Gary', 'Luis', 'Ruth', 'Keisha', 'Brandon', 'Linda', 'Jorge', 'Amy', 'Hank', 'Tasha', 'Dev', 'Marisol', 'Earl', 'Kim', 'Wade'],
  last: ['Miller', 'Nguyen', 'Garcia', 'Patel', 'Johnson', 'Okafor', 'Schmidt', 'Reyes', 'Walsh', 'Kowalski'],
  business: [
    ['roofing company', 'roofing'], ['HVAC company', 'HVAC'], ['dental office', 'dental'], ['bakery', 'bakery'],
    ['auto repair shop', 'auto'], ['landscaping company', 'landscaping'], ['small law office', 'law'], ['hair salon', 'salon'],
    ['plumbing company', 'plumbing'], ['food truck', 'food-truck'], ['chiropractic clinic', 'chiro'], ['pet grooming shop', 'grooming'],
    ['house cleaning service', 'cleaning'], ['tattoo studio', 'tattoo'], ['daycare', 'daycare'], ['electrical contractor', 'electrician'],
    ['clothing boutique', 'boutique'], ['towing company', 'towing'], ['martial arts gym', 'gym'], ['family restaurant', 'restaurant'],
  ] as [string, string][],
  role: [
    ['the owner', true, 'owner'], ['the owner', true, 'owner'], ['the owner', true, 'owner'],
    ['the front-desk receptionist (the owner handles the website)', false, 'receptionist'],
    ['the office manager, who can make website decisions', true, 'manager'],
    ["the owner's spouse, who answers the business line (the owner decides)", false, 'spouse'],
  ] as [string, boolean, string][],
  website: [
    ["The business doesn't have a website at all.", 'no-site'],
    ["The owner's nephew built the website years ago; nobody knows if it works.", 'old-site'],
    ['The owner built a Wix/Squarespace site themselves and it gets almost no traffic.', 'diy-site'],
    ['The business already pays "a guy" or an agency for the website.', 'has-agency'],
    ["You think the business's website is fine.", 'site-fine'],
    ["The business's website has been down for weeks and nobody has dealt with it.", 'site-down'],
  ] as [string, string][],
  temperament: [
    ['friendly and chatty', 'chatty'], ['rushed — you are in the middle of work', 'rushed'], ['skeptical of sales calls', 'skeptic'],
    ['grumpy and short', 'grumpy'], ['elderly and a bit confused by tech terms', 'confused'], ['suspicious this is a scam', 'suspicious'],
    ["noncommittal — you give flat answers like 'eh', 'maybe', 'I dunno'", 'flat'], ['curious and asks lots of questions', 'curious'],
  ] as [string, string][],
  moves: [
    'Ask how much a website costs, and push for a ballpark if they dodge.',
    'Ask where they are located.',
    'Ask if they have built websites for businesses in your industry.',
    'Ask if they have built websites in your city.',
    'Ask whether they can do online booking or online ordering.',
    'Ask how they got your number.',
    'Ask them to just email you the information.',
    'Ask "who is this really?" or "are you a robot?".',
    "Say you won't be ready to do anything until next year.",
    'Say "not right now" without giving a reason.',
    'Say you are busy and ask them to call back later.',
    'Ask how do you get a hold of them.',
    'Ask what ChatGPT has to do with your business.',
  ],
  leaning: [
    ['You are open to it and will accept a callback if they are respectful.', 'yes'],
    ["You are on the fence; you'll only accept a callback if they handle your questions well.", 'fence'],
    ['You are not interested and will decline, but stay polite.', 'no'],
  ] as [string, string][],
};

function randomPersona(r: () => number, n: number): [string, string] {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const name = `${pick(POOL.first)} ${pick(POOL.last)}`;
  const [biz, bizKey] = pick(POOL.business);
  const [role, isDm, roleKey] = pick(POOL.role);
  const [site, siteKey] = pick(POOL.website);
  const [temp, tempKey] = pick(POOL.temperament);
  const [lean, leanKey] = pick(POOL.leaning);
  const moves = [...POOL.moves].sort(() => r() - 0.5).slice(0, Math.floor(r() * 3));
  const brief = [
    `You are ${name}, ${role} at a local ${biz}.`,
    site, `You are ${temp}.`, ...moves, lean,
    isDm ? 'You are the decision maker for the website.' : 'You are NOT the decision maker for the website.',
  ].join(' ');
  return [`rnd${n}-${bizKey}-${roleKey}-${siteKey}-${tempKey}-${leanKey}`, brief];
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
type Turn = { speaker: 'agent' | 'caller'; text: string };

function leadSystem(persona: string) {
  return `You are role-playing a person answering a cold call on the phone. ${persona}
Reply with ONLY what you say out loud, 1-2 short sentences, natural phone speech. No stage directions.
If the call is over for you (you said goodbye, or they signed off), reply with exactly: [HANGUP]`;
}

// Mirrors lambda/intelligence/index.ts stage logic.
function detectStage(transcripts: Turn[], intel: any, highWater: { v?: string }) {
  let turnCount = 0, last = '';
  for (const t of transcripts) if (t.speaker !== last) { turnCount++; last = t.speaker; }
  let stage: string = turnCount < 4 ? 'greeting' : turnCount < 8 ? 'discovery' : turnCount < 14 ? 'objection' : 'closing';
  const recent = transcripts.slice(-10);
  const cust = recent.filter(t => t.speaker === 'caller').map(t => t.text.toLowerCase());
  const objection = ["already have", "i don't know", 'not sure', "i don't need", 'not interested', "i'm good", 'no thanks', 'my developer', "don't think", 'already said', 'already told'];
  const direct = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "i'm good with that", "that's great", "that's fine", 'that works', "i'm down", "i'm interested", 'go ahead', "let's do it", 'fine'];
  const hasDirect = cust.slice(-3).some(m => direct.some(s => m.includes(s)) && !objection.some(p => m.includes(p)));
  const indirect = ['have bob call', 'call me back', 'they can call', 'have them call', 'bob can call', 'give me a call', "i'll take a call", 'take a call from bob', 'he can call', 'bob call me', 'can call me', 'want to call', 'set up a call', 'schedule a call', 'call tomorrow', 'call me tomorrow', 'call me at', 'call me later', "here's my number", 'my number is', 'you can reach me', 'reach me at', 'send me a quick call', 'give you my number', 'give you my email'];
  const hasIndirect = cust.some(m => indirect.some(s => m.includes(s)));
  const askedCb = recent.filter(t => t.speaker === 'agent').some(t => ['call later', 'callback', 'quick call', 'call you back', 'give you a call', 'bob or his partner'].some(p => t.text.toLowerCase().includes(p)));
  const hasName = (intel?.entities?.people?.length ?? 0) > 0;
  const hasPhone = (intel?.entities?.contactInfo?.phoneNumbers?.length ?? 0) > 0;
  const hasEmail = (intel?.entities?.contactInfo?.emails?.length ?? 0) > 0;
  if ((hasDirect && askedCb) || hasIndirect || (hasName && (hasPhone || hasEmail) && askedCb)) {
    stage = 'conversion';
    const gaveName = cust.some(m => /my name is|it's \w+|i'm \w+|ask for \w+|call me \w+/i.test(m));
    const gaveNum = cust.some(m => /\d{5,}/.test(m));
    const gaveTime = cust.some(m => /after \d|before \d|around \d|at \d|at\d|\d+\s*pm|\d+\s*am|this afternoon|this evening|tomorrow|in the morning|tonight/i.test(m));
    const frustrated = cust.some(m => /already (said|gave|told|talked)|i got it|yeah yeah|you have my|we already/i.test(m));
    if ((gaveName && gaveTime) || (gaveName && gaveNum) || frustrated || (hasName && (hasPhone || hasEmail))) stage = 'signoff';
  }
  const rank: Record<string, number> = { greeting: 0, discovery: 1, objection: 2, closing: 3, conversion: 4, signoff: 5 };
  const prev = highWater.v ? rank[highWater.v] : 0;
  if (prev >= rank.conversion && rank[stage] < prev) stage = highWater.v!;
  highWater.v = rank[stage] > prev ? stage : (highWater.v || stage);
  return { stage, hasName, hasPhone, hasEmail, business: (intel?.entities?.businessNames?.length ?? 0) > 0 };
}

function factsFrom(intel: any, facts: Set<string>) {
  if (!intel) return;
  if (intel.entities?.websiteStatus === 'has_website') facts.add('Customer ALREADY HAS a website.');
  else if (intel.entities?.websiteStatus === 'no_website') facts.add('Customer does NOT have a website.');
  if (intel.entities?.businessNames?.length) facts.add(`Business: ${intel.entities.businessNames.join(', ')}`);
  if (intel.intents?.some((i: any) => i.intent === 'not_interested')) facts.add('Customer NOT INTERESTED.');
  if (intel.intents?.some((i: any) => i.intent === 'request_callback')) facts.add('Customer agreed to callback.');
  if (intel.entities?.people?.length) facts.add(`Name collected: ${intel.entities.people.join(', ')}`);
}

// Script-guideline checks on each coach line (before placeholder substitution).
function check(raw: string, transcripts: Turn[]): string[] {
  const f: string[] = [];
  const l = raw.toLowerCase();
  const leadSaidEmail = transcripts.some(t => t.speaker === 'caller' && /e-?mail|send (me|us)/i.test(t.text));
  if (/\$\s*\d|\d+\s*(dollars|bucks|hundred|thousand|k\b)|(few|couple|several) (hundred|thousand)/i.test(raw)) f.push('PRICE: quoted a number');
  if (/best time|what time|what day|when works|when would be|when's good|when is good/i.test(raw)) f.push('TIME: asked for a specific time/day');
  if (/interested\?\s*"?\s*$/i.test(raw.trim())) f.push('INTERESTED: ended with an "interested?" question');
  if (/(what's|what is|confirm|is this|can i get|could i get|give me)[^.?!]*(phone number|your number|best number|direct line)|best way to reach|reach (him|her|them) directly/i.test(raw.replace(/\[Bob'?s[^\]]*\]/gi, ''))) f.push('PHONE: asked/confirmed their number');
  if (/email/i.test(l) && !leadSaidEmail) f.push('EMAIL: suggested email unprompted');
  if (/\[Name\]/.test(raw)) f.push('NAME: left a raw [Name] placeholder');
  if (/48,?000\s+(businesses|clients|customers|websites|companies)/i.test(raw)) f.push('STAT: 48,000 is Page-1 rankings, not businesses/clients');
  if (/caesar/i.test(raw)) f.push('AGENT-NAME: used a hardcoded agent name');
  if (/(yes,? )?we (absolutely |definitely )?(can|do) (set up|build|do|handle|offer)|we absolutely can/i.test(raw)) f.push('CAPABILITY: promised a capability instead of deferring to Bob');
  const agentNamedCity = transcripts.some(t => t.speaker === 'agent' && /topeka|kansas city/i.test(t.text));
  if (/topeka|kansas city/i.test(raw) && !agentNamedCity) f.push('PLACE: coach filled in a city instead of [Place]');
  if (/another time|sometime/i.test(raw) && /(call|reach out)/i.test(raw)) f.push('WHEN: vague "another time" instead of today/next business day');
  if (/\.\.\.\s*(got it|perfect|great)/i.test(raw)) f.push("ONE-TURN: line skips ahead past the customer's answer");
  if (/(call|reach out)/i.test(l) && /\bbob\b/i.test(l) && !/bob or his partner|bob or her partner|him or his partner|either of them|have them/i.test(l)) f.push('BOB: callback offer without "Bob or his partner"');
  return f;
}

async function runPersona(key: string, persona: string, lead: Anthropic) {
  const transcripts: Turn[] = [];
  const facts = new Set<string>();
  const prevSuggestions: string[] = [];
  const hw: { v?: string } = {};
  let intel: any = null;
  const flags: string[] = [];
  const buf: string[] = [];
  // Live: print as it happens. Batch: buffer so parallel calls don't interleave.
  const emit = (line: string) => (LIVE ? say(line) : buf.push(line));

  emit(bold(`\n━━━━━━━━━━ ${key} ━━━━━━━━━━`));
  emit(dim(`persona: ${persona}`));

  const leadSay = async (attempt = 0): Promise<string> => {
    const msgs = transcripts.map(t => ({ role: t.speaker === 'caller' ? 'assistant' as const : 'user' as const, content: t.text }));
    if (msgs.length === 0 || msgs[0].role === 'assistant') msgs.unshift({ role: 'user', content: '(phone rings, you pick up)' });
    const r = await lead.messages.create({ model: LEAD_MODEL, max_tokens: 400, system: leadSystem(persona), messages: msgs });
    const text = r.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
    return text || (attempt < 2 ? leadSay(attempt + 1) : '[HANGUP]');
  };

  let outcome = 'max turns';
  for (let i = 0; i < MAX_LEAD_TURNS; i++) {
    const said = await leadSay();
    if (said.includes('[HANGUP]')) { emit(cyan('LEAD   ') + dim('[hangs up]')); outcome = 'lead hung up'; break; }
    transcripts.push({ speaker: 'caller', text: said });
    emit(cyan('LEAD   ') + said);

    const s = detectStage(transcripts, intel, hw);
    factsFrom(intel, facts);
    const t0 = Date.now();
    const tip = await generateAITipStreaming({
      conversationId: `sim-${key}`,
      callStage: s.stage as any,
      recentTranscript: transcripts.slice(-8).map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n'),
      conversationSummary: intel?.summary,
      transcriptCount: transcripts.length,
      previousSuggestions: prevSuggestions.slice(-10),
      conversationFacts: Array.from(facts),
      collectedInfo: { customerName: s.hasName, businessName: s.business, phoneNumber: s.hasPhone, email: s.hasEmail },
    }, async () => {});
    const raw = tip.suggestion.trim().replace(/^"|"$/g, '');
    prevSuggestions.push(raw);
    for (const f of check(raw, transcripts)) { flags.push(`turn ${i + 1}: ${f}`); emit(red(`   ⚠ ${f}`)); }
    const spoken = raw.replace(/\[Agent\]/g, AGENT_NAME).replace(/\[Place\]/g, AGENT_PLACE).replace(/\[Bob'?s (phone |direct |cell )?(phone )?number\]/gi, BOB_NUMBER);
    transcripts.push({ speaker: 'agent', text: spoken });
    emit(magenta('AGENT  ') + spoken + dim(`   [${s.stage} → ${tip.heading} · ${Date.now() - t0}ms]`));

    // Intelligence refreshes in the background in prod — lands for the NEXT turn.
    // Pass a copy: the intelligence client reverses the array in place.
    intel = await generateConversationIntelligence({ conversationId: `sim-${key}`, transcripts: transcripts.map(t => ({ ...t })) }).catch(() => intel);
  }
  emit(flags.length ? red(`FLAGS (${flags.length}):\n  ${flags.join('\n  ')}`) : green('FLAGS: none'));
  emit(dim(`ended: ${outcome}, ${transcripts.length} lines`));
  if (!LIVE) say(buf.join('\n'));
  return { key, flags };
}

(async () => {
  if (flag('list')) {
    for (const [k, v] of Object.entries(PERSONAS)) say(`${bold(k)}\n  ${dim(v)}`);
    return;
  }

  const runs: [string, string][] = [];
  if (RANDOM) {
    const r = rng(SEED);
    for (let n = 1; n <= RANDOM; n++) runs.push(randomPersona(r, n));
    say(dim(`random personas: ${RANDOM}, seed ${SEED} (repeat with --seed ${SEED})`));
    if (flag('dry')) {
      for (const [k, p] of runs) say(`${bold(k)}\n  ${p}`);
      return;
    }
  }
  for (const k of named) {
    if (!PERSONAS[k]) { console.error(`Unknown persona "${k}". Try --list.`); process.exit(1); }
    runs.push([k, PERSONAS[k]]);
  }
  if (!runs.length) runs.push(...Object.entries(PERSONAS));

  // The Lambda modules log heavily; keep the transcript readable unless --verbose.
  if (!VERBOSE) { console.log = () => {}; console.info = () => {}; console.warn = () => {}; }

  const lead = new Anthropic({ apiKey: await getSecret('ANTHROPIC_API_KEY') });
  const results = [];
  if (LIVE) for (const [k, p] of runs) results.push(await runPersona(k, p, lead));
  else results.push(...(await Promise.all(runs.map(([k, p]) => runPersona(k, p, lead)))));

  say(bold('\n━━━━━━━━━━ SUMMARY ━━━━━━━━━━'));
  for (const r of results) say(`${r.flags.length ? red('FLAGGED') : green('clean  ')}  ${r.key}  (${r.flags.length})`);
})().catch(e => { console.error(e); process.exit(1); });
