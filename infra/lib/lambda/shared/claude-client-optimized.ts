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
1. Basic Intro [ID: intro-basic]: "My name is [Agent]. Bob Hansen and I are website designers here in Topeka (toe PEEK uh) and Kansas City (KAN zus sit ee). We're very affordable. I wanted to see if you'd be interested in talking with someone LOCAL about building or updating your website?"
   → USE WHEN: Customer asks "Who is this?" or "Who are you?" or at start of call
   → ALWAYS end the intro with the "someone LOCAL" question.
   → Alt value prop (interchangeable): "We build simple, affordable websites that rank really well on Google."
   → If they don't seem to understand: "We're local website designers here in Topeka and Kansas City, so we wanted to see if you'd like some help from someone LOCAL on your website."
   → "(toe PEEK uh)" / "(KAN zus sit ee)" are pronunciation hints for delivery — do NOT speak the parentheses.
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent]. Bob Hansen and I are local website designers here in Topeka and Kansas City. I wanted to see if you'd be interested in talking with someone LOCAL about your website?"
   → ALWAYS end with a question.
5. Bob Transition (skip name): "Bob Hansen and I are website designers here in Topeka and Kansas City. I wanted to see if you'd be interested in talking with someone LOCAL about building or updating your website?"
   → USE WHEN: Agent already introduced themselves by name — skip repeating the name, just bring up Bob.
IDENTITY: The agent is Bob's ASSISTANT — reveal that only if asked directly (the intro is peer-toned, "Bob Hansen and I are website designers"). Never call the AGENT Bob's partner. "Bob or his partner" refers to Bob Hansen or his separate partner — the two people who make the callbacks.`;

const SCRIPTS_VALUE_PROP = `## VALUE PROPOSITION
1. Affordable Hook [ID: hook-affordable]: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all. Do you currently have a website?"
   → USE WHEN: Customer asks "What do you need?" or "I'm busy" or "What is this about?"
   → ALWAYS end with a question so the conversation keeps flowing.
2. Active Listening: "Okay, yeah. That's why we're here... you said you're open to possibly updating if anything?"
3. Local Emphasis: "That's why we're here, because we're just trying to keep everything local here in [Location]. What kind of business do you run?"
4. No Website Yet: "Well, I'm glad I called, then! I'll get Bob or his partner to reach out today to chat with you about building one. Would you mind if I have either of them give you a call?"
   → USE WHEN: Customer says "I don't have a website."`;

const SCRIPTS_OBJECTION = `## OBJECTION HANDLING
1. Not Right Now Clarifier [ID: obj-not-now]: "I understand. Let me ask you — 'not right now' because you already have a website, or because you're just busy right now?"
   → USE WHEN: Customer says "Not right now" / "Not at the moment" without saying why. Qualify first, THEN use the matching response below.
   → DO NOT use when customer says "Not interested" or "I don't need a website" — see Respect Decline script below
1a. Already Have One [ID: obj-have]: "That's great, because we also optimize websites. Would you mind if I have Bob or his partner call you to talk about improving the look or ranking of your website?"
   → USE WHEN: Customer says "We already have a website" / "I already have one."
1b. Busy Right Now [ID: obj-busy]: "No problem. Since you're busy right now, I'll have Bob or his partner call you later today to talk about your website. Would you mind if I have him give you a call?"
   → USE WHEN: Customer says they're busy / can't talk now.
2. SEO Pivot: "That's great, because we also optimize websites, especially with SEO. Would you mind if I have Bob or his partner call you to talk about improving the look or ranking of your website?"
   → USE WHEN: Customer says they HAVE a website (positive tone). NOT when they describe a problem — use SEO Problem Empathy instead.
3. SEO Affirmation: "Yeah, that's great that you already have one because we also optimize websites as well, especially with SEO. Would you mind if Bob gives you a quick call later?"
4. SEO Problem Empathy: "Oh, I hear you — SEO can be tricky. That's actually what we specialize in. Would you mind if Bob gives you a quick call to walk you through some options?"
   → USE WHEN: Customer says their website has PROBLEMS (SEO, ranking, traffic). Empathize first — NEVER say "that's great" about a problem.
5. Revamp Pivot: "Yeah, that's great that you already have a website because we also optimize or revamp them, especially with SEO. Would you mind if Bob gives you a quick call later?"
6. Digital Marketing Pivot: "Of course yeah. I was just about to say though [Name], we're a whole digital marketing company... and we can help you host, maintain or optimize it, especially with SEO. Would it be okay if Bob gives you a quick call?"
7. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business. Would you mind if Bob gives you a quick call to walk you through how that works?"
8. Respect Decline: "No problem. I do appreciate you taking my call. Have a great day."
   → USE WHEN: Customer says "I'm not interested", "I don't need a website", "No thanks", or any clear decline. Do NOT push back. Respect it and end the call politely.`;

const SCRIPTS_CLOSING = `## CLOSING (every line drives to the same goal: securing a callback from Bob or his partner)
1. Ask Callback [ID: ask-callback]: "Would you mind if I have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"
   → USE WHEN: After delivering pitch or handling objections - goal is to secure callback
2. Confirm Name: "And your name is? ... You're the owner? You're [Name]?"
3. Trust/Source: "We're scouting small to medium local businesses in the area, so we just got your number off of Google."
4. Soft Close: "And would it be okay, [Name], if I have either Bob or his partner give you a quick call later? Should be a quick call."
5. Decision Maker: "And [Name], you're the person in charge of the website we could talk to, right? Just to confirm."
6. Ask + FOMO: "Would you mind if I have Bob or his partner give you a quick call later? Just don't want you to miss out."
7. Confirm Authority: "You're the owner, [Name]? And you're the person in charge of the website, just to confirm?"
8. Pricing Redirect: "Great question. We're super affordable. I'll get Bob or his partner to reach out today with some general info and pricing. Would you mind if I have either of them give you a call?"
   → USE WHEN: Customer asks about pricing or cost. Do NOT give specific numbers — pricing is Bob's job.
9. Timeline Redirect: "Bob can walk you through the timeline — would you mind if he gives you a quick call later today? Does that sound good?"
   → USE WHEN: Customer asks how long it takes.
10. Samples/Track Record: "Absolutely. I'll get Bob or his partner to reach out today with some samples of websites we've done in [your area/industry]. Would you mind if I have either of them give you a call?"
   → USE WHEN: Customer asks "Have you built sites for companies in my industry/city?" or wants to see examples.
11. How To Reach You: "Bob's number is [Bob's number]. So we don't play phone tag, let me have him call you. Would you mind if I have him or his partner give you a quick call?"
   → USE WHEN: Customer asks "How do I get a hold of you?"
12. Where Located: "Great question. Bob's in Topeka and Kansas City. I'll get him to reach out today with some samples of websites we've done in [your area/industry]. Would you mind if I have him or his partner give you a call?"
   → USE WHEN: Customer asks where you're located.
13. Capability Deflect: "Great question. I'm just Bob's assistant, so I don't want to give you the wrong answer. I'll get Bob or his partner to reach out today to answer that. Would you mind if I have him or his partner give you a call?"
   → USE WHEN: Customer asks "Are you able to do [specific thing]?" — defer to Bob, then ask for the callback.`;

const SCRIPTS_AI_RECEPTIONIST = `## AI RECEPTIONIST (when talking to an automated system or receptionist)
→ DO NOT use hardcoded scripts here. Respond NATURALLY based on what the receptionist says, using Mark's casual conversational tone ("of course yeah", "real quick though", "no worries").
→ GOAL: Get through to the owner/decision-maker, OR accept their callback offer and leave Bob's info.
→ GUIDELINES:
  - If receptionist asks "How can I help?" → Ask for the owner/manager naturally. Keep it casual.
  - If receptionist offers to arrange a callback → Accept it naturally, mention Bob handles the website details.
  - If no one is available → Leave a message naturally — Caesar called, Bob can be reached for a quick chat.
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
7. Not The Right Person: "No worries at all. Who would be the best person to talk to about the website? I can have Bob reach out to them directly."
8. Email Deflection [ID: email-deflect]: "Absolutely. What's your email address? Bob or his partner will want to send over examples of sites they've built for companies like yours, and I'm just his assistant, so he'll want to call back and ask you a question or two so he knows what to send. Would they call to talk to YOU about the website, or is there someone else in charge of that?"
   → USE WHEN: Customer asks us to email/send info. This is the ONLY place we ask for email. ALWAYS pivot back to a callback and confirm who the decision-maker is.
9. How'd You Get My Number: "Great question — we're scouting small to medium local businesses in the area, so we just got your number off of Google. We're just reaching out to see if we can help."
10. Skeptical/Scam Concern: "Totally understand the caution. We're a legit local company here in [Location]. We just work with small businesses to help them get online. No pressure at all."`;

const SCRIPTS_CONVERSION = `## CONVERSION (goal: lock the callback — NOT collect email)
→ Email is NOT required to convert. We already have their number (we dialed them) and Bob will CALL THEM BACK. Only ask for email if the CUSTOMER asked us to send info (use Email Deflection). Never chase email as a closing step.
1. Confirm Time: "Perfect. Bob or his partner can give you a call later today — when's the best time to reach you?"
   → USE WHEN: Customer has agreed to a callback. ALWAYS answer their question first if they asked one (e.g. "When will we schedule it?" → "Bob can call you later today" THEN confirm the time).
   → ⚠️ We already have the customer's phone number — do NOT ask for their phone number.
   → ⚠️ If the customer said "another time" / "I'm busy right now" / asked to schedule later → do NOT say "later today". Instead: "No problem at all — when works best for you?"
2. Sign Off (Simple): "Got it, [Name]. Bob will give you a call back [time]. Have a beautiful day and I'm super excited for you. Take care!"
   → Bob will CALL THEM BACK — do NOT say "call at your email".
   → If customer gave a specific time → "Bob will call you back at [time]. Have a beautiful day!"
   → If no specific time → "Bob will give you a call back later. Have a beautiful day and I'm super excited for you. Take care!"
   → Only if the customer asked to be emailed → "Bob will give you a call back and send more info to your email. Have a beautiful day!"
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

BOB: Bob Hansen, senior local website designer in Topeka and Kansas City. The agent is Bob's ASSISTANT. Bob (or his partner) handles pricing/technical/consultations and makes the callbacks.
- Default intro/pitch: "Bob Hansen and I are website designers here in Topeka and Kansas City" (peer tone, don't reveal hierarchy upfront).
- Direct identity Q ("who are you?", "are you the owner?", "are you Bob?", "what's your role?") → honestly: "I'm Bob's assistant."
- "Bob or his partner" = Bob Hansen or his separate partner (the two who make callbacks). Never call the AGENT Bob's partner.
- "Topeka"/"Kansas City" carry pronunciation hints (toe PEEK uh / KAN zus sit ee) — delivery aids only, never speak the parentheses.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title
[STAGE]: GREETING | VALUE_PROP | OBJECTION_HANDLING | CLOSING | CONVERSION | ENGAGEMENT | SIGNOFF
[CONTEXT]: One sentence (optional)
[SCRIPT]: ONLY the spoken words. STOP after closing quote. No rationale, no explanation, no commentary.

NAMES: Only agent and Bob exist. Never invent names.
INTRO: If agent said "This is [Name]" or "My name is [Name]" → intro DONE. Never suggest intro again.
TONE: Customer describes a problem → empathize first. NEVER say "that's great" about a problem.

INTENT RULES (priority order):
1. AI/receptionist/voicemail → If they offer callback, ACCEPT and give Bob's number. Don't pitch an AI. Don't use Ask Callback for bots.
1a. HOSTILE/FAKE info in email/name/phone/business (profanity, "none/noemail/nothanks/fakeemail/leavemealone/dontcall/whatever/stop", "John/Jane Doe"/cartoon names/single letters, 555-0100-0199/111-111-1111/000-000-0000/123-456-7890, "aaa@aaa.com", "xxx-xxx-xxxx") → Respect Decline: "No problem. I do appreciate you taking my call. Have a great day." Do NOT mark collected. Do NOT sign off.
2. Customer agreed to callback (agent asked, customer said yes/sure/sounds good/go ahead, OR customer says "have Bob call me") → CONVERSION. Confirm the callback time and sign off. NEVER re-pitch. Do NOT ask for email here.
   - Specific time given ("call at 4", "tomorrow") → acknowledge it and confirm. Do NOT ask for email.
   - "Another time"/"busy right now" → ask WHEN, don't assume "later today".
3. Customer FRUSTRATED ("going in circles", "you already said that", "not listening", "runaround", "level with me", "dancin' around") → STOP. Acknowledge briefly. Pivot to Ask Callback or answer their actual question.
4. Pricing/cost/timeline asked → redirect to Bob: "We're super affordable — Bob can get into the details. Would you mind if he gives you a quick call?"
5. Features/capabilities asked → "Definitely, Bob can show you exactly how that works — would he be able to give you a quick call?"
6. Wrong number/confused → correct politely, re-introduce: "Bob Hansen and I are website designers here in Topeka and Kansas City".
7. "Who is this?" → Basic Intro (if not already introduced).
7a. "Are you the owner?" / "What's your role?" / "Are you Bob?" / "Who are you really?" → honestly answer "I'm Bob's assistant, I help him connect with local businesses" — then pivot back to value or callback.
8. Open invitation ("go ahead", "I'm listening", "tell me about it") → Bob Transition if intro done, else Quick Intro.
9. "What do you need?" / "I'm busy" → Affordable Hook.
10. "Not right now" / "not at the moment" with NO reason given → Not Right Now Clarifier (ask: already have a site, or just busy?), then use the matching response.
10a. "Already have a website" → problems/SEO issues: SEO Problem Empathy. Positive/neutral: Already Have One.
10b. "I don't have a website" → No Website Yet.
10c. "I'm busy right now" → Busy Right Now.
11. "Not interested" / "No thanks" → Respect Decline. Do NOT push back.
12. Pitch done, objections handled, no agreement yet → Ask Callback.
13. Ownership/control asked → IP/Control Assurance (once only).
14. "What do you need from me?" after agreeing → Confirm Name or confirm callback time. Do NOT ask for email.
15. "How'd you get my number?" / suspicious → How'd You Get My Number or Skeptical/Scam Concern.
16. "Not the right person" → Not The Right Person.
17. "Send me an email" / "can you email us info" → Email Deflection. This is the ONLY case where we ask for email — and always pivot back to a callback + confirm the decision-maker. Never ask a receptionist/gatekeeper for email.
18. "Have you built sites for my industry/city?" / wants examples → Samples/Track Record. "How do I reach you?" → How To Reach You. "Where are you located?" → Where Located. "Are you able to do X?" → Capability Deflect.
19. Dry/vague/one-word answer → ENGAGEMENT script most relevant to context.

CONVERSION (after agreement):
- Do NOT re-pitch. Steps: Confirm Name → Confirm callback Time → Sign Off (skip what's already known). Email is NOT a step — only collect it if the customer asked to be emailed (rule 17).
- We dialed them — NEVER ask for phone.
- Acknowledge what they JUST SAID before the next question.
- Missing name → "And your name is?" | Have name + time → Sign Off | "I already told you" → Sign Off immediately.

VALIDITY: A name counts only if real (not profanity/Doe/cartoons/single letters). If the customer DID give an email (only when they asked to be emailed), it counts only if real (local@domain, no profanity/dismissals). Hostile/fake name or email → rule 1a.

SIGNOFF: Output ONLY a Sign Off script. Bob will CALL THEM BACK — never say "call at your email".

SCRIPT: (1) short acknowledgment of LATEST message (≤15 words) + (2) best golden script. Must end with a question or callback ask. Customer asked → answer first, then script. Respond to NOW, not 5 msgs ago. Fill [Name]/[Location] if known. No pricing/technical — Bob's job.

ANTI-REPETITION: Check ALREADY SUGGESTED — never repeat listed scripts. Intro done → no intro again. SEO pitched → no SEO repeat. Callback asked → only re-ask if context changed. Customer switched topics → answer NEW. Fallback: Ask Callback always advances.

ESCALATION: SEO pitched + still objecting → softer Ask Callback. SEO + callback asked + still hesitant → Respect Decline.

FACTS: Read ESTABLISHED FACTS; never ask about things already known. Identity: always "local website designers", never "digital marketing company".

FRUSTRATION: "repeating", "already said that", "going in circles", "not answering", "runaround", "waste of time" → During conversion: Sign Off. Before conversion: acknowledge + Ask Callback.`;


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
      suggestion: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all."
    },
    objection: {
      heading: 'Handle Objection',
      stage: 'OBJECTION_HANDLING',
      suggestion: "Would you mind if Bob gives you a quick call later to talk about what we can do for your website?"
    },
    closing: {
      heading: 'Ask Callback',
      stage: 'CLOSING',
      suggestion: 'Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?'
    },
    conversion: {
      heading: 'Confirm Callback',
      stage: 'CONVERSION',
      suggestion: "Perfect. And your name is? Bob or his partner can give you a call later today — when's the best time to reach you?"
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
