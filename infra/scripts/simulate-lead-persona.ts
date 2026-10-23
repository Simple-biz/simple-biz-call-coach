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
 *        --judge (a second model grades each call against the official script)
 *        --verbose (keep the Lambda code's own console logging)
 *        --engine standard|realtime|both (default standard: today's coach, unchanged)
 *          realtime = the v3 live coach (gpt-realtime-mini via AI Gateway, scripts/sim-live-coach.ts):
 *          the lead's lines are spoken (tts-1) and streamed in real time; the agent reads the live
 *          coach's final line, after the extension's guards (src/utils/live-line-guard.ts), and the
 *          session gets "The agent just said: ..." as a context note, as on a real call.
 *          both = each persona runs on both engines (same lead model, persona and seed).
 *        --parallel N (calls at once; default all)  --max-spend USD (gateway spend cap, default 5)
 *
 * Every call is saved as it finishes to infra/sim-logs/<run-id>/<persona>.<engine>.json, and
 * summary.json (per-engine metrics) at the end. Compare engines:
 *   npm run sim -- --engine both --judge --seed 42
 *
 * Needs the `simple-biz` AWS profile: the Anthropic key is read from Secrets
 * Manager `call-coach/api-keys`, exactly as the Lambdas do. The realtime engine also needs
 * AI_GATEWAY_API_KEY (environment or the repo-root .env.local).
 */
import './sim-env';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { generateAITipStreaming } from '../lib/lambda/shared/claude-client-optimized';
import { generateConversationIntelligence } from '../lib/lambda/shared/intelligence-client';
import { getSecret } from '../lib/lambda/shared/secrets-client';
import { LiveLineGuard } from '../../src/utils/live-line-guard';
import { LineGate, type GateVerdict } from '../../src/utils/line-gate';
import { LiveSession, LIVE_MODEL, gatewayCredits, gatewayKey, tts } from './sim-live-coach';

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
const JUDGE = flag('judge');
// --agent-voice: time the agent's side like a real call so the extension's line gate (line-gate.ts)
// runs: each shown line is read at 160 words/min with the agent's transcripts arriving 0.2-1.2 s
// late, the lead answers from 0.3 s before the agent finishes to 0.8 s after, and on 40% of long
// lines says "Mhm." mid-read. A real answer the gate drops is a STALL (Kayser's call, 2026-10-23);
// a "mhm" whose reply replaces the line mid-read is a SWAP.
const AGENT_VOICE = flag('agent-voice');
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-sonnet-5-5';
// `--random` takes an optional count; a following word that isn't a number is a persona name, not the count.
const randomArg = opt('random');
const randomCount = randomArg !== undefined && /^\d+$/.test(randomArg) ? randomArg : undefined;
const RANDOM = flag('random') ? Number(randomCount ?? 1) : 0;
const SEED = Number(opt('seed') ?? Math.floor(Math.random() * 1e9));
const ENGINE = opt('engine') ?? 'standard';
if (!['standard', 'realtime', 'both'].includes(ENGINE)) { console.error(`--engine must be standard, realtime or both (got "${ENGINE}")`); process.exit(1); }
const ENGINES: Engine[] = ENGINE === 'both' ? ['standard', 'realtime'] : [ENGINE as Engine];
const PARALLEL = Number(opt('parallel') ?? Infinity);
const MAX_SPEND = Number(opt('max-spend') ?? 5);
const optValues = new Set([randomCount, opt('seed'), opt('engine'), opt('parallel'), opt('max-spend')].filter(Boolean));
const named = argv.filter(a => !a.startsWith('--') && !optValues.has(a));

// Our own output goes straight to stdout; console.log is silenced for the Lambda code's noise.
const say = (s: string) => process.stdout.write(s + '\n');
const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2), bold = c(1), red = c(31), green = c(32), yellow = c(33), cyan = c(36), magenta = c(35);

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
const HELLO_ANSWERS = ['Doing good, thanks.', 'Good, thanks.', 'Fine, thank you.', "I'm good, who's this?", 'Not bad, you?', 'Doing alright, thanks for asking.'];
const PERSONAS: Record<string, string> = {
  // Kayser's test call, 2026-10-23: the hello answered with a quick "thanks" stalled the call. Each
  // variant answers the hello differently; all are interested once they hear the pitch.
  ...Object.fromEntries(HELLO_ANSWERS.map((h, i) => [`hello-${i + 1}`,
    `You are Dana Ruiz, owner of Ruiz Landscaping. Answer the phone with exactly: 'Ruiz Landscaping, this is Dana.' When greeted, answer with exactly: '${h}' and nothing else. After the pitch you are interested: your nephew's old website brings in nothing. Ask one question about what they'd do, then agree to a call 'tomorrow morning before ten'. Give your first name, say you're the owner, and that it's probably an update. Never ask how they got your number or about price.`])),
  // Kayser's test call, 2026-10-23: "Doing good, thanks" to the hello got the decline line.
  'interested-thanks':
    "You are Dana Ruiz, owner of Ruiz Landscaping. Answer the phone with exactly: 'Ruiz Landscaping, this is Dana.' When greeted, answer with exactly: 'Doing good, thanks.' and nothing else. After the pitch you are genuinely interested: your nephew's old website brings in nothing. Ask what they'd do with it, then agree to a call 'tomorrow morning before ten'. Give your first name, say you're the owner, and that it's probably an update. Never ask how they got your number or about price.",
  // Kayser's second test call, 2026-10-23: the one where the coach asked for the callback 4 times.
  'nephew-site':
    "You are Dana, owner of a small business in Kentucky. Your nephew built your website. You ask, in this order and one at a time: whether this is a real person or a robot call, their name and company, what it costs (and push once for a ballpark: 'a few hundred or a few thousand?'), where they are located, and what the catch is with the free-after-90-days thing. You're slammed today. If they keep it short you say 'Maybe', then 'Today won't work. Tomorrow morning before ten is better.' You are the decision maker.",
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
type Engine = 'standard' | 'realtime';
type Verdict = { outcome: string; violations: string[]; notes: string[] };

// Second opinion: a separate model grades the finished call against the official script.
const SCRIPT_DOC = readFileSync(join(__dirname, '../../doc/reference/official-call-script.md'), 'utf8');
async function judge(client: Anthropic, persona: string, transcripts: Turn[]): Promise<Verdict> {
  const call = transcripts.map(t => `${t.speaker === 'agent' ? 'AGENT' : 'LEAD'}: ${t.text}`).join('\n');
  const r = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1500,
    system: `You audit cold calls. The AGENT reads lines suggested by an AI coach; judge the AGENT against this official script and its guidelines:\n\n${SCRIPT_DOC}\n\nThe agent's location (a city name) is the agent's own choice — not a violation. ${BOB_NUMBER} is Bob's real number, filled in by the agent for the script's "Bob's number is ____" — not invented. The company name "Simple.biz" is approved (Kayser, 2026-10-23) — not invented. After a yes, asking for the name, then who decides, then build-or-update is the approved close — not a violation. Pacing like the best agents is approved (Kayser, 2026-10-23): the callback question at most twice a call, so a rebuttal's answer without its closing callback question, an answer to a location, company, robot or what's-the-catch question that stops there, and a second price push answered with a different no-ballpark line are not violations. A lead naming when to call (\"tomorrow before ten\") counts as agreeing. The top bookers' opening is approved (Kayser, 2026-10-23): a hello that waits for the lead's answer, then a shorter pitch (no "I know you're busy", "Real quick", ending "about building or updating your website") — not a violation. Unfilled placeholders like [Name] ARE a violation. Be strict but fair: only flag clear breaks of the script's rules, wrong facts, or lines that clearly hurt the call. Reply with ONLY JSON: {"outcome": "callback booked" | "declined" | "email only" | "no decision", "violations": ["turn N: ..."], "notes": ["minor observations"]}`,
    messages: [{ role: 'user', content: `Lead persona (hidden from the agent): ${persona}\n\nCall:\n${call}` }],
  });
  const text = r.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
  catch { return { outcome: 'judge error', violations: [], notes: [text.slice(0, 200)] }; }
}

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
  if (/(today|later),? or (would )?(tomorrow|another day)|in the next (hour|few hours|\d+ minutes)/i.test(raw)) f.push('TIME: offered a choice of days / a time window');
  if (/(does that work|would that work|sound fair|sound good|sounds good)\??\s*"?\s*$/i.test(raw.trim()) && !transcripts.some(t => t.speaker === 'caller' && /\b(yes|sure|okay|ok|go ahead|sounds good|that's fine|fine)\b/i.test(t.text))) f.push('ENDING: weak close instead of the callback question');
  if (/interested\?\s*"?\s*$/i.test(raw.trim())) f.push('INTERESTED: ended with an "interested?" question');
  if (/(what's|what is|confirm|is this|can i get|could i get|give me)[^.?!]*(phone number|your number|best number|direct line)|best way to reach|reach (him|her|them) directly/i.test(raw.replace(/\[Bob'?s[^\]]*\]/gi, ''))) f.push('PHONE: asked/confirmed their number');
  if (/email/i.test(l) && !leadSaidEmail) f.push('EMAIL: suggested email unprompted');
  if (/\[Name\]/.test(raw)) f.push('NAME: left a raw [Name] placeholder');
  if (/48,?000\s+(businesses|clients|customers|websites|companies)/i.test(raw)) f.push('STAT: 48,000 is Page-1 rankings, not businesses/clients');
  if (/(got|found|pulled|grabbed) (your|the) (number|info)|business (listings|directory|research)|off (of )?google|company name|formal company/i.test(raw)) f.push('INVENTED: number source / company claim not in the script');
  if (/caesar/i.test(raw)) f.push('AGENT-NAME: used a hardcoded agent name');
  if (/(yes,? )?we (absolutely |definitely )?(can|do) (set up|build|do|handle|offer)|we absolutely can/i.test(raw)) f.push('CAPABILITY: promised a capability instead of deferring to Bob');
  const agentNamedCity = transcripts.some(t => t.speaker === 'agent' && /topeka|kansas city/i.test(t.text));
  if (/topeka|kansas city/i.test(raw) && !agentNamedCity) f.push('PLACE: coach filled in a city instead of [Place]');
  if (/another time|sometime/i.test(raw) && /(call|reach out)/i.test(raw)) f.push('WHEN: vague "another time" instead of today/next business day');
  if (/\.\.\.\s*(got it|perfect|great)/i.test(raw)) f.push("ONE-TURN: line skips ahead past the customer's answer");
  // Once "Bob or his partner" has been said, plain "Bob" is fine: the month's top bookers said the
  // full phrase 0.66 times a call (2026-10-23), and the coach caps it at two.
  const saidBobOrPartner = transcripts.some(t => t.speaker === 'agent' && /bob or his partner/i.test(t.text));
  if (/(call|reach out)/i.test(l) && /\bbob\b/i.test(l) && !saidBobOrPartner && !/bob or his partner|bob or her partner|him or his partner|either of them|have them/i.test(l)) f.push('BOB: callback offer without "Bob or his partner"');
  return f;
}

type LeadMsg = { role: 'user' | 'assistant'; content: string };
async function leadSay(lead: Anthropic, persona: string, history: LeadMsg[], attempt = 0): Promise<string> {
  const msgs = [...history];
  if (msgs.length === 0 || msgs[0].role === 'assistant') msgs.unshift({ role: 'user', content: '(phone rings, you pick up)' });
  const r = await lead.messages.create({ model: LEAD_MODEL, max_tokens: 400, system: leadSystem(persona), messages: msgs });
  const text = r.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
  // Mass test 2026-10-23: the lead model twice returned tool-call debris ("reasoning_effort: 10
  // <invoke name=...>") instead of a line, and the coach answered the junk. Such a reply is retried.
  const junk = /<\/?invoke\b|reasoning_effort|<\/?parameter\b/i.test(text);
  if (text && !junk) return text;
  return attempt < 2 ? leadSay(lead, persona, history, attempt + 1) : '[HANGUP]';
}

const fillPlaceholders = (raw: string) =>
  raw.replace(/\[Agent\]/g, AGENT_NAME).replace(/\[Place\]/g, AGENT_PLACE).replace(/\[Bob['’]?s (phone |direct |cell )?(phone )?number\]/gi, BOB_NUMBER);

type TurnLog = {
  turn: number; lead: string;
  coachRaw?: string; // what the coach produced
  coachShown?: string; // after the code guards (standard: inside the backend; realtime: live-line-guard)
  spoken?: string; // what the agent read (placeholders filled)
  flags: string[]; rawFlags?: string[];
  delayMs?: number; // standard: tip latency; realtime: lead stopped -> first text
  stage?: string; heading?: string; fallback?: boolean; noReply?: boolean;
};
type CallResult = {
  runId: string; key: string; engine: Engine; persona: string; seed: number;
  leadModel: string; coachModel: string; startedAt: string; wallSeconds: number;
  outcome: string; transcripts: Turn[]; turns: TurnLog[]; flags: string[]; rawFlags: string[];
  verdict?: Verdict; noReply: number; premature: string[]; late: string[]; fallbacks: number;
  costUsd: number; costNote: string; ttsCostUsd?: number; leadHeard?: string[]; errors: string[];
  gateDropsOk?: number; gateOverlaps?: number;
};

const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, '-')}-${ENGINE}-seed${SEED}`;
const OUT_DIR = resolve(__dirname, '..', 'sim-logs', RUN_ID);
const save = (r: CallResult) => writeFileSync(join(OUT_DIR, `${r.key}.${r.engine}.json`), JSON.stringify(r, null, 2));

// Haiku 4.5 list price per token (cache writes are not reported by the tip client, so not counted).
const HAIKU = { input: 1 / 1e6, cachedRead: 0.1 / 1e6, output: 5 / 1e6 };

function newResult(key: string, persona: string, engine: Engine): CallResult {
  return {
    runId: RUN_ID, key, engine, persona, seed: SEED, leadModel: LEAD_MODEL,
    coachModel: engine === 'realtime' ? LIVE_MODEL : process.env.CLAUDE_HAIKU_MODEL || 'haiku',
    startedAt: new Date().toISOString(), wallSeconds: 0, outcome: 'max turns', transcripts: [], turns: [],
    flags: [], rawFlags: [], noReply: 0, premature: [], late: [], fallbacks: 0, costUsd: 0,
    costNote: engine === 'realtime' ? 'live coach response usage (realtime-pricing.ts); TTS is simulation overhead, shown apart'
      : 'tip tokens only (Haiku list price; cache writes and the intelligence call are not metered)',
    errors: [],
  };
}

async function finish(r: CallResult, lead: Anthropic, emit: (s: string) => void, t0: number) {
  r.wallSeconds = (Date.now() - t0) / 1000;
  emit(r.flags.length ? red(`FLAGS (${r.flags.length}):\n  ${r.flags.join('\n  ')}`) : green('FLAGS: none'));
  if (r.engine === 'realtime') {
    if (r.rawFlags.length > r.flags.length) emit(yellow(`  (before the extension's guards: ${r.rawFlags.length} flag(s))`));
    if (r.premature.length) emit(yellow(`  premature lines (not used): ${r.premature.length}`));
    if (r.noReply) emit(yellow(`  no-reply turns: ${r.noReply}`));
  }
  if (r.errors.length) emit(red(`ERRORS: ${r.errors.join(' | ')}`));
  emit(dim(`ended: ${r.outcome}, ${r.transcripts.length} lines, $${r.costUsd.toFixed(4)}, ${r.wallSeconds.toFixed(0)}s`));
  save(r); // saved before judging, so a killed run keeps the call
  if (JUDGE && r.transcripts.length) {
    r.verdict = await judge(lead, r.persona, r.transcripts).catch(e => ({ outcome: 'judge error', violations: [], notes: [String(e?.message || e)] }));
    emit((r.verdict.violations.length ? red : green)(`JUDGE: ${r.verdict.outcome} · ${r.verdict.violations.length} violation(s)`));
    for (const x of r.verdict.violations) emit(red(`  ✗ ${x}`));
    for (const x of r.verdict.notes) emit(yellow(`  · ${x}`));
    save(r);
  }
}

function makeEmitter(key: string, engine: Engine, persona: string) {
  const buf: string[] = [];
  // Live: print as it happens. Batch: buffer so parallel calls don't interleave.
  const emit = (line: string) => (LIVE ? say(line) : buf.push(line));
  emit(bold(`\n━━━━━━━━━━ ${key} · ${engine} ━━━━━━━━━━`));
  emit(dim(`persona: ${persona}`));
  return { emit, flush: () => { if (!LIVE) say(buf.join('\n')); } };
}

// ── standard: today's coach (generateAITipStreaming + background intelligence) ──
async function runStandard(key: string, persona: string, lead: Anthropic): Promise<CallResult> {
  const r = newResult(key, persona, 'standard');
  const t0 = Date.now();
  const { emit, flush } = makeEmitter(key, 'standard', persona);
  const transcripts = r.transcripts;
  const facts = new Set<string>();
  const prevSuggestions: string[] = [];
  const hw: { v?: string } = {};
  let intel: any = null;

  try {
    for (let i = 0; i < MAX_LEAD_TURNS; i++) {
      const said = await leadSay(lead, persona, transcripts.map(t => ({ role: t.speaker === 'caller' ? 'assistant' as const : 'user' as const, content: t.text })));
      if (said.includes('[HANGUP]')) { emit(cyan('LEAD   ') + dim('[hangs up]')); r.outcome = 'lead hung up'; break; }
      transcripts.push({ speaker: 'caller', text: said });
      emit(cyan('LEAD   ') + said);

      const s = detectStage(transcripts, intel, hw);
      factsFrom(intel, facts);
      const tStart = Date.now();
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
      const ms = Date.now() - tStart;
      const raw = tip.suggestion.trim().replace(/^"|"$/g, '');
      prevSuggestions.push(raw);
      const tm = tip.tokenMetrics;
      r.costUsd += tm.input * HAIKU.input + tm.cached * HAIKU.cachedRead + tm.output * HAIKU.output;
      const log: TurnLog = { turn: i + 1, lead: said, coachRaw: raw, coachShown: raw, flags: [], delayMs: ms, stage: s.stage, heading: tip.heading };
      // Canned fallbacks (getFallbackSuggestion) and the OpenAI fallback report no output tokens;
      // a real Claude answer always does. Matching on text would misfire: a canned line is also a valid Ask Callback.
      if (tm.output === 0) { log.fallback = true; r.fallbacks++; r.flags.push(`turn ${i + 1}: FALLBACK: tip timed out or failed, canned line shown (${ms}ms)`); emit(red('   ⚠ FALLBACK: canned line (timeout/failure)')); }
      for (const f of check(raw, transcripts)) { log.flags.push(f); r.flags.push(`turn ${i + 1}: ${f}`); r.rawFlags.push(`turn ${i + 1}: ${f}`); emit(red(`   ⚠ ${f}`)); }
      const spoken = fillPlaceholders(raw);
      log.spoken = spoken;
      r.turns.push(log);
      transcripts.push({ speaker: 'agent', text: spoken });
      emit(magenta('AGENT  ') + spoken + dim(`   [${s.stage} → ${tip.heading} · ${ms}ms]`));

      // Intelligence refreshes in the background in prod — lands for the NEXT turn.
      // Pass a copy: the intelligence client reverses the array in place.
      intel = await generateConversationIntelligence({ conversationId: `sim-${key}`, transcripts: transcripts.map(t => ({ ...t })) }).catch(() => intel);
    }
  } catch (e: any) {
    r.errors.push(String(e?.message || e)); r.outcome = 'error';
  }
  await finish(r, lead, emit, t0);
  flush();
  return r;
}

// ── realtime: the v3 live coach, fed the lead's speech in real time ──
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** --agent-voice: the agent reads a line aloud; their transcripts reach the gate late. Returns when they finish. */
function agentReads(gate: LineGate, line: string): number {
  const readMs = (line.split(/\s+/).length / 160) * 60_000;
  const lagMs = 200 + Math.random() * 1000;
  for (let at = lagMs; at <= readMs + lagMs; at += 250) setTimeout(() => gate.agentSpoke(), at);
  return Date.now() + readMs;
}
/** What the extension finally does with a reply: realtime-auto.ts holds it while the gate says hold. */
async function settle(gate: LineGate): Promise<Exclude<GateVerdict, 'hold'>> {
  for (let i = 0; i < 400; i++) {
    const v = gate.verdict();
    if (v !== 'hold') return v;
    await sleep(50);
  }
  return 'show';
}
async function runRealtime(key: string, persona: string, lead: Anthropic, spendStart: number | null): Promise<CallResult> {
  const r = newResult(key, persona, 'realtime');
  r.ttsCostUsd = 0;
  const t0 = Date.now();
  const { emit, flush } = makeEmitter(key, 'realtime', persona);
  const transcripts = r.transcripts;
  const leadView: LeadMsg[] = [];
  let session: LiveSession | null = null;
  // One per call, as realtime-auto.ts keeps one per session.
  const lineGuard = new LiveLineGuard();

  try {
    if (spendStart !== null) {
      const now = await gatewayCredits();
      if (now && now.totalUsed - spendStart > MAX_SPEND) throw new Error(`spend cap: gateway total_used up $${(now.totalUsed - spendStart).toFixed(2)} (> $${MAX_SPEND}) — call skipped`);
    }
    session = await LiveSession.open();
    const gate = new LineGate();
    let readEndAt = 0; // when the agent finishes reading the line on screen (--agent-voice)
    let mhm: Buffer | null = null;
    for (let i = 0; i < MAX_LEAD_TURNS; i++) {
      const saying = leadSay(lead, persona, leadView);
      if (AGENT_VOICE && readEndAt) {
        // The agent is reading the last line; maybe a "mhm" lands in the middle of it.
        const remaining = readEndAt - Date.now();
        if (remaining > 4500 && Math.random() < 0.4) {
          await sleep(1500 + Math.random() * (remaining - 4500));
          if (!mhm) { const v = await tts('Mhm.'); mhm = v.pcm; r.ttsCostUsd! += v.costUsd; }
          gate.leadStarted();
          await session.speak(mhm);
          gate.leadStopped();
          const bc = await session.awaitReply(8000);
          if (bc) {
            // As realtime-auto: held while the agent talks, and discarded once the lead starts
            // their real answer (due around the end of the agent's line).
            let v: GateVerdict = gate.verdict();
            while (v === 'hold' && Date.now() < readEndAt - 300) { await sleep(50); v = gate.verdict(); }
            if (v === 'hold') v = 'drop';
            if (v === 'drop') { r.gateDropsOk = (r.gateDropsOk ?? 0) + 1; emit(dim(`   · "Mhm." mid-read: reply dropped, line kept ("${bc.text.slice(0, 50)}")`)); }
            else { r.flags.push(`turn ${i}: SWAP: a "mhm" mid-read replaced the line`); emit(red(`   ⚠ SWAP: "Mhm." mid-read replaced the line with "${bc.text.slice(0, 60)}"`)); }
          }
        }
      }
      const said = await saying;
      if (said.includes('[HANGUP]')) { emit(cyan('LEAD   ') + dim('[hangs up]')); r.outcome = 'lead hung up'; break; }
      transcripts.push({ speaker: 'caller', text: said });
      leadView.push({ role: 'assistant', content: said });
      emit(cyan('LEAD   ') + said);

      const voice = await tts(said);
      r.ttsCostUsd += voice.costUsd;
      if (AGENT_VOICE && readEndAt) {
        // Answer around the end of the agent's line, sometimes clipping the last word.
        const startAt = readEndAt + (-300 + Math.random() * 1100);
        if (startAt > Date.now()) await sleep(startAt - Date.now());
        if (startAt < readEndAt) r.gateOverlaps = (r.gateOverlaps ?? 0) + 1;
      }
      gate.leadStarted();
      await session.speak(voice.pcm);
      gate.leadStopped();
      let reply = await session.awaitReply();
      if (reply && AGENT_VOICE) {
        const v = await settle(gate);
        if (v === 'drop') {
          r.flags.push(`turn ${i + 1}: STALL: the gate dropped the reply to a real answer`);
          emit(red(`   ⚠ STALL: gate dropped the reply to "${said.slice(0, 50)}" ("${reply.text.slice(0, 50)}")`));
          reply = null;
        }
      }
      if (session.isClosed) throw new Error(`live session closed: ${session.errors.join(' | ') || 'no reason'}`);
      const log: TurnLog = { turn: i + 1, lead: said, flags: [] };
      if (!reply) {
        r.noReply++; log.noReply = true; r.turns.push(log);
        emit(magenta('AGENT  ') + red('(no line from the live coach in 15 s)'));
        leadView.push({ role: 'user', content: '(Silence on the line. The person who called you says nothing.)' });
        continue;
      }
      const raw = reply.text.trim().replace(/^"|"$/g, '');
      // What the extension shows: the same guards realtime-auto.ts runs on every final live line.
      const shown = lineGuard.apply(raw, true) ?? raw;
      log.coachRaw = raw; log.coachShown = shown; log.delayMs = reply.delayMs;
      for (const f of check(shown, transcripts)) { log.flags.push(f); r.flags.push(`turn ${i + 1}: ${f}`); emit(red(`   ⚠ ${f}`)); }
      if (shown !== raw) {
        log.rawFlags = check(raw, transcripts);
        emit(yellow(`   ↺ guard rewrote: ${raw}`));
      } else log.rawFlags = log.flags;
      for (const f of log.rawFlags) r.rawFlags.push(`turn ${i + 1}: ${f}`);
      const spoken = fillPlaceholders(shown);
      log.spoken = spoken;
      r.turns.push(log);
      transcripts.push({ speaker: 'agent', text: spoken });
      leadView.push({ role: 'user', content: spoken });
      session.noteAgent(spoken);
      emit(magenta('AGENT  ') + spoken + dim(`   [live · ${reply.delayMs}ms]`));
      if (AGENT_VOICE) readEndAt = agentReads(gate, spoken);
    }
  } catch (e: any) {
    r.errors.push(String(e?.message || e)); if (r.outcome === 'max turns') r.outcome = 'error';
  } finally {
    if (session) {
      await session.close();
      r.costUsd = session.costUsd;
      r.premature = session.premature;
      r.late = session.late;
      r.leadHeard = session.leadHeard;
      r.errors.push(...session.errors.filter(e => !r.errors.some(x => x.includes(e))));
    }
  }
  await finish(r, lead, emit, t0);
  flush();
  return r;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const normWords = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
function jaccard(a: string, b: string) { const A = normWords(a), B = normWords(b); let i = 0; for (const w of A) if (B.has(w)) i++; return A.size && B.size ? i / (A.size + B.size - i) : 0; }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const rule = (flag: string) => flag.replace(/^turn \d+: /, '').replace(/ \(\d+ms\)$/, '');
const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const TALK_WPM = 150; // estimated talk time: every word in the call at 150 words/min

function callMetrics(r: CallResult) {
  const lines = r.turns.filter(t => t.spoken).map(t => t.spoken!);
  let repeats = 0;
  lines.forEach((a, i) => { if (lines.slice(0, i).some(b => jaccard(a, b) >= 0.75)) repeats++; });
  const wc = lines.map(words);
  const talkMin = r.transcripts.reduce((n, t) => n + words(t.text), 0) / TALK_WPM;
  return {
    key: r.key, engine: r.engine, outcome: r.outcome, lines: lines.length, words: wc, repeats,
    over25: wc.filter(n => n > 25).length, delays: r.turns.filter(t => t.delayMs !== undefined).map(t => t.delayMs!),
    flags: r.flags.map(rule), rawFlags: r.rawFlags.map(rule), guardRewrites: r.turns.filter(t => t.coachRaw && t.coachRaw !== t.coachShown).length,
    judge: r.verdict, noReply: r.noReply, premature: r.premature.length, late: r.late.length, fallbacks: r.fallbacks,
    costUsd: r.costUsd, ttsCostUsd: r.ttsCostUsd, talkMin, wallMin: r.wallSeconds / 60, errors: r.errors,
  };
}

function engineSummary(engine: Engine, results: CallResult[]) {
  const ms = results.filter(r => r.engine === engine).map(callMetrics);
  const allWords = ms.flatMap(m => m.words);
  const cost = ms.reduce((n, m) => n + m.costUsd, 0);
  const talk = ms.reduce((n, m) => n + m.talkMin, 0);
  const wall = ms.reduce((n, m) => n + m.wallMin, 0);
  const judged = ms.filter(m => m.judge && m.judge.outcome !== 'judge error');
  const delays = ms.flatMap(m => m.delays);
  return {
    engine, calls: ms.length, callsWithErrors: ms.filter(m => m.errors.length).length, lines: allWords.length,
    scriptViolations: { total: ms.reduce((n, m) => n + m.flags.length, 0), byRule: countBy(ms.flatMap(m => m.flags)) },
    ...(engine === 'realtime' ? {
      scriptViolationsBeforeGuards: { total: ms.reduce((n, m) => n + m.rawFlags.length, 0), byRule: countBy(ms.flatMap(m => m.rawFlags)) },
      guardRewrites: ms.reduce((n, m) => n + m.guardRewrites, 0),
    } : { fallbacks: ms.reduce((n, m) => n + m.fallbacks, 0) }),
    judge: JUDGE ? {
      pass: judged.filter(m => !m.judge!.violations.length).length, fail: judged.filter(m => m.judge!.violations.length).length,
      violations: judged.reduce((n, m) => n + m.judge!.violations.length, 0), outcomes: countBy(judged.map(m => m.judge!.outcome)),
    } : null,
    avgWordsPerLine: allWords.length ? +(allWords.reduce((a, b) => a + b, 0) / allWords.length).toFixed(1) : 0,
    linesOver25Words: ms.reduce((n, m) => n + m.over25, 0),
    repeats: ms.reduce((n, m) => n + m.repeats, 0),
    medianReplyDelayMs: median(delays),
    replyDelayMeaning: engine === 'realtime' ? 'lead stopped speaking -> first text of the line' : 'tip request -> full tip (Haiku latency; no audio)',
    prematureLines: ms.reduce((n, m) => n + m.premature, 0),
    lateLines: ms.reduce((n, m) => n + m.late, 0),
    noReplyTurns: ms.reduce((n, m) => n + m.noReply, 0),
    costUsd: +cost.toFixed(4),
    costNote: results.find(r => r.engine === engine)?.costNote,
    estTalkMinutes: +talk.toFixed(2),
    costPerTalkMinute: talk ? +(cost / talk).toFixed(4) : null,
    ...(engine === 'realtime' ? {
      sessionMinutes: +wall.toFixed(2), costPerSessionMinute: wall ? +(cost / wall).toFixed(4) : null,
      ttsCostUsd: +ms.reduce((n, m) => n + (m.ttsCostUsd || 0), 0).toFixed(4),
    } : {}),
    perCall: ms.map(m => ({
      key: m.key, outcome: m.outcome, lines: m.lines, flags: m.flags.length, judge: m.judge ? `${m.judge.outcome}, ${m.judge.violations.length} violation(s)` : null,
      repeats: m.repeats, over25: m.over25, medianDelayMs: median(m.delays), premature: m.premature, noReply: m.noReply, costUsd: +m.costUsd.toFixed(4), errors: m.errors,
    })),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
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

  const realtime = ENGINES.includes('realtime');
  if (realtime) gatewayKey(); // fail fast without the key
  const creditsBefore = realtime ? await gatewayCredits() : null;
  mkdirSync(OUT_DIR, { recursive: true });
  say(dim(`engine: ${ENGINE} · run: ${RUN_ID}\nout: ${OUT_DIR}${creditsBefore ? `\ngateway total_used before: $${creditsBefore.totalUsed.toFixed(4)}` : ''}`));

  // The Lambda modules log heavily; keep the transcript readable unless --verbose.
  if (!VERBOSE) { console.log = () => {}; console.info = () => {}; console.warn = () => {}; }

  const lead = new Anthropic({ apiKey: await getSecret('ANTHROPIC_API_KEY') });
  // Persona-major, so with --parallel both engines of a persona run side by side.
  const jobs = runs.flatMap(([k, p]) => ENGINES.map(e => [k, p, e] as const));
  const runOne = ([k, p, e]: readonly [string, string, Engine]) =>
    e === 'realtime' ? runRealtime(k, p, lead, creditsBefore?.totalUsed ?? null) : runStandard(k, p, lead);
  const results: CallResult[] = LIVE
    ? await pool(jobs, 1, runOne)
    : await pool(jobs, PARALLEL, runOne);

  const creditsAfter = realtime ? await gatewayCredits() : null;
  const summary = {
    runId: RUN_ID, engine: ENGINE, seed: SEED, judge: JUDGE, leadModel: LEAD_MODEL, judgeModel: JUDGE ? JUDGE_MODEL : null,
    personas: runs.map(([k]) => k),
    gatewayCredits: realtime ? {
      totalUsedBefore: creditsBefore?.totalUsed ?? null, totalUsedAfter: creditsAfter?.totalUsed ?? null,
      delta: creditsBefore && creditsAfter ? +(creditsAfter.totalUsed - creditsBefore.totalUsed).toFixed(4) : null,
      note: 'team-wide total_used; other usage in the same window is included',
    } : null,
    engines: ENGINES.map(e => engineSummary(e, results)),
  };
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  say(bold('\n━━━━━━━━━━ SUMMARY ━━━━━━━━━━'));
  for (const r of results) {
    const j = r.verdict ? `  judge: ${r.verdict.outcome}, ${r.verdict.violations.length} violation(s)` : '';
    say(`${r.flags.length || r.verdict?.violations.length ? red('FLAGGED') : green('clean  ')}  ${r.key} · ${r.engine}  (${r.flags.length})${j}${r.errors.length ? red(`  errors: ${r.errors.length}`) : ''}`);
  }
  for (const s of summary.engines) {
    say(bold(`\n${s.engine}`) + `: ${s.lines} lines, ${s.scriptViolations.total} script flag(s), ${s.avgWordsPerLine} words/line, ${s.linesOver25Words} > 25 words, ${s.repeats} repeats, median delay ${s.medianReplyDelayMs ?? '-'}ms, premature ${s.prematureLines}, no-reply ${s.noReplyTurns}, $${s.costUsd} ($${s.costPerTalkMinute ?? '-'}/talk-min)`);
    if (s.judge) say(`  judge: ${s.judge.pass} pass / ${s.judge.fail} fail, ${s.judge.violations} violation(s)`);
  }
  if (AGENT_VOICE) {
    const count = (re: RegExp) => results.reduce((n, r) => n + r.flags.filter((f) => re.test(f)).length, 0);
    const stalls = count(/STALL:/), swaps = count(/SWAP:/);
    const ok = results.reduce((n, r) => n + (r.gateDropsOk ?? 0), 0);
    const overlaps = results.reduce((n, r) => n + (r.gateOverlaps ?? 0), 0);
    say(bold('\nline gate (--agent-voice)') + `: ${stalls ? red(`${stalls} STALL(S)`) : green('0 stalls')} (real answers dropped), ${swaps ? red(`${swaps} SWAP(S)`) : green('0 swaps')} (mid-read "mhm" replaced the line), ${ok} mid-read "mhm" correctly ignored, ${overlaps} answers that clipped the agent's last words`);
  }
  if (summary.gatewayCredits) say(dim(`\ngateway total_used: $${summary.gatewayCredits.totalUsedBefore} -> $${summary.gatewayCredits.totalUsedAfter} (Δ $${summary.gatewayCredits.delta})`));
  say(dim(`saved: ${OUT_DIR}`));
})().catch(e => { console.error(e); process.exit(1); });
