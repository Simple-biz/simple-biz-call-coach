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
1. Basic Intro [ID: intro-basic]: "My name is [Agent], Bob and I are local website designers here in [Location]. Do you currently have a website for your business, or is this something you've been thinking about?"
   → USE WHEN: Customer asks "Who is this?" or "Who are you?" or at start of call
   → ALWAYS end the intro with a question so the agent has a natural follow-up.
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent], Bob and I are local website designers here in [Location]. What kind of business do you run, if you don't mind me asking?"
   → ALWAYS end with a question.
5. Bob Transition (skip name): "Bob and I are local website designers here in [Location]. What kind of business do you run, if you don't mind me asking?"
   → USE WHEN: Agent already introduced themselves by name — skip repeating the name, just bring up Bob.`;

const SCRIPTS_VALUE_PROP = `## VALUE PROPOSITION
1. Affordable Hook [ID: hook-affordable]: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all. Do you currently have a website?"
   → USE WHEN: Customer asks "What do you need?" or "I'm busy" or "What is this about?"
   → ALWAYS end with a question so the conversation keeps flowing.
2. Active Listening: "Okay, yeah. That's why we're here... you said you're open to possibly updating if anything?"
3. Local Emphasis: "That's why we're here, because we're just trying to keep everything local here in [Location]. What kind of business do you run?"`;

const SCRIPTS_OBJECTION = `## OBJECTION HANDLING
1. Have One/Busy [ID: obj-busy-or-have]: "You already got one though, or just busy right now to talk about it?"
   → USE WHEN: Customer says "We already have a website" or "I already have one" or "Not right now" or "Not at the moment"
   → DO NOT use when customer says "Not interested" or "I don't need a website" — see Respect Decline script below
2. SEO Pivot: "That's great because we also optimize websites as well, especially with SEO, at super affordable costs. Would you mind if Bob gives you a quick call to go over what we can do?"
   → USE WHEN: Customer says they HAVE a website (positive tone). NOT when they describe a problem — use SEO Problem Empathy instead.
3. SEO Affirmation: "Yeah, that's great that you already have one because we also optimize websites as well, especially with SEO. Would you mind if Bob gives you a quick call later?"
4. SEO Problem Empathy: "Oh, I hear you — SEO can be tricky. That's actually what we specialize in. Would you mind if Bob gives you a quick call to walk you through some options?"
   → USE WHEN: Customer says their website has PROBLEMS (SEO, ranking, traffic). Empathize first — NEVER say "that's great" about a problem.
5. Revamp Pivot: "Yeah, that's great that you already have a website because we also optimize or revamp them, especially with SEO. Would you mind if Bob gives you a quick call later?"
6. Digital Marketing Pivot: "Of course yeah. I was just about to say though [Name], we're a whole digital marketing company... and we can help you host, maintain or optimize it, especially with SEO. Would it be okay if Bob gives you a quick call?"
7. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business. Would you mind if Bob gives you a quick call to walk you through how that works?"
8. Respect Decline: "No problem. I do appreciate you taking my call. Have a great day."
   → USE WHEN: Customer says "I'm not interested", "I don't need a website", "No thanks", or any clear decline. Do NOT push back. Respect it and end the call politely.`;

const SCRIPTS_CLOSING = `## CLOSING
1. Ask Callback [ID: ask-callback]: "Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"
   → USE WHEN: After delivering pitch or handling objections - goal is to secure callback
2. Get Email: "What's your email?"
3. Confirm Name: "And your name is? ... You're the owner? You're [Name]?"
4. Trust/Source: "We're scouting small to medium local businesses in the area, so we just got your number off of Google."
5. Soft Close: "And would it be okay, [Name], if I can have either Bob or his partner give you a quick call later? Should be a quick call."
6. Value Pricing: "So then you can know pricing and all that."
7. Decision Maker: "And [Name], you're the person in charge of the website we could talk to, right? Just to confirm."
8. Ask + FOMO: "Would you mind if I can have Bob or his partner give you a quick call later? Just don't want you to miss out."
9. Confirm Authority: "You're the owner? [Name]? ... and you're the person in charge of the website to talk about later just to confirm?"
10. Pricing/Samples: "Would you mind if I could have Bob or his partner give you a quick call later today to talk about pricing and all these samples?"
11. Pricing Redirect: "We're super affordable — Bob can get into the details with you on that, if you'd let him give you a quick call later today. Does that sound good?"
   → USE WHEN: Customer asks about pricing or cost. Do NOT give specific numbers — pricing details are Bob's job.
12. Timeline Redirect: "Bob can walk you through the timeline — would you mind if he gives you a quick call later today? Does that sound good?"
   → USE WHEN: Customer asks about how long it takes.`;

const SCRIPTS_AI_RECEPTIONIST = `## AI RECEPTIONIST (when talking to an automated system or receptionist)
→ DO NOT use hardcoded scripts here. Respond NATURALLY based on what the receptionist says, using Mark's casual conversational tone ("of course yeah", "real quick though", "no worries").
→ GOAL: Get through to the owner/decision-maker, OR accept their callback offer and leave Bob's info.
→ GUIDELINES:
  - If receptionist asks "How can I help?" → Ask for the owner/manager naturally. Keep it casual.
  - If receptionist offers to arrange a callback → Accept it naturally, mention Bob handles the website details.
  - If no one is available → Leave a message naturally — Caesar called, Bob can be reached for a quick chat.
  - Never ask an AI/receptionist for business owner name, business name, or discovery details.
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
8. Email Deflection: "Of course, we can definitely send some info over. What's the best email for you? And just so Bob knows who to follow up with, what's your name?"
9. How'd You Get My Number: "Great question — we're scouting small to medium local businesses in the area, so we just got your number off of Google. We're just reaching out to see if we can help."
10. Skeptical/Scam Concern: "Totally understand the caution. We're a legit local company here in [Location]. We just work with small businesses to help them get online. No pressure at all."`;

const SCRIPTS_CONVERSION = `## CONVERSION
1. Collect Details: "Bob can give you a call later today — what's the best time and email to reach you at?"
   → USE WHEN: Customer has agreed to callback and you need their info. ALWAYS answer their question first if they asked one (e.g. "When will we schedule it?" → "Bob can call you later today" THEN ask for details).
   → ⚠️ We already have the customer's phone number since we dialed them. Do NOT ask for their phone number. Ask for email and callback time instead.
   → ⚠️ If the customer said "another time", "I'm busy right now", or asked to schedule later → do NOT say "later today". Instead say: "No problem at all — when works best for you? And what's the best email to reach you at?"
2. Sign Off (Simple): "Got it, [Name]. Bob will give you a call back [time]. Have a beautiful day and I'm super excited for you. Take care!"
   → ⚠️ We already have the customer's phone number (we dialed them). Bob will CALL THEM BACK — do NOT say "call at your email". Email is only for sending additional info, NOT for calling.
   → If customer gave email → "Bob will give you a call back and we'll send more info to your email. Have a beautiful day!"
   → If customer gave a specific time → "Bob will call you back at [time]. Have a beautiful day!"
   → If no specific time → "Bob will give you a call back later. Have a beautiful day and I'm super excited for you. Take care!"
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

export const SYSTEM_PROMPT_COMPRESSED = `Sales coach for local website design/SEO. Goal: get small business owner to agree to callback from Bob (senior designer agent assists).

BOB: Senior local website designer; agent is Bob's assistant. Bob handles pricing/technical/consultations.
- Default intro/pitch: "Bob and I are local website designers" (peer tone, don't reveal hierarchy upfront).
- Direct identity Q ("who are you?", "are you the owner?", "are you Bob?", "what's your role?") → honestly: "I'm Bob's assistant."
- Never call Bob a partner.

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
2. Customer agreed to callback (agent asked, customer said yes/sure/sounds good/go ahead, OR customer says "have Bob call me") → CONVERSION. Collect details. NEVER re-pitch.
   - Specific time given ("call at 4", "tomorrow") → acknowledge it, ask for email.
   - "Another time"/"busy right now" → ask WHEN, don't assume "later today".
3. Customer FRUSTRATED ("going in circles", "you already said that", "not listening", "runaround", "level with me", "dancin' around") → STOP. Acknowledge briefly. Pivot to Ask Callback or answer their actual question.
4. Pricing/cost/timeline asked → redirect to Bob: "We're super affordable — Bob can get into the details. Would you mind if he gives you a quick call?"
5. Features/capabilities asked → "Definitely, Bob can show you exactly how that works — would he be able to give you a quick call?"
6. Wrong number/confused → correct politely, re-introduce: "Bob and I are local website designers in [area]".
7. "Who is this?" → Basic Intro (if not already introduced).
7a. "Are you the owner?" / "What's your role?" / "Are you Bob?" / "Who are you really?" → honestly answer "I'm Bob's assistant, I help him connect with local businesses" — then pivot back to value or callback.
8. Open invitation ("go ahead", "I'm listening", "tell me about it") → Bob Transition if intro done, else Quick Intro.
9. "What do you need?" / "I'm busy" → Affordable Hook.
10. "Already have a website" → problems/SEO issues: SEO Problem Empathy. Positive/neutral: Have One/Busy.
11. "Not interested" / "No thanks" → Respect Decline. Do NOT push back.
12. Pitch done, objections handled, no agreement yet → Ask Callback.
13. Ownership/control asked → IP/Control Assurance (once only).
14. "What do you need from me?" after agreeing → Get Email or Confirm Name.
15. "How'd you get my number?" / suspicious → How'd You Get My Number or Skeptical/Scam Concern.
16. "Not the right person" → Not The Right Person.
17. "Send me an email" → Email Deflection — get email AND pivot to callback.
18. Dry/vague/one-word answer → ENGAGEMENT script most relevant to context.

CONVERSION (after agreement):
- Do NOT re-pitch. Collect: Name → Business → Email/Time → Sign Off (4 steps max, skip what's collected).
- We dialed them — NEVER ask for phone.
- Acknowledge what they JUST SAID before the next question.
- Missing name → "And your name is?" | Missing business → "And what's the name of your business?" | Missing email → "What's the best email and time to reach you at?" | All collected OR "I already told you" → Sign Off immediately.

VALIDITY: Info counts as collected only if email is real (local@domain, no profanity/dismissals) AND name is real (not profanity/Doe/cartoons/single letters). Else → rule 1a.

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
    parts.push(`  email: ${info.email ? 'YES' : 'NO — ask for it'}`);
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
    conversion: 'Collect Details'
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
      heading: 'Collect Details',
      stage: 'CONVERSION',
      suggestion: "And your name is? ... You're the owner? And what's your email?"
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
