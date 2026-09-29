/**
 * End-to-end call simulation: an AI-played LEAD talks to an agent who reads the
 * coach's suggestion VERBATIM every turn.
 *
 * Uses the real production code paths — generateConversationIntelligence and
 * generateAITipStreaming — and mirrors the stage / conversion / signoff logic in
 * lambda/intelligence/index.ts. Intelligence lags one turn, as it does in prod
 * (background cache refresh).
 *
 * Usage (from infra/):
 *   AWS_PROFILE=simple-biz AWS_REGION=us-east-1 API_KEYS_SECRET_ARN=call-coach/api-keys \
 *   CLAUDE_HAIKU_MODEL=claude-haiku-4-5-20251001 npx tsx scripts/simulate-lead-persona.ts [persona-key ...]
 */
import Anthropic from '@anthropic-ai/sdk';
import { generateAITipStreaming } from '../lib/lambda/shared/claude-client-optimized';
import { generateConversationIntelligence } from '../lib/lambda/shared/intelligence-client';
import { getSecret } from '../lib/lambda/shared/secrets-client';

const LEAD_MODEL = process.env.LEAD_MODEL || 'claude-sonnet-5-5';
const AGENT_NAME = 'Jen';
const AGENT_PLACE = 'Topeka'; // agent's discretion — the coach must leave [Place] alone
const BOB_NUMBER = '785-555-0142';
const MAX_LEAD_TURNS = 12;

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
  if (/\$\s*\d|\d+\s*(dollars|bucks|hundred|thousand|k\b)|a few hundred/i.test(raw)) f.push('PRICE: quoted a number');
  if (/best time|what time|what day|when works|when would be|when's good|when is good/i.test(raw)) f.push('TIME: asked for a specific time/day');
  if (/interested\?\s*"?\s*$/i.test(raw.trim())) f.push('INTERESTED: ended with an "interested?" question');
  if (/phone number|your number|best number|direct line|reach (him|her|them) directly|best way to reach/i.test(raw.replace(/\[Bob'?s[^\]]*\]/gi, ''))) f.push('PHONE: asked/confirmed their number');
  if (/email/i.test(l) && !leadSaidEmail) f.push('EMAIL: suggested email unprompted');
  if (/\[Name\]/.test(raw)) f.push('NAME: left a raw [Name] placeholder');
  if (/caesar/i.test(raw)) f.push('AGENT-NAME: used a hardcoded agent name');
  if (/(yes,? )?we (absolutely |definitely )?(can|do) (set up|build|do|handle|offer)|we absolutely can/i.test(raw)) f.push('CAPABILITY: promised a capability instead of deferring to Bob');
  const agentNamedCity = transcripts.some(t => t.speaker === 'agent' && /topeka|kansas city/i.test(t.text));
  if (/topeka|kansas city/i.test(raw) && !agentNamedCity) f.push('PLACE: coach filled in a city instead of [Place]');
  if (/another time|sometime/i.test(raw) && /(call|reach out)/i.test(raw)) f.push('WHEN: vague "another time" instead of today/next business day');
  if (/\.\.\.\s*(got it|perfect|great)/i.test(raw)) f.push('ONE-TURN: line skips ahead past the customer\'s answer');
  if (/(call|reach out)/i.test(l) && /\bbob\b/i.test(l) && !/bob or his partner|bob or her partner|him or his partner|either of them|have them/i.test(l)) f.push('BOB: callback offer without "Bob or his partner"');
  return f;
}

async function runPersona(key: string, lead: Anthropic) {
  const persona = PERSONAS[key];
  const transcripts: Turn[] = [];
  const facts = new Set<string>();
  const prevSuggestions: string[] = [];
  const hw: { v?: string } = {};
  let intel: any = null;
  const flags: string[] = [];
  const out: string[] = [`\n==================== ${key} ====================`];

  const leadSay = async (attempt = 0): Promise<string> => {
    const msgs = transcripts.map(t => ({ role: t.speaker === 'caller' ? 'assistant' as const : 'user' as const, content: t.text }));
    if (msgs.length === 0 || msgs[0].role === 'assistant') msgs.unshift({ role: 'user', content: '(phone rings, you pick up)' });
    const r = await lead.messages.create({ model: LEAD_MODEL, max_tokens: 120, system: leadSystem(persona), messages: msgs });
    const text = r.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
    return text || (attempt < 2 ? leadSay(attempt + 1) : '[HANGUP]');
  };

  for (let i = 0; i < MAX_LEAD_TURNS; i++) {
    const said = await leadSay();
    if (said.includes('[HANGUP]')) { out.push('LEAD: [hangs up]'); break; }
    transcripts.push({ speaker: 'caller', text: said });
    out.push(`LEAD:  ${said}`);

    const s = detectStage(transcripts, intel, hw);
    factsFrom(intel, facts);
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
    for (const f of check(raw, transcripts)) { flags.push(`turn ${i + 1}: ${f}`); out.push(`   ⚠ ${f}`); }
    const spoken = raw.replace(/\[Agent\]/g, AGENT_NAME).replace(/\[Place\]/g, AGENT_PLACE).replace(/\[Bob'?s (phone |direct |cell )?(phone )?number\]/gi, BOB_NUMBER);
    transcripts.push({ speaker: 'agent', text: spoken });
    out.push(`AGENT: ${spoken}   [${s.stage} → ${tip.heading}]`);

    // Intelligence refreshes in the background in prod — lands for the NEXT turn.
    intel = await generateConversationIntelligence({ conversationId: `sim-${key}`, transcripts: transcripts.map(t => ({ ...t })) }).catch(() => intel);
  }
  out.push(`FLAGS: ${flags.length ? '\n  ' + flags.join('\n  ') : 'none'}`);
  console.log(out.join('\n'));
  return { key, flags };
}

(async () => {
  const lead = new Anthropic({ apiKey: await getSecret('ANTHROPIC_API_KEY') });
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PERSONAS);
  const results = await Promise.all(keys.map(k => runPersona(k, lead)));
  console.log('\n==================== SUMMARY ====================');
  for (const r of results) console.log(`${r.flags.length ? 'FLAGGED' : 'clean  '}  ${r.key}  (${r.flags.length})`);
})().catch(e => { console.error(e); process.exit(1); });
