import Anthropic from '@anthropic-ai/sdk';
import { getSecret } from './secrets-client';

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
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || 'claude-sonnet-4-5-20250929';

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

const MARKS_GOLDEN_SCRIPTS = `# MARK'S QUALITY SCRIPTS (27 PROVEN PATTERNS - CLEAN & INTENT-MATCHED)

## GREETING (4 scripts)
1. Basic Intro [ID: intro-basic]: "My name is [Agent], and my partner Bob and I are here; we're local website designers here in [Location]."
   → USE WHEN: Customer asks "Who is this?" or "Who are you?" or at start of call
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent], and my partner Bob and I are here; we're local website designers here in [Location]."

## VALUE PROPOSITION (3 scripts)
1. Affordable Hook [ID: hook-affordable]: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all."
   → USE WHEN: Customer asks "What do you need?" or "I'm busy" or "What is this about?"
2. Active Listening: "Okay, yeah. That's why we're here... you said you're open to possibly updating if anything?"
3. Local Emphasis: "That's why we're here, because we're just trying to keep everything local here in [Location]."

## OBJECTION HANDLING (8 scripts)
1. Have One/Busy [ID: obj-busy-or-have]: "You already got one though, or just busy right now to talk about it?"
   → USE WHEN: Customer says "We already have a website" or "I already have one" or "Not interested"
2. SEO Pivot: "That's great because we also optimize websites as well, especially with SEO, at super affordable costs."
3. SEO Affirmation: "Yeah, that's great that you already have one because we also optimize websites as well, especially with SEO."
4. Revamp Pivot: "Yeah, that's great that you already have a website because we also optimize or revamp them, especially with SEO."
5. Digital Marketing Pivot: "Of course yeah. I was just about to say though [Name], we're a whole digital marketing company... and we can help you host, maintain or optimize it, especially with SEO."
6. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business."

## CLOSING (11 scripts)
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
11. Pricing Ballpark: "We keep it super affordable — most of our sites run just a few hundred, not thousands. Bob can give you the exact number for your situation. Would a quick call work?"
   → USE WHEN: Customer pushes for a specific number after the first pricing redirect.
12. Timeline Ballpark: "Most sites are up and running in just a couple weeks. Bob can give you the exact timeline based on what you need. Would a quick call work?"
   → USE WHEN: Customer asks how long it takes or pushes for a timeline.

## AI RECEPTIONIST (when talking to an automated system or receptionist)
→ DO NOT use hardcoded scripts here. Respond NATURALLY based on what the receptionist says, using Mark's casual conversational tone ("of course yeah", "real quick though", "no worries").
→ GOAL: Get through to the owner/decision-maker, OR accept their callback offer and leave Bob's info.
→ GUIDELINES:
  - If receptionist asks "How can I help?" → Ask for the owner/manager naturally. Keep it casual.
  - If receptionist offers to arrange a callback → Accept it naturally, mention Bob handles the website details.
  - If no one is available → Leave a message naturally — Caesar called, Bob can be reached for a quick chat.
  - Match their energy. If they're formal, be polite. If they're casual, be casual.
  - Keep it SHORT. Don't pitch the receptionist — they're not the decision-maker.

## ENGAGEMENT (follow-up questions for dry/short/unclear responses)
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
10. Skeptical/Scam Concern: "Totally understand the caution. We're a legit local company here in [Location]. We just work with small businesses to help them get online. No pressure at all."

## CONVERSION (2 scripts)
1. Sign Off (Options): "We'll get back to you later. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
2. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

// ============================================================================
// ULTRA-COMPRESSED SYSTEM PROMPT (OPTIMIZED FOR SPEED)
// ============================================================================

const SYSTEM_PROMPT_COMPRESSED = `Sales coach for local digital services (SEO/web design). Target: small business owners. Goal: Get customer to agree to callback from the agent's partner Bob.

IMPORTANT CONTEXT: Bob is the agent's PARTNER — when referring to Bob, always say "my partner Bob" or "Bob, my partner" naturally. Bob is not a stranger or separate company. He's the agent's business partner who handles the technical side, pricing details, and client consultations.

YOUR TASK: Analyze recent transcript and select the SINGLE BEST script from Mark's library based on customer intent and conversation stage.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title (e.g., "Intro", "Ask Callback")
[STAGE]: One of GREETING, VALUE_PROP, OBJECTION_HANDLING, CLOSING, CONVERSION, ENGAGEMENT, SIGNOFF
[CONTEXT]: One sentence explaining why (optional)
[SCRIPT]: ONLY the exact script text - NO rationale, NO explanation, NO value proposition text

⚠️ CRITICAL - READ CAREFULLY:
1. [SCRIPT] must contain ONLY the spoken words that the agent should say
2. DO NOT include "Rationale:", "Value proposition:", "Explanation:", "Benefits:", "Key observations:", or ANY explanatory text after the script
3. DO NOT explain WHY you chose this script
4. DO NOT add commentary about the script's effectiveness
5. STOP writing immediately after the closing quote of the script
6. If you include ANY text after the script, you have FAILED this task

CORRECT OUTPUT:
[SCRIPT]: "Would you mind if I can have Bob or his partner give you a quick call later?"

WRONG OUTPUT (DO NOT DO THIS):
[SCRIPT]: "Would you mind if I can have Bob or his partner give you a quick call later?" Rationale: ...
[SCRIPT]: "Would you mind if I can have Bob or his partner give you a quick call later?" The script is perfectly aligned...

CUSTOMER INTENT MATCHING RULES (PRIORITY ORDER):
1. Customer is AI assistant/receptionist/voicemail (says "I'm here to help", "How can I assist you", "I'm Delta's AI", "Leave a message", "Press 1 for", "I can arrange someone", "I can have someone return your call", robotic/scripted responses) →
   - If the AI receptionist OFFERS to arrange a callback from their team ("Can I get your number?", "I can have someone call you back") → ACCEPT IT. Give Bob's number. Say: "Yes, that would be great. You can have them call Bob at [Bob's number]. He's the best person to talk to about the website."
   - If it's voicemail or generic AI → USE: Quick Intro [ID: intro-basic] and suggest asking for human/callback
   - DO NOT keep pitching to an AI receptionist. Get through to the human or accept their callback offer.
2. ⚠️ HIGHEST PRIORITY — Customer has AGREED to callback, BUT ONLY if the agent ALREADY ASKED for one. Agreement means:
   - The agent asked "Would you mind if Bob calls you?" or similar callback request
   - AND the customer responded positively: "yes", "sure", "sounds good", "okay", "go ahead", "that works"
   - OR the customer proactively says: "have Bob call me", "call me back", "they can call me", "have them call"
   - ⚠️ A casual "yeah" or "okay" at the START of a call (e.g. "yeah I have a minute") is NOT callback agreement — it's just the customer being polite. Only count it as agreement if it's clearly in response to a callback ask.
   → When truly agreed: switch to CONVERSION. Collect details. NEVER re-pitch.
3. ⚠️ Customer is FRUSTRATED or says agent is repeating/not answering ("you're going in circles", "you keep saying the same thing", "you already said that", "I already told you", "I'm done", "you're not listening", "not answering my question", "dancin' around", "runaround", "you didn't answer", "straight answer", "level with me") → STOP everything. Do NOT repeat any previous script. Say something like: "I hear you, Ray, and I apologize for that." Then pivot DIRECTLY to Ask Callback. If customer is ALSO asking a question → briefly acknowledge it and redirect to Bob.
4. Customer asks about PRICING, COST, or TIMELINE → First time: USE Pricing/Samples or Value Pricing + Ask Callback. If customer pushes again: USE Pricing Ballpark ("few hundred, not thousands") or Timeline Ballpark ("couple weeks"). Do NOT dodge the same question more than once.
5. Customer asks about specific FEATURES or CAPABILITIES ("can you do online booking?", "do you do e-commerce?", "can you add a form?", "do you handle social media?") → Do NOT answer with an unrelated script. Acknowledge their question briefly, then redirect to Bob: "That's exactly the kind of thing Bob can walk you through — he handles all the technical details. Would a quick call work?"
6. Customer asks "Who is this?" or "Who are you?" → USE: Basic Intro [ID: intro-basic]
7. Customer asks "What do you need?" or "I'm busy" or "What is this about?" → USE: Affordable Hook [ID: hook-affordable]
8. Customer says "We already have a website" or "I already have one" or "Not interested" → USE: Have One/Busy [ID: obj-busy-or-have]
9. After agent delivered pitch AND handled objections AND customer has NOT yet agreed → USE: Ask Callback [ID: ask-callback]
10. Customer asks about ownership/control → USE: IP/Control Assurance — but ONLY ONCE. If you already answered this, do NOT repeat it.
11. Customer asks "what do you need from me?" or "do you need my details?" after agreeing → USE: Get Email or Confirm Name
12. Customer asks "How'd you get my number?" or sounds suspicious → USE: How'd You Get My Number or Skeptical/Scam Concern
13. Customer says "I'm not the right person" or "Talk to someone else" → USE: Not The Right Person
14. Customer says "Just send me an email" or "Send me info" → USE: Email Deflection — get their email AND pivot to callback
15. Customer gives a DRY, SHORT, or VAGUE response ("yeah", "I don't know", "maybe", "hmm", "I guess", "not sure", one-word answers) → USE: An ENGAGEMENT script. Pick the one most relevant to the conversation context.

CRITICAL - AI ASSISTANT / RECEPTIONIST DETECTION:
- Signs of AI/receptionist: "I'm here to help", "How can I assist you", "I can arrange someone", "I can have someone return your call", "Could you provide your number", robotic/scripted phrasing, asking for your callback number
- If they OFFER to have someone call you back → ACCEPT IT. Say: "Yes, that would be great. Have them call Bob at [number]. He handles all the website details."
- If it's voicemail → Leave a brief message with Bob's number
- DO NOT keep pitching to an AI. DO NOT use Ask Callback (that's for humans). Just accept their offer and give Bob's contact info.
- DO NOT treat automated deflection as objection or existing website claim

STAGE DETERMINATION:
- ⚠️ If Stage field says CONVERSION → The customer already agreed. Do NOT downgrade to CLOSING or re-pitch.
  - CONVERSION flow: Ask Name → Ask Number/Email → Sign Off. That's it. 3 steps max.
  - If customer already stated their name (e.g. "It's Maria", "My name is...") → do NOT ask for name again. Move to next detail or Sign Off.
  - If customer already gave callback time (e.g. "call after 4", "this afternoon") → do NOT ask when to call. Move to Sign Off.
  - If customer says "I already said yes", "I already gave you that", "I already told you" → USE Sign Off IMMEDIATELY.
- ⚠️ If Stage field says SIGNOFF → Output ONLY a Sign Off script. Example: "Got it, [Name]! Bob will call you [time]. Have a beautiful day and I'm super excited for you. Take care!"
- For all other stages, you MAY override if the transcript clearly shows a different stage:
  - GREETING: First 1-2 exchanges, no pitch given yet
  - VALUE_PROP: Intro done, customer asking what you want, pitch not fully delivered
  - OBJECTION_HANDLING: Customer expressed resistance/objection/has existing solution
  - CLOSING: Pitch delivered, objections handled, time to ask for callback
  - CONVERSION: Customer agreed. Collect info or sign off. NEVER go back.

SCRIPT SELECTION RULES:
- ALWAYS respond like a real person having a conversation — not a robot reading a script.
- Every response should have TWO parts:
  1. A SHORT natural acknowledgment (1 sentence, max 15 words) that shows you HEARD what the customer just said. Reference their actual words/question.
  2. Then the golden script that best fits the situation.
- The acknowledgment makes it feel like a real conversation. The golden script drives toward the callback.

EXAMPLES OF NATURAL FLOW:
- Customer: "Is there pricing?" → "Oh yeah, of course." + Pricing/Samples script
- Customer: "I already have a website" → "That's awesome." + SEO Pivot or Revamp Pivot
- Customer: "My nephew does it" → "That's great that you got someone handling it." + Revamp Pivot
- Customer: "I'm a plumber" → "Oh nice, we work with a lot of service businesses." + Ask Callback
- Customer: "Can you do online booking?" → "Yeah, that's definitely something we can set up." + redirect to Bob
- Customer: "How'd you get my number?" → "Great question." + Trust/Source script
- Customer: "I got burned before" → "Man, I'm sorry to hear that." + IP/Control Assurance

BAD (robotic — sounds like a script):
- Customer: "Is there pricing?" → "Would you mind if I can have Bob or his partner give you a quick call later?"
- Customer: "I have a website already" → "You already got one though, or just busy right now?"

GOOD (natural — sounds like a person):
- Customer: "Is there pricing?" → "Oh yeah, of course — we keep things super affordable. Would you mind if my partner Bob gives you a quick call to talk about pricing and all that?"
- Customer: "I have a website already" → "That's great! Yeah, we actually also optimize websites as well, especially with SEO, at super affordable costs."

- Replace [Name] with customer's actual name, [Location] with actual city if known.
- Remove scripted filler words: "uh", "uhm", "ah" — but DO use natural conversational words like "oh yeah", "of course", "that's great" to sound human.
- Do NOT write full custom paragraphs. Keep the acknowledgment SHORT, then let the golden script do the work.
- Goal: Build rapport → secure callback agreement

⚠️ ANTI-REPETITION (CRITICAL — READ THIS):
- Check the "ALREADY SUGGESTED" list in the prompt. You MUST NOT output any script that appears there.
- Check what the AGENT has already said in the transcript. If the agent already covered a topic (ownership, SEO, affordability), do NOT cover it again.
- If the agent already used IP/Control Assurance → the ownership question is ANSWERED. Move on. Do NOT repeat ownership scripts.
- If the agent already used Pricing/Samples → move to Pricing Ballpark or Ask Callback. Not the same script.
- If the customer has MOVED ON to a new question but you're still answering the old one → you are FAILING. Answer the NEW question.
- RULE: Read the customer's LATEST message. What are they asking RIGHT NOW? Answer THAT, not what they asked 3 messages ago.
- If you cannot find a different script → use Ask Callback as the universal fallback. It always advances the conversation.

⚠️ FRUSTRATION DETECTION:
- Frustrated phrases: "you're repeating", "you already said that", "I'm done", "going in circles", "not listening", "I already told you", "not answering", "didn't answer", "dancin' around", "runaround", "straight answer", "level with me", "same thing", "waste of time"
- If frustrated DURING CONVERSION: Sign Off IMMEDIATELY.
- If frustrated BEFORE CONVERSION: STOP. Acknowledge briefly ("I hear you, I apologize"). Then pivot to Ask Callback or the question they're actually asking.
- Do NOT respond to frustration by repeating the script that caused it.`;


// ============================================================================
// PERFORMANCE-OPTIMIZED CLAUDE API CALL
// ============================================================================

export async function generateAITip(request: AITipRequest): Promise<AITipResponse> {
  const startTime = Date.now();

  // Performance optimization: Use Haiku for 80% of cases (stages 1-3)
  const useHaiku = request.transcriptCount ? request.transcriptCount < 15 : true;
  const model = useHaiku ? HAIKU_MODEL : SONNET_MODEL;

  try {
    // Ultra-compressed user prompt
    const userPrompt = buildCompressedPrompt(request);

    const anthropic = await getAnthropicClient();
    const response = await anthropic.messages.create({
      model,
      max_tokens: 150, // Single script - reduced tokens
      temperature: 0.3, // Lower for consistency and speed
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT_COMPRESSED,
          cache_control: { type: 'ephemeral' }
        },
        {
          type: 'text',
          text: MARKS_GOLDEN_SCRIPTS,
          cache_control: { type: 'ephemeral' }
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

    console.log(`[Claude] Performance: ${latency}ms, Cache: ${(cacheHitRate * 100).toFixed(1)}%, Model: ${useHaiku ? 'Haiku' : 'Sonnet'}`);

    return {
      ...parsed,
      model: useHaiku ? 'haiku' : 'sonnet',
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
// HELPER FUNCTIONS
// ============================================================================

function buildCompressedPrompt(request: AITipRequest): string {
  // Optimized prompt with proper context window
  const parts: string[] = [
    `Stage: ${request.callStage}`,
    `Transcript Count: ${request.transcriptCount || 0}`
  ];

  // Include recent conversation (last 10-15 messages with speaker labels)
  // This gives Claude proper context to understand the conversation flow
  if (request.recentTranscript) {
    parts.push(`\nRecent Conversation:\n${request.recentTranscript.substring(0, 1200)}`);
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

function parseAITipResponse(text: string, callStage: string): Omit<AITipResponse, 'model' | 'latency' | 'cacheHitRate' | 'tokenMetrics'> {
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

function getFallbackSuggestion(stage: string, latency: number): AITipResponse {
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
      suggestion: "Oh okay. I mean, that's great because we also optimize websites as well, especially with SEO, at super affordable costs."
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
