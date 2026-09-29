// v4 — Haiku-only model, Bob Transition script
import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from './secrets-client';
import {
  shouldFallback,
  withTimeout,
  logFallback,
  FORCE_OPENAI_FALLBACK,
  FAIL_ANTHROPIC_CALLS,
  ANTHROPIC_TIMEOUT_MS,
} from './fallback-utils';
import { generateAITipStreamingOpenAI } from './openai-client';

// Lazy-initialized Anthropic client (async due to Secrets Manager fetch)
let anthropicClient: Anthropic | null = null;

async function getAnthropicClient(): Promise<Anthropic> {
  if (!anthropicClient) {
    const apiKey = await getSecret('ANTHROPIC_API_KEY');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20250929';
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || 'claude-sonnet-4-5-20250929';  // Correct: 20250929 not 20251001

// Performance targets
const MAX_LATENCY_MS = 2000; // CEO requirement: <3s total, budget 2s for Claude
const CACHE_HIT_TARGET = 0.90; // 90% cache hit rate

export interface AITipRequest {
  conversationId: string;
  callStage: 'greeting' | 'discovery' | 'objection' | 'closing' | 'conversion';
  recentTranscript: string;
  conversationSummary?: string;
  transcriptCount?: number;
  previousSuggestions?: string[];
  conversationFacts?: string[];
  collectedInfo?: {
    customerName: boolean;
    businessName: boolean;
    phoneNumber: boolean;
    email: boolean;
  };
}

export interface AITipResponse {
  suggestion: string; // SINGLE best script from golden library
  heading: string; // Max 20 chars for UI display
  stage: string; // GREETING, DISCOVERY, VALUE_PROP, OBJECTION_HANDLING, NEXT_STEPS
  context?: string; // Why this recommendation makes sense
  model: 'haiku' | 'sonnet';
  latency: number;
  cacheHitRate: number;
  tokenMetrics: {
    cached: number;
    input: number;
    output: number;
  };
}

// ============================================================================
// MARK'S GOLDEN SCRIPTS - OPTIMIZED FOR CACHING
// ============================================================================



// ============================================================================
// MARK'S GOLDEN SCRIPTS - SPLIT BY STAGE FOR FASTER INFERENCE
// ============================================================================

const SCRIPTS_GREETING = `## GREETING
1. Basic Intro [ID: intro-basic]: "Hi, my name is [Agent]. Bob Hansen and I are local website designers here in [Place]. I know you're busy, but we help businesses and contractors lock down Page-1 rankings on Google and ChatGPT — plus fully manage their Google Business Profile — within 90 days, or it's completely free. I wanted to see if it makes sense to connect with someone local about an update?"
   → USE WHEN: Customer asks "Who is this?" or "Who are you?" or at start of call
   → ALWAYS end the intro with the "connect with someone local about an update" question.
   → [Place] is the AGENT'S call — they decide whether and how to name their location. Leave "[Place]" exactly as written; never fill in a city.
   → If they don't seem to understand: "We are local website developers that provide complete web design, hosting, and SEO. As a Google-certified partner, we back our work with over 48,000 Page-1 rankings and guarantee Page-1 results on Google and ChatGPT in 90 days or you don't pay a dime."
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent]. Bob Hansen and I are local website designers here in [Place]. We help businesses lock down Page-1 rankings on Google and ChatGPT within 90 days, or it's completely free. I wanted to see if it makes sense to connect with someone local about an update?"
   → ALWAYS end with a question.
5. Bob Transition (skip name): "Bob Hansen and I are local website designers here in [Place]. We help businesses lock down Page-1 rankings on Google and ChatGPT — plus fully manage their Google Business Profile — within 90 days, or it's completely free. I wanted to see if it makes sense to connect with someone local about an update?"
   → USE WHEN: Agent already introduced themselves by name — skip repeating the name, just bring up Bob.
IDENTITY: The agent is Bob's ASSISTANT — reveal that only if asked directly (the intro is peer-toned, "Bob Hansen and I are website designers"). Never call the AGENT Bob's partner. "Bob or his partner" refers to Bob Hansen or his separate partner — the two people who make the callbacks.`;

const SCRIPTS_VALUE_PROP = `## VALUE PROPOSITION
1. Page-1 Hook [ID: hook-page1]: "Real quick — we help local businesses lock down Page-1 rankings on Google and ChatGPT and fully manage their Google Business Profile, guaranteed within 90 days or it's completely free. Do you currently have a website?"
   → USE WHEN: Customer asks "What do you need?" or "What is this about?"
   → ALWAYS end with a question so the conversation keeps flowing.
2. Active Listening: "Okay, yeah. That's why we're here... you said you're open to possibly updating if anything?"
3. Local Emphasis: "That's why we're here, because we're just trying to keep everything local here in [Place]. What kind of business do you run?"
4. No Website Yet: "Well, I'm glad I called, then! I'll have Bob or his partner give you a call to talk about building one. Would you mind if I have either of them give you a call?"
   → USE WHEN: Customer says "I don't have a website."`;

const SCRIPTS_OBJECTION = `## OBJECTION HANDLING
1. Not Right Now Clarifier [ID: obj-not-now]: "I understand. Let me ask you — 'not right now' because you already have a website, or because you're just busy right now?"
   → USE WHEN: Customer says "Not right now" / "Not at the moment" without saying why. Qualify first, THEN use the matching response below.
   → DO NOT use when customer says "Not interested" or "I don't need a website" — see Respect Decline script below
1a. Already Have One [ID: obj-have]: "That's great. We also help businesses improve and optimize their existing websites. Would you mind if I have Bob or his partner give you a call to talk about improving the look or ranking of your website?"
   → USE WHEN: Customer says "We already have a website" / "I already have one."
1b. Busy Right Now [ID: obj-busy]: "No problem. I understand you're busy. Would you mind if I have Bob or his partner give you a call to talk about your website?"
   → USE WHEN: Customer says they're busy / can't talk now.
2. SEO Pivot: "That's great, because we also optimize websites, especially with SEO. Would you mind if I have Bob or his partner give you a call to talk about improving the look or ranking of your website?"
   → USE WHEN: Customer says they HAVE a website (positive tone). NOT when they describe a problem — use SEO Problem Empathy instead.
3. SEO Affirmation: "Yeah, that's great that you already have one because we also optimize websites as well, especially with SEO. Would you mind if I have Bob or his partner give you a call?"
4. SEO Problem Empathy: "Oh, I hear you — SEO can be tricky. That's actually what we specialize in — we guarantee Page-1 rankings on Google and ChatGPT within 90 days. Would you mind if I have Bob or his partner give you a call to walk you through some options?"
   → USE WHEN: Customer says their website has PROBLEMS (SEO, ranking, traffic). Empathize first — NEVER say "that's great" about a problem.
5. Revamp Pivot: "Yeah, that's great that you already have a website because we also optimize or revamp them, especially with SEO. Would you mind if I have Bob or his partner give you a call?"
6. Hosting/Maintenance Pivot: "Of course yeah. I was just about to say though [Name], we provide complete web design, hosting, and SEO... so we can help you host, maintain or optimize it. Would you mind if I have Bob or his partner give you a call?"
7. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business. Would you mind if I have Bob or his partner give you a call to walk you through how that works?"
8. Respect Decline: "No problem. I appreciate you taking my call."
   → USE WHEN: Customer says "I'm not interested", "I don't need a website", "No thanks", or any clear decline. Do NOT push back. Respect it and end the call politely.
9. Future Date [ID: obj-future]: "Excellent. I know you won't be ready to do anything until [their date], but would it be okay if Bob or his partner reach out to you LATER TODAY to discuss some ideas with you?"
   → USE WHEN: Customer mentions a future date ("not until next year", "maybe in the spring", "after tax season"). Fill [their date] with what they said.`;

const SCRIPTS_CLOSING = `## CLOSING (every line drives to the same goal: securing a callback from Bob or his partner)
1. Ask Callback [ID: ask-callback]: "Would you mind if I have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"
   → USE WHEN: After delivering pitch or handling objections - goal is to secure callback
2. Confirm Name: "And your name is? ... You're the owner? You're [Name]?"
3. Trust/Source: "We're scouting small to medium local businesses in the area, so we just got your number off of Google."
4. Soft Close: "And would it be okay, [Name], if I have either Bob or his partner give you a quick call later? Should be a quick call."
5. Decision Maker: "And [Name], you're the person in charge of the website we could talk to, right? Just to confirm."
6. Ask + FOMO: "Would you mind if I have Bob or his partner give you a quick call later? Just don't want you to miss out."
7. Confirm Authority: "You're the owner, [Name]? And you're the person in charge of the website, just to confirm?"
8. Pricing Redirect: "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing. Would you mind if I have them give you a call?"
   → USE WHEN: Customer asks about pricing or cost. Do NOT give specific numbers — pricing is Bob's job.
9. Timeline Redirect: "Great question. Bob or his partner can walk you through the timeline. Would you mind if I have them give you a call?"
   → USE WHEN: Customer asks how long it takes.
10. Samples (Industry): "Absolutely. I'll have Bob or his partner give you a call and go over some examples of websites we've built for businesses like yours. Would you mind if I have them give you a call?"
   → USE WHEN: Customer asks "Have you built sites for companies in my industry?" or wants to see examples.
10a. Samples (City): "Absolutely. I'll have Bob or his partner give you a call and go over some examples of websites we've built in your area. Would you mind if I have them give you a call?"
   → USE WHEN: Customer asks "Have you built any websites in my city?"
11. How To Reach You: "Bob's number is [Bob's number]. So we don't end up playing phone tag, would you mind if I have Bob or his partner give you a call?"
   → USE WHEN: Customer asks "How do I get a hold of you?"
12. Where Located: "Great question. Bob is in [Place]. Would you mind if I have Bob or his partner give you a call to talk about your website?"
   → USE WHEN: Customer asks where you're located. Leave [Place] for the agent — never name a city.
13. Capability Deflect: "Great question. I'm just Bob's assistant, so I don't want to give you the wrong answer. Would you mind if I have Bob or his partner give you a call to answer that for you?"
   → USE WHEN: Customer asks "Are you able to do [specific thing]?" — defer to Bob, then ask for the callback.
14. Build or Update [ID: build-or-update]: "Just to make sure we're on the same page, is this to build a new website, or to update your existing website?"
   → USE WHEN: Lead is non-engaging, OR they've agreed to a callback but the purpose (build vs update) isn't clear yet. The callback purpose must be clear.`;

const SCRIPTS_AI_RECEPTIONIST = `## AI RECEPTIONIST (when talking to an automated system or receptionist)
→ DO NOT use hardcoded scripts here. Respond NATURALLY based on what the receptionist says, using Mark's casual conversational tone ("of course yeah", "real quick though", "no worries").
→ GOAL: Get through to the owner/decision-maker, OR accept their callback offer and leave Bob's info.
→ GUIDELINES:
  - If receptionist asks "How can I help?" → Ask for the owner/manager naturally. Keep it casual.
  - If receptionist offers to arrange a callback → Accept it naturally, mention Bob handles the website details.
  - If a likely receptionist AGREES to a callback → "Excellent. Bob or his partner will reach out. Would they talk to YOU about the website, or is there someone else in charge of that?"
  - If no one is available → Leave a message naturally — [Agent] called, Bob can be reached for a quick chat. The agent's name is ALWAYS [Agent]; never invent one.
  - Never ask an AI/receptionist for business owner name, business name, or discovery details.
  - NEVER ask a receptionist/gatekeeper for an email address — they're not the decision-maker, so a collected email here does NOT produce a qualified appointment.
  - Keep asks operational only: transfer to owner/manager OR callback routing/message.
  - Good style: "Of course, no worries - could you connect me with whoever handles website decisions real quick?"
  - Good style: "No problem at all - can you pass a quick message that Bob's website team called?"
  - Match their energy. If they're formal, be polite. If they're casual, be casual.
  - Keep it SHORT. Don't pitch the receptionist — they're not the decision-maker.`;

const SCRIPTS_ENGAGEMENT = `## ENGAGEMENT (follow-up questions for dry/short/unclear responses)
→ USE WHEN: Customer gives a short, vague, or non-committal answer like "yeah", "I don't know", "maybe", "hmm", silence, or anything that doesn't clearly match another rule. The goal is to keep the conversation alive and learn more about their situation so you can guide them toward the callback.
1. Discovery Question: "Do you currently have a website for your business, or is this something you've been thinking about setting up?"
2. Pain Point Probe: "What's been holding you back from getting a website going? Is it the cost, the time, or just not knowing where to start?"
3. Business Curiosity: "What kind of business do you run, if you don't mind me asking?"
4. Current Situation: "How are your customers finding you right now? Is it mostly word of mouth, or do you have something online?"
5. Gentle Re-engage: "I totally understand. A lot of business owners we talk to feel the same way at first. Are you open to just hearing what we could do for you real quick?"
6. Redirect Deflector: "I hear you. Would it be easier if I just had Bob or his partner give you a quick call later? It would be super quick, just so you know your options."
7. Not The Right Person: "No worries at all. Who would be the best person to talk to about the website? I can have Bob or his partner reach out to them directly."
8. Email Deflection [ID: email-deflect]: "Absolutely. What's the best email address? Bob or his partner can send over some examples of websites they've built for businesses like yours. Since I'm just his assistant, would they be calling to talk to you about the website, or is there someone else in charge of that?"
   → USE WHEN: Customer asks us to email/send info. This is the ONLY place we ask for email — NEVER suggest email ourselves. ALWAYS pivot back to a callback and confirm who the decision-maker is.
9. How'd You Get My Number: "Great question — we're scouting small to medium local businesses in the area, so we just got your number off of Google. We're just reaching out to see if we can help."
10. Skeptical/Scam Concern: "Totally understand the caution. We're a Google-certified partner and local website designers here in [Place]. No pressure at all — would you mind if I have Bob or his partner give you a call?"`;

const SCRIPTS_CONVERSION = `## CONVERSION (goal: lock the callback — NOT collect email)
→ Email is NOT required to convert. We already have their number (we dialed them) and Bob will CALL THEM BACK. Only ask for email if the CUSTOMER asked us to send info (use Email Deflection). Never chase email as a closing step.
→ A qualified appointment needs: (a) the lead engaged, (b) we spoke with the DECISION MAKER, (c) the purpose is clear (build a new site or update the existing one), (d) they agreed to a call TODAY — or next business day only if THEY asked for it, (e) we asked for and confirmed their name.
1. Confirm Callback [ID: confirm-callback]: "Perfect. I'll have Bob or his partner reach out to you later today."
   → USE WHEN: Customer has agreed to a callback. ALWAYS answer their question first if they asked one (e.g. "When will we schedule it?" → "Bob or his partner will reach out later today").
   → ⚠️ NEVER ask for a specific appointment time or day ("when's the best time?", "what day works?"). Bob reaches out — the customer doesn't book a slot.
   → ⚠️ We already have the customer's phone number — do NOT ask for or confirm their phone number.
   → If the customer asks for later → accept next business day: "No problem — I'll have Bob or his partner reach out to you tomorrow." If they volunteer a time, just acknowledge it.
   → Missing name → ask for it. Purpose unclear → Build or Update. Not sure they're the decision maker → "Would they talk to YOU about the website, or is there someone else in charge of that?"
2. Sign Off (Simple): "Got it, [Name]. Bob or his partner will give you a call [later today/tomorrow]. Have a beautiful day and I'm super excited for you. Take care!"
   → Bob will CALL THEM BACK — do NOT say "call at your email".
   → If customer gave a specific time → "Bob or his partner will call you at [time]. Have a beautiful day!"
   → Only if the customer asked to be emailed → "Bob or his partner will give you a call and send some examples to your email. Have a beautiful day!"
3. Sign Off (Options): "We'll give you a call back. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
4. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

/**
 * Returns only the script sections relevant to the current call stage.
 * Always includes ENGAGEMENT (universal fallback) and RESPECT DECLINE (via objection).
 * Adjacent stages are included to handle edge cases where stage detection is slightly off.
 */
export function getScriptsForStage(stage: string): string {
  const sections: string[] = ['# MARK\'S QUALITY SCRIPTS (STAGE-FILTERED)\n', SCRIPTS_AI_RECEPTIONIST];

  switch (stage) {
    case 'greeting':
      sections.push(SCRIPTS_GREETING, SCRIPTS_VALUE_PROP, SCRIPTS_ENGAGEMENT);
      break;
    case 'discovery':
      sections.push(SCRIPTS_VALUE_PROP, SCRIPTS_OBJECTION, SCRIPTS_ENGAGEMENT);
      break;
    case 'objection':
      sections.push(SCRIPTS_OBJECTION, SCRIPTS_CLOSING, SCRIPTS_ENGAGEMENT);
      break;
    case 'closing':
      sections.push(SCRIPTS_OBJECTION, SCRIPTS_CLOSING, SCRIPTS_CONVERSION, SCRIPTS_ENGAGEMENT);
      break;
    case 'conversion':
    case 'signoff':
      sections.push(SCRIPTS_CONVERSION, SCRIPTS_CLOSING);
      break;
    default:
      // Fallback: send objection + closing + engagement (most common need)
      sections.push(SCRIPTS_OBJECTION, SCRIPTS_CLOSING, SCRIPTS_ENGAGEMENT);
  }

  return sections.join('\n\n');
}

// ============================================================================
// ULTRA-COMPRESSED SYSTEM PROMPT (OPTIMIZED FOR SPEED)
// ============================================================================

export const SYSTEM_PROMPT_COMPRESSED = `Sales coach for local website design/SEO. Goal: get the small business OWNER (decision-maker) to agree to a callback from Bob or his partner. Email is NOT the goal and is not required — we dialed them, so Bob calls them back.

BOB: Bob Hansen, senior local website designer. The agent is Bob's ASSISTANT. Bob (or his partner) handles pricing/technical/consultations and makes the callbacks.
- Default intro/pitch: "Bob Hansen and I are local website designers here in [Place]" (peer tone, don't reveal hierarchy upfront).
- [Place] = the agent's location, which is the AGENT'S discretion to disclose. Always output the literal "[Place]" — never fill in or guess a city.
- Direct identity Q ("who are you?", "are you the owner?", "are you Bob?", "what's your role?") → honestly: "I'm Bob's assistant."
- "Bob or his partner" = Bob Hansen or his separate partner (the two who make callbacks). ALWAYS say "Bob or his partner" when offering a callback. Never call the AGENT Bob's partner.

OFFER: Page-1 rankings on Google and ChatGPT plus a fully managed Google Business Profile within 90 days, or it's completely free. Complete web design, hosting, and SEO. Google-certified partner, over 48,000 Page-1 rankings. Works on new sites AND improving existing ones. Never quote prices.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title
[STAGE]: GREETING | VALUE_PROP | OBJECTION_HANDLING | CLOSING | CONVERSION | ENGAGEMENT | SIGNOFF
[CONTEXT]: One sentence (optional)
[SCRIPT]: ONLY the spoken words. STOP after closing quote. No rationale, no explanation, no commentary.

NAMES: Only agent and Bob exist. Never invent names.
INTRO: If agent said "This is [Name]" or "My name is [Name]" → intro DONE. Never suggest intro again.
TONE: Customer describes a problem → empathize first. NEVER say "that's great" about a problem.

INTENT RULES (priority order):
1. AI bot/voicemail → If they offer callback, ACCEPT and give Bob's number. Don't pitch an AI. Don't use Ask Callback for bots.
1b. HUMAN receptionist/front desk (decision maker not available) → Do NOT hand out Bob's number unless they ask for it — Bob or his partner reaches out, not the other way round. Never ask for the decision maker's direct line or cell, and never confirm the number we dialed — we just call it back. Never ask the receptionist for a time or day either ("after 4 or 5?") — Bob or his partner reaches out later today. If they ask for Bob's number, write it as [Bob's number]. Once they agree to a callback: "Excellent. Bob or his partner will reach out. Would they talk to YOU about the website, or is there someone else in charge of that?"
1a. HOSTILE/FAKE info in email/name/phone/business (profanity, "none/noemail/nothanks/fakeemail/leavemealone/dontcall/whatever/stop", "John/Jane Doe"/cartoon names/single letters, 555-0100-0199/111-111-1111/000-000-0000/123-456-7890, "aaa@aaa.com", "xxx-xxx-xxxx") → Respect Decline: "No problem. I do appreciate you taking my call. Have a great day." Do NOT mark collected. Do NOT sign off.
2. Customer agreed to callback (agent asked, customer said yes/sure/sounds good/go ahead, OR customer says "have Bob call me") → CONVERSION. Confirm Callback (later today) and sign off. NEVER re-pitch. Do NOT ask for email here.
   - NEVER ask for a specific time or day. Specific time volunteered ("call at 4") → just acknowledge it.
   - Customer asks for later / "another time" / "busy right now" → offer next business day: "No problem — I'll have Bob or his partner reach out to you tomorrow." Never say "another time"/"sometime". Don't ask "when works best?".
   - Likely receptionist agreed → "Excellent. Bob or his partner will reach out. Would they talk to YOU about the website, or is there someone else in charge of that?"
3. Customer FRUSTRATED ("going in circles", "you already said that", "not listening", "runaround", "level with me", "dancin' around") → STOP. Acknowledge briefly. Pivot to Ask Callback or answer their actual question — EXCEPT price and capability questions: frustration NEVER unlocks a number, range, or "a few hundred" / "per month" figure, and never a capability promise. Say plainly: "You're right, I can't give you a number — I'm just Bob's assistant and I don't want to give you the wrong one. Would you mind if I have Bob or his partner give you a call to go over options and pricing?"
4. Pricing/cost asked → "Great question. It depends on what you're looking for. I'll have Bob or his partner give you a call to go over some options and pricing. Would you mind if I have them give you a call?" NEVER say any number, range, or estimate (not even "a few hundred") — EVEN IF they push for a ballpark a 2nd, 3rd or 4th time, and even if they get annoyed. "Hundreds or thousands?" gets NO answer either. Pushed again → "I honestly don't want to give you the wrong number — it really depends on what you need. Would you mind if I have Bob or his partner give you a call to go over options and pricing?" Timeline asked → Timeline Redirect.
5. Features/capabilities asked ("can you do online booking / e-commerce / X?") → Capability Deflect. NEVER confirm or promise a capability yourself ("yes, we can set that up") — the agent is Bob's assistant and defers it to Bob or his partner.
6. Customer doesn't understand what this is ("what is this?", "I don't get it") → use this line VERBATIM: "We are local website developers that provide complete web design, hosting, and SEO. As a Google-certified partner, we back our work with over 48,000 Page-1 rankings and guarantee Page-1 results on Google and ChatGPT in 90 days or you don't pay a dime." Wrong number → correct politely, re-introduce: "Bob Hansen and I are local website designers here in [Place]".
7. "Who is this?" → Basic Intro (if not already introduced).
7a. "Are you the owner?" / "What's your role?" / "Are you Bob?" / "Who are you really?" → honestly answer "I'm Bob's assistant, I help him connect with local businesses" — then pivot back to value or callback.
8. Open invitation ("go ahead", "I'm listening", "tell me about it") → Bob Transition if intro done, else Quick Intro.
9. "What do you need?" / "What is this about?" → Page-1 Hook.
10. "Not right now" / "not at the moment" with NO reason given → Not Right Now Clarifier (ask: already have a site, or just busy?), then use the matching response.
10a. "Already have a website" → problems/SEO issues: SEO Problem Empathy. Positive/neutral: Already Have One.
10b. "I don't have a website" → No Website Yet.
10c. "I'm busy right now" → Busy Right Now.
10d. Future date ("not until next year", "maybe in the spring") → Future Date — still push for LATER TODAY.
11. "Not interested" / "No thanks" / "I don't need a website" → Respect Decline. Do NOT push back.
12. Pitch done, objections handled, no agreement yet → Ask Callback.
13. Ownership/control asked → IP/Control Assurance (once only).
14. "What do you need from me?" after agreeing → Confirm Name, or Build or Update if purpose unclear. Do NOT ask for email or a time.
15. "How'd you get my number?" / suspicious → How'd You Get My Number or Skeptical/Scam Concern.
16. "Not the right person" → Not The Right Person.
17. "Send me an email" / "can you email us info" → Email Deflection. This is the ONLY case where we ask for email — and always pivot back to a callback + confirm the decision-maker. Never ask a receptionist/gatekeeper for email.
18. "Built sites in my industry?" → Samples (Industry). "In my city?" → Samples (City). "How do I reach you?" → How To Reach You. "Are you able to do X?" → Capability Deflect.
18a. "Where are you located?" → "Great question. Bob is in [Place]. Would you mind if I have Bob or his partner give you a call to talk about your website?" — do NOT re-pitch.
19. Non-engaging lead (2+ flat answers in a row: "I dunno", "whatever", "eh", "maybe", won't commit either way) → STOP asking discovery questions and use this line VERBATIM: "Just to make sure we're on the same page, is this to build a new website, or to update your existing website?" "Whatever"/"I dunno"/"eh"/"maybe" is NEITHER agreement NOR a decline — never sign off and never Respect Decline on it; use this line (once). Other dry/vague/one-word answers → ENGAGEMENT script most relevant to context.

CONVERSION (after agreement):
- Do NOT re-pitch. Steps: Confirm Name → confirm Decision Maker → purpose clear (Build or Update) → Confirm Callback (today; next business day only if they asked) → Sign Off. Skip what's already known. Email is NOT a step — only collect it if the customer asked to be emailed (rule 17).
- We dialed them — NEVER ask for or confirm their phone number. NEVER ask for an appointment time or day.
- Acknowledge what they JUST SAID before the next question.
- Missing name → "And your name is?" | Have name + decision maker + purpose → Sign Off | "I already told you" → Sign Off immediately.

VALIDITY: A name counts only if real (not profanity/Doe/cartoons/single letters). If the customer DID give an email (only when they asked to be emailed), it counts only if real (local@domain, no profanity/dismissals). Hostile/fake name or email → rule 1a.

SIGNOFF: Output ONLY a Sign Off script. Bob will CALL THEM BACK — never say "call at your email".

SCRIPT: ONE turn only — never write the customer's reply, never use "..." to skip ahead, never combine a question with a sign-off. (1) short acknowledgment of LATEST message (≤15 words) + (2) best golden script. Must end with a question or callback ask — prefer "Would you mind if I have Bob or his partner give you a call?"; NEVER end with "Is this something you'd be interested in?". Customer asked → answer first, then script. Respond to NOW, not 5 msgs ago. Fill [Name] if known — if the name is NOT known, drop [Name] entirely (never output "[Name]"). Leave [Place] as written. No pricing/technical — Bob's job. Never suggest email.

ANTI-REPETITION: Check ALREADY SUGGESTED — never repeat listed scripts. Intro done → no intro again. SEO pitched → no SEO repeat. Callback asked → only re-ask if context changed. Customer switched topics → answer NEW. Fallback: Ask Callback always advances.

ESCALATION: SEO pitched + still objecting → softer Ask Callback. SEO + callback asked + still hesitant → Respect Decline.

FACTS: Read ESTABLISHED FACTS; never ask about things already known. Identity: always "local website designers", never "digital marketing company".

FRUSTRATION: "repeating", "already said that", "going in circles", "not answering", "runaround", "waste of time" → During conversion: Sign Off. Before conversion: acknowledge + Ask Callback. Still NO price figures or capability promises.`;


// ============================================================================
// PERFORMANCE-OPTIMIZED CLAUDE API CALL
// ============================================================================

export async function generateAITip(request: AITipRequest): Promise<AITipResponse> {
  const startTime = Date.now();

  // Always use Haiku — fast, cheap, and handles our prompt well
  const model = HAIKU_MODEL;

  try {
    // Ultra-compressed user prompt
    const userPrompt = buildCompressedPrompt(request);

    const anthropic = await getAnthropicClient();
    const response = await anthropic.messages.create({
      model,
      max_tokens: 300, // Tips are ~50-80 tokens; longer for objection handling
      temperature: 0.3, // Lower for consistency and speed
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT_COMPRESSED,
          cache_control: { type: 'ephemeral' }
        },
        {
          type: 'text',
          text: getScriptsForStage(request.callStage),
        }
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const latency = Date.now() - startTime;
    const textContent = response.content[0];
    const fullText = textContent.type === 'text' ? textContent.text : '';

    // DEBUG: Log full Claude response
    console.log('[Claude] Full Response from API:');
    console.log('=====================================');
    console.log(fullText);
    console.log('=====================================');

    // Calculate cache hit rate
    const cachedTokens = response.usage.cache_read_input_tokens || 0;
    const totalInputTokens = response.usage.input_tokens + cachedTokens;
    const cacheHitRate = totalInputTokens > 0 ? cachedTokens / totalInputTokens : 0;

    // Extract all fields
    const parsed = parseAITipResponse(fullText, request.callStage);

    // DEBUG: Log parsed result
    console.log('[Claude] Parsed Result:');
    console.log(`  Heading: "${parsed.heading}"`);
    console.log(`  Stage: "${parsed.stage}"`);
    console.log(`  Script: "${parsed.suggestion}"`);
    console.log(`  Context: "${parsed.context || 'none'}"`);
    console.log('=====================================');

    // Performance logging
    if (latency > MAX_LATENCY_MS) {
      console.warn(`[Claude] LATENCY WARNING: ${latency}ms exceeds target ${MAX_LATENCY_MS}ms`);
    }
    if (cacheHitRate < CACHE_HIT_TARGET) {
      console.warn(`[Claude] CACHE WARNING: ${(cacheHitRate * 100).toFixed(1)}% below target ${CACHE_HIT_TARGET * 100}%`);
    }

    console.log(`[Claude] Performance: ${latency}ms, Cache: ${(cacheHitRate * 100).toFixed(1)}%, Model: Haiku`);

    return {
      ...parsed,
      model: 'haiku',
      latency,
      cacheHitRate,
      tokenMetrics: {
        cached: cachedTokens,
        input: response.usage.input_tokens,
        output: response.usage.output_tokens
      }
    };

  } catch (error: any) {
    console.error('[Claude] API Error:', error);

    // Fallback to default scripts if API fails
    return getFallbackSuggestion(request.callStage, Date.now() - startTime);
  }
}

// ============================================================================
// STREAMING CLAUDE API CALL — pushes text chunks via callback
// ============================================================================

/**
 * Internal Anthropic streaming implementation. Throws on any error so the
 * outer wrapper can decide whether to fall back to OpenAI.
 * Takes a `markFirstChunk` hook so the wrapper knows if any bytes reached the client.
 */
async function generateAITipStreamingAnthropicInternal(
  request: AITipRequest,
  onChunk: (delta: string) => Promise<void>,
  markFirstChunk: () => void
): Promise<AITipResponse> {
  const startTime = Date.now();
  const model = HAIKU_MODEL;

  const userPrompt = buildCompressedPrompt(request);
  const anthropic = await getAnthropicClient();

  let fullText = '';

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 300,
    temperature: 0.3,
    system: [
      {
        type: 'text' as const,
        text: SYSTEM_PROMPT_COMPRESSED,
        cache_control: { type: 'ephemeral' as const }
      },
      {
        type: 'text' as const,
        text: getScriptsForStage(request.callStage),
      }
    ],
    messages: [
      { role: 'user' as const, content: userPrompt }
    ]
  });

  let chunkBuffer = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const text = event.delta.text;
      fullText += text;
      chunkBuffer += text;
      if (chunkBuffer.length >= 20 || /[.!?,\n]$/.test(chunkBuffer)) {
        markFirstChunk();
        try {
          await onChunk(chunkBuffer);
        } catch (err) {
          console.error('[Claude Stream] Error sending chunk:', err);
        }
        chunkBuffer = '';
      }
    }
  }
  if (chunkBuffer) {
    markFirstChunk();
    try {
      await onChunk(chunkBuffer);
    } catch (err) {
      console.error('[Claude Stream] Error sending final chunk:', err);
    }
  }

  const finalMessage = await stream.finalMessage();
  const latency = Date.now() - startTime;

  console.log('[Claude Stream] Full Response:');
  console.log('=====================================');
  console.log(fullText);
  console.log('=====================================');

  const cachedTokens = finalMessage.usage.cache_read_input_tokens || 0;
  const totalInputTokens = finalMessage.usage.input_tokens + cachedTokens;
  const cacheHitRate = totalInputTokens > 0 ? cachedTokens / totalInputTokens : 0;

  const parsed = parseAITipResponse(fullText, request.callStage);

  console.log(`[Claude Stream] Performance: ${latency}ms, Cache: ${(cacheHitRate * 100).toFixed(1)}%, Model: Haiku`);

  return {
    ...parsed,
    model: 'haiku',
    latency,
    cacheHitRate,
    tokenMetrics: {
      cached: cachedTokens,
      input: finalMessage.usage.input_tokens,
      output: finalMessage.usage.output_tokens
    }
  };
}

/**
 * Public entry point — tries Anthropic first, falls back to OpenAI on server
 * errors or timeout BEFORE any chunk has been sent to the client.
 */
export async function generateAITipStreaming(
  request: AITipRequest,
  onChunk: (delta: string) => Promise<void>
): Promise<AITipResponse> {
  const startTime = Date.now();

  let firstChunkEmitted = false;
  const markFirstChunk = () => { firstChunkEmitted = true; };

  // Force-fallback mode for testing
  if (FORCE_OPENAI_FALLBACK) {
    logFallback('tip', 'FORCE_OPENAI_FALLBACK=true');
    return generateAITipStreamingOpenAI(request, onChunk);
  }

  try {
    // Simulated-failure mode for testing
    if (FAIL_ANTHROPIC_CALLS) {
      const err: any = new Error('FAIL_ANTHROPIC_CALLS=true (simulated)');
      err.status = 500;
      throw err;
    }

    return await withTimeout(
      generateAITipStreamingAnthropicInternal(request, onChunk, markFirstChunk),
      ANTHROPIC_TIMEOUT_MS,
      'Anthropic stream'
    );
  } catch (error: any) {
    // Fall back only if no bytes reached the client AND the error is retryable
    if (!firstChunkEmitted && shouldFallback(error)) {
      logFallback('tip', error?.code || error?.name || `status:${error?.status}` || 'unknown', {
        message: String(error?.message || '').substring(0, 200),
      });
      try {
        return await generateAITipStreamingOpenAI(request, onChunk);
      } catch (fallbackErr: any) {
        console.error('[OpenAI Fallback] Also failed:', fallbackErr);
        return getFallbackSuggestion(request.callStage, Date.now() - startTime);
      }
    }

    // Either we already streamed something, or this error shouldn't trigger fallback
    console.error('[Claude Stream] Error (no fallback):', error);
    return getFallbackSuggestion(request.callStage, Date.now() - startTime);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function buildCompressedPrompt(request: AITipRequest): string {
  // Optimized prompt with proper context window
  const parts: string[] = [
    `Stage: ${request.callStage}`,
    `Transcript Count: ${request.transcriptCount || 0}`
  ];

  // Include collected info so Claude knows what's missing during CONVERSION
  if (request.collectedInfo) {
    const info = request.collectedInfo;
    parts.push(`\nCOLLECTED INFO (what the agent has/hasn't gathered):`);
    parts.push(`  customerName: ${info.customerName ? 'YES' : 'NO — ask for it'}`);
    parts.push(`  businessName: ${info.businessName ? 'YES' : 'NO — ask for it'}`);
    parts.push(`  phoneNumber: ALREADY HAVE IT (we dialed them) — do NOT ask for phone`);
    parts.push(`  email: ${info.email ? 'YES (already given)' : 'NOT NEEDED — do NOT ask for email unless the customer asked us to send/email info'}`);
  }

  // Include conversation facts — established truths about this call
  if (request.conversationFacts?.length) {
    parts.push(`\n⚠️ ESTABLISHED FACTS (do NOT contradict or re-ask these):`);
    for (const fact of request.conversationFacts) {
      parts.push(`  • ${fact}`);
    }
  }

  // Include recent conversation with speaker labels
  // CRITICAL: Keep the MOST RECENT messages (truncate from the START, not the end)
  // so the model always sees what just happened, not ancient history
  if (request.recentTranscript) {
    const transcript = request.recentTranscript;
    const aiReceptionistDetected = /\b(ai receptionist|virtual receptionist|automated (?:system|receptionist)|assist(?:ing)? with appointments|scheduling appointments|how can i assist you|team call you back|team reach out)\b/i.test(transcript);
    const maxLen = 2200;
    const truncated = transcript.length > maxLen 
      ? '...\n' + transcript.substring(transcript.length - maxLen)
      : transcript;
    parts.push(`\nRecent Conversation:\n${truncated}`);
    
    // Extract the LAST 3 lines as a highlighted "LATEST EXCHANGE" so the model
    // doesn't get lost in older context and always responds to what JUST happened
    const lines = transcript.trim().split('\n');
    if (lines.length > 3) {
      const latest = lines.slice(-3).join('\n');
      parts.push(`\n⚠️ LATEST EXCHANGE (your tip MUST respond to THIS — not older messages):\n${latest}`);
    }

    if (aiReceptionistDetected) {
      parts.push(`\n🚨 RECEPTIONIST MODE DETECTED (hard rule):`);
      parts.push(`- Customer is a gatekeeper/AI receptionist, not the business owner.`);
      parts.push(`- Do NOT ask for owner/business name or run discovery questions with receptionist.`);
      parts.push(`- Do NOT ask the receptionist for an email — they're not the decision-maker, so it won't produce a qualified appointment.`);
      parts.push(`- Next line must either: (a) ask for transfer to owner/decision-maker, OR (b) accept callback routing and leave a short message for Bob's website team.`);
      parts.push(`- Keep it casual, short, and operational.`);
    }
  }

  // Include summary for additional context
  if (request.conversationSummary) {
    parts.push(`\nSummary: ${request.conversationSummary.substring(0, 300)}`);
  }

  // Include previous suggestions so AI avoids repeating
  if (request.previousSuggestions && request.previousSuggestions.length > 0) {
    const prevList = request.previousSuggestions.slice(-5).map((s, i) => `${i + 1}. "${s.substring(0, 80)}"`).join('\n');
    parts.push(`\n⚠️ ALREADY SUGGESTED (do NOT repeat these — pick a DIFFERENT script):\n${prevList}`);
  }

  return parts.join('\n');
}

export const PRICING_REDIRECT = "I honestly don't want to give you the wrong number — it really depends on what you need. Would you mind if I have Bob or his partner give you a call to go over options and pricing?";

// Any spoken price figure: "$500", "500 dollars", "a few hundred", "couple thousand", "per month".
// "48,000 Page-1 rankings" is the script's own stat and must not trip it.
export function mentionsPrice(script: string): boolean {
  return /\$\s?\d|\b\d[\d,.]*\s*(dollars|bucks|k\b)|\b(hundreds?|thousands?)\b(?!\s*percent)|\bper month\b|\ba month\b/i.test(script);
}

export function parseAITipResponse(text: string, callStage: string): Omit<AITipResponse, 'model' | 'latency' | 'cacheHitRate' | 'tokenMetrics'> {
  const extract = (pattern: RegExp) => {
    const match = text.match(pattern);
    return match ? match[1].trim() : '';
  };

  const heading = extract(/\[HEADING\]:\s*(.+?)(?=\n|$)/i) || getDefaultHeading(callStage);
  const stage = extract(/\[STAGE\]:\s*(\w+)/i) || callStage.toUpperCase();
  const context = extract(/\[CONTEXT\]:\s*(.+?)(?=\n|$)/i) || undefined;

  // Extract script and clean any explanatory text
  // Match everything after [SCRIPT]: until we hit explanatory text (with or without newline)
  let script = extract(/\[SCRIPT\]:\s*(.+?)(?=\s+(?:Rationale|Value proposition|Explanation|Benefits|The script|Key observations)|\n\s*(?:Rationale|Value proposition|Explanation|Benefits|The script|Key observations):|$)/is) || '';

  // Fallback: if script is empty, try simpler extraction (just until double newline or end)
  if (!script || script.trim().length === 0) {
    script = extract(/\[SCRIPT\]:\s*(.+?)(?=\n\n|$)/is) || '';
  }

  // AGGRESSIVE CLEANING: Remove ANY explanatory text that might follow the script
  // This catches cases where Claude puts rationale on the same line or next line
  script = script.split(/\s+(?:Rationale|Value proposition|Explanation|Benefits|The script|Key observations)/i)[0].trim();

  // Also split on colon-based patterns
  script = script.split(/\s*(?:Rationale|Value proposition|Explanation|Benefits|The script|Key observations):/i)[0].trim();

  // Also remove any trailing bullet points or dashes
  script = script.split(/\n\s*[-•]/)[0].trim();

  // Remove quotes if Claude wrapped the script in quotes
  script = script.replace(/^["'](.*)["']$/s, '$1').trim();

  // Fallback if parsing fails
  if (!script) {
    return getFallbackSuggestion(callStage, 0);
  }

  // Pricing is Bob's job. Haiku occasionally caves when a lead keeps pushing for a
  // ballpark, so enforce it here rather than trusting the prompt alone.
  if (mentionsPrice(script)) {
    console.warn(`[Parse] Price figure in suggestion, replacing with Pricing Redirect: "${script}"`);
    script = PRICING_REDIRECT;
  }

  return {
    suggestion: script,
    heading: heading.substring(0, 20), // Max 20 chars
    stage,
    context
  };
}

function getDefaultHeading(stage: string): string {
  const headings: Record<string, string> = {
    greeting: 'Greet Prospect',
    discovery: 'Ask Discovery',
    objection: 'Handle Objection',
    closing: 'Ask Callback',
    conversion: 'Confirm Callback'
  };
  return headings[stage] || 'Next Step';
}

export function getFallbackSuggestion(stage: string, latency: number): AITipResponse {
  const fallbacks: Record<string, { heading: string; stage: string; suggestion: string }> = {
    greeting: {
      heading: 'Greet Prospect',
      stage: 'GREETING',
      suggestion: 'Good morning, can you hear me okay?'
    },
    discovery: {
      heading: 'Ask Discovery',
      stage: 'VALUE_PROP',
      suggestion: "Real quick — we help local businesses lock down Page-1 rankings on Google and ChatGPT, guaranteed within 90 days or it's completely free. Do you currently have a website?"
    },
    objection: {
      heading: 'Handle Objection',
      stage: 'OBJECTION_HANDLING',
      suggestion: "Would you mind if I have Bob or his partner give you a call to talk about your website?"
    },
    closing: {
      heading: 'Ask Callback',
      stage: 'CLOSING',
      suggestion: 'Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?'
    },
    conversion: {
      heading: 'Confirm Callback',
      stage: 'CONVERSION',
      suggestion: "Perfect. And your name is? I'll have Bob or his partner reach out to you later today."
    }
  };

  const fallback = fallbacks[stage] || fallbacks.greeting;

  return {
    ...fallback,
    model: 'haiku',
    latency,
    cacheHitRate: 0,
    tokenMetrics: { cached: 0, input: 0, output: 0 }
  };
}

// ============================================================================
// PERFORMANCE METRICS EXPORT
// ============================================================================

export interface PerformanceMetrics {
  averageLatency: number;
  p95Latency: number;
  cacheHitRate: number;
  haikuUsage: number;
  sonnetUsage: number;
}

let latencyHistory: number[] = [];
let cacheHitHistory: number[] = [];
let modelUsageCount = { haiku: 0, sonnet: 0 };

export function recordMetrics(response: AITipResponse): void {
  latencyHistory.push(response.latency);
  cacheHitHistory.push(response.cacheHitRate);
  modelUsageCount[response.model]++;

  // Keep last 100 records
  if (latencyHistory.length > 100) {
    latencyHistory = latencyHistory.slice(-100);
    cacheHitHistory = cacheHitHistory.slice(-100);
  }
}

export function getPerformanceMetrics(): PerformanceMetrics {
  const sorted = [...latencyHistory].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);

  return {
    averageLatency: latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length,
    p95Latency: sorted[p95Index] || 0,
    cacheHitRate: cacheHitHistory.reduce((a, b) => a + b, 0) / cacheHitHistory.length,
    haikuUsage: modelUsageCount.haiku,
    sonnetUsage: modelUsageCount.sonnet
  };
}
