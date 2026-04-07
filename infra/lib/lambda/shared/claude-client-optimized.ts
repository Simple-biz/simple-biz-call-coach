// v4 — Haiku-only model, Bob Transition script
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

const MARKS_GOLDEN_SCRIPTS = `# MARK'S QUALITY SCRIPTS (27 PROVEN PATTERNS - CLEAN & INTENT-MATCHED)

## GREETING (4 scripts)
1. Basic Intro [ID: intro-basic]: "My name is [Agent], and my partner Bob and I are here; we're local website designers here in [Location]. Do you currently have a website for your business, or is this something you've been thinking about?"
   → USE WHEN: Customer asks "Who is this?" or "Who are you?" or at start of call
   → ALWAYS end the intro with a question so the agent has a natural follow-up.
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent], and my partner Bob and I are here; we're local website designers here in [Location]. What kind of business do you run, if you don't mind me asking?"
   → ALWAYS end with a question.
5. Bob Transition (skip name): "My partner Bob and I are local website designers here in [Location]. What kind of business do you run, if you don't mind me asking?"
   → USE WHEN: Agent already introduced themselves by name — skip repeating the name, just bring up Bob.

## VALUE PROPOSITION (3 scripts)
1. Affordable Hook [ID: hook-affordable]: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all. Do you currently have a website?"
   → USE WHEN: Customer asks "What do you need?" or "I'm busy" or "What is this about?"
   → ALWAYS end with a question so the conversation keeps flowing.
2. Active Listening: "Okay, yeah. That's why we're here... you said you're open to possibly updating if anything?"
3. Local Emphasis: "That's why we're here, because we're just trying to keep everything local here in [Location]. What kind of business do you run?"

## OBJECTION HANDLING (9 scripts)
1. Have One/Busy [ID: obj-busy-or-have]: "You already got one though, or just busy right now to talk about it?"
   → USE WHEN: Customer says "We already have a website" or "I already have one" or "Not right now" or "Not at the moment"
   → DO NOT use when customer says "Not interested" or "I don't need a website" — see Respect Decline script below
2. SEO Pivot: "That's great because we also optimize websites as well, especially with SEO, at super affordable costs. Would you mind if my partner Bob gives you a quick call to go over what we can do?"
   → USE WHEN: Customer says they HAVE a website (positive tone). NOT when they describe a problem — use SEO Problem Empathy instead.
3. SEO Affirmation: "Yeah, that's great that you already have one because we also optimize websites as well, especially with SEO. Would you mind if my partner Bob gives you a quick call later?"
4. SEO Problem Empathy: "Oh, I hear you — SEO can be tricky. That's actually what we specialize in. Would you mind if my partner Bob gives you a quick call to walk you through some options?"
   → USE WHEN: Customer says their website has PROBLEMS (SEO, ranking, traffic). Empathize first — NEVER say "that's great" about a problem.
5. Revamp Pivot: "Yeah, that's great that you already have a website because we also optimize or revamp them, especially with SEO. Would you mind if my partner Bob gives you a quick call later?"
6. Digital Marketing Pivot: "Of course yeah. I was just about to say though [Name], we're a whole digital marketing company... and we can help you host, maintain or optimize it, especially with SEO. Would it be okay if my partner Bob gives you a quick call?"
7. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. We believe in having it to all yourself and for your business. Would you mind if my partner Bob gives you a quick call to walk you through how that works?"
8. Respect Decline: "No problem. I do appreciate you taking my call. Have a great day."
   → USE WHEN: Customer says "I'm not interested", "I don't need a website", "No thanks", or any clear decline. Do NOT push back. Respect it and end the call politely.

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
11. Pricing Redirect: "We're super affordable — my partner Bob can get into the details with you on that, if you'd let him give you a quick call later today. Does that sound good?"
   → USE WHEN: Customer asks about pricing or cost. Do NOT give specific numbers — pricing details are Bob's job.
12. Timeline Redirect: "My partner Bob can walk you through the timeline — would you mind if he gives you a quick call later today? Does that sound good?"
   → USE WHEN: Customer asks about how long it takes.

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

## CONVERSION (4 scripts)
1. Collect Details: "Bob can give you a call later today — what's the best number and time to reach you at?"
   → USE WHEN: Customer has agreed to callback and you need their info. ALWAYS answer their question first if they asked one (e.g. "When will we schedule it?" → "Bob can call you later today" THEN ask for number).
   → ⚠️ If the customer said "another time", "I'm busy right now", or asked to schedule later → do NOT say "later today". Instead say: "No problem at all — when works best for you? And what's the best number to reach you at?"
2. Sign Off (Simple): "Bob will call you later at [time]. Thank you for your time, [Name]."
3. Sign Off (Options): "We'll get back to you later. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
4. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

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

⚠️ NAMES: Only people are the agent and Bob. NEVER invent names like "Sparkler".
⚠️ INTRO: If agent already said "This is [Name]" or "My name is [Name]" in the transcript → intro is DONE. Do NOT suggest any intro script.
⚠️ TONE: If customer describes a PROBLEM → empathize first. NEVER say "that's great" about a problem.

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
   → ⚠️ If customer gave a SPECIFIC TIME ("call tomorrow", "at 4pm", "after 5") → acknowledge the time: "Perfect, Bob will call you tomorrow at 4. What's the best number to reach you at?" Do NOT ignore the time they gave.
   → ⚠️ If customer said "another time", "I'm busy right now", or wants to schedule later WITHOUT giving a specific time → ask WHEN: "No problem at all — when works best for you?" Do NOT assume "later today".
3. ⚠️ Customer is FRUSTRATEDor says agent is repeating/not answering ("you're going in circles", "you keep saying the same thing", "you already said that", "I already told you", "I'm done", "you're not listening", "not answering my question", "dancin' around", "runaround", "you didn't answer", "straight answer", "level with me") → STOP everything. Do NOT repeat any previous script. Say something like: "I hear you, Ray, and I apologize for that." Then pivot DIRECTLY to Ask Callback. If customer is ALSO asking a question → briefly acknowledge it and redirect to Bob.
4. Customer asks about PRICING, COST, or TIMELINE → Always redirect to Bob in ONE smooth sentence that flows into the callback ask: "We're super affordable — my partner Bob can get into the details with you on that, if you'd let him give you a quick call later today. Does that sound good?" Do NOT give specific pricing numbers — that's Bob's job. If customer pushes again: "I totally understand. Bob handles all the pricing and he'll be straight with you — would it work if he calls you today?"
5. Customer asks about specific FEATURES or CAPABILITIES ("can you do online booking?", "does it sync with Instagram?", "can you add a form?") → Acknowledge briefly, then smoothly transition into the callback ask in ONE natural sentence: "Definitely, my partner Bob can show you exactly how that works — would you mind if he gives you a quick call later today? Does that sound good?"
6. Customer CONFUSES the call with someone else ("is this about my order?", "are you the delivery guy?", "is this the supplier?", mistakes the agent for someone else) → Do NOT hang up or say wrong number. Politely CORRECT them and re-introduce: "Oh no, this isn't about that — this is Caesar from Simple.Biz. We're local website designers. Do you have a quick minute?" Then continue normally.
7. Customer asks "Who is this?" or "Who are you?" → If agent already said their name (check INTRO rule above), skip intro. Otherwise USE: Basic Intro [ID: intro-basic]
8. Customer says "Tell me about it", "Go ahead", "Sure, what is it?", "What do you wanna talk about?", "I'm listening", or gives an OPEN INVITATION early in the call → If agent already introduced themselves by name → use Bob Transition (skip name). If agent hasn't introduced AND hasn't mentioned Bob → use Quick Intro. If Bob already mentioned → ask engagement question ("What kind of business do you run, if you don't mind me asking?").
9. Customer asks "What do you need?" or "I'm busy" or "What is this about?" → USE: Affordable Hook [ID: hook-affordable]
10. Customer says "We already have a website" or "I already have one" → If they mention PROBLEMS (SEO, ranking, traffic, inactive) → USE: SEO Problem Empathy. If positive/neutral → USE: Have One/Busy [ID: obj-busy-or-have]
11. Customer says "I'm not interested", "I don't need a website", "No thanks" → USE: Respect Decline ("No problem. I do appreciate you taking my call. Have a great day.") — Do NOT push back. Respect their decision and end the call politely.
12. After agent delivered pitch AND handled objections AND customer has NOT yet agreed → USE: Ask Callback [ID: ask-callback]
13. Customer asks about ownership/control → USE: IP/Control Assurance — but ONLY ONCE. If you already answered this, do NOT repeat it.
14. Customer asks "what do you need from me?" or "do you need my details?" after agreeing → USE: Get Email or Confirm Name
15. Customer asks "How'd you get my number?" or sounds suspicious → USE: How'd You Get My Number or Skeptical/Scam Concern
16. Customer says "I'm not the right person" or "Talk to someone else" → USE: Not The Right Person
17. Customer says "Just send me an email" or "Send me info" → USE: Email Deflection — get their email AND pivot to callback
18. Customer gives a DRY, SHORT, or VAGUE response ("yeah", "okay", "I don't know", "maybe", "hmm", "I guess", "not sure", one-word answers) → USE: An ENGAGEMENT script. Pick the one most relevant to the conversation context.

CRITICAL - AI ASSISTANT / RECEPTIONIST DETECTION:
- Signs of AI/receptionist: "I'm here to help", "How can I assist you", "I can arrange someone", "I can have someone return your call", "Could you provide your number", robotic/scripted phrasing, asking for your callback number
- If they OFFER to have someone call you back → ACCEPT IT. Say: "Yes, that would be great. Have them call Bob at [number]. He handles all the website details."
- If it's voicemail → Leave a brief message with Bob's number
- DO NOT keep pitching to an AI. DO NOT use Ask Callback (that's for humans). Just accept their offer and give Bob's contact info.
- DO NOT treat automated deflection as objection or existing website claim

STAGE DETERMINATION:
- ⚠️ If Stage field says CONVERSION → The customer already agreed. Do NOT downgrade to CLOSING or re-pitch.
  - CONVERSION flow: Ask Name → Ask Business Name → Ask Number/Email → Sign Off. That's it. 4 steps max.
  - ⚠️ CHECK the "COLLECTED INFO" section in the prompt. It tells you what the agent HAS and HAS NOT collected yet.
  - If customerName is NOT collected → Ask for their name FIRST using Confirm Name: "And your name is?"
  - If customerName IS collected but businessName is NOT → Ask: "And what's the name of your business?"
  - If both name and business are collected but no number/email → USE Collect Details: "What's the best number and time to reach you at?"
  - If ALL info is collected (name, business, phone/email) → Go straight to Sign Off. Do NOT ask for anything else.
  - ⚠️ If email is YES in COLLECTED INFO → Do NOT ask for email again. Move to Sign Off.
  - ⚠️ If phoneNumber is YES in COLLECTED INFO → Do NOT ask for phone again. Move to Sign Off or ask for email only if missing.
  - If customer already stated their name (e.g. "It's Maria", "My name is...") → do NOT ask for name again. Move to next detail.
  - If customer already gave callback time (e.g. "call after 4", "this afternoon") → do NOT ask when to call. Move to Sign Off.
  - If customer says "I already said yes", "I already gave you that", "I already told you" → USE Sign Off IMMEDIATELY.
  - ⚠️ ALSO read the transcript — if the customer just gave info (phone, email, name) in their LATEST message, acknowledge it and move to the NEXT step, do NOT re-ask what they just said.
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
- Customer: "Is there pricing?" → "Of course. We're super affordable. My partner Bob can get into the details with you on that. Would you mind if he gives you a quick call?"
- Customer: "I already have a website" → "That's great. We actually also optimize websites as well, especially with SEO, at super affordable costs."
- Customer: "My nephew does it" → "That's great that you got someone handling it. We also optimize or revamp websites, especially with SEO."
- Customer: "Can you do online booking?" → "Definitely. My partner Bob can get in depth with you on that. Would you mind if he gives you a quick call?"
- Customer: "How much does it cost?" → "We're super affordable. My partner Bob can get into the details with you on pricing. Would a quick call work?"
- Customer: "How'd you get my number?" → "Great question. We're scouting small to medium local businesses in the area, so we just got your number off of Google."
- Customer: "I got burned before" → "I'm sorry to hear that. We definitely let our clienteles get full control of their own website. We believe in having it all to yourself."

BAD (too specific — agent shouldn't give details):
- "Most of our sites run a few hundred to maybe a thousand" → DON'T give pricing numbers
- "Yes our platform pulls Instagram feeds and handles scheduling" → DON'T answer technical questions in detail

GOOD (redirect to Bob):
- "We're super affordable. My partner Bob can get into the details with you on that."
- "Definitely. My partner Bob can get in depth with you on that. Would a quick call work?"

- Replace [Name] with customer's actual name, [Location] with actual city if known.
- Remove scripted filler words: "uh", "uhm", "ah" — but DO use natural conversational words like "oh yeah", "of course", "that's great" to sound human.
- Do NOT write full custom paragraphs. Keep the acknowledgment SHORT, then let the golden script do the work.
- Do NOT give specific pricing numbers, timelines, or technical feature details — those are ALL Bob's job. The agent redirects to Bob for anything detailed.
- Keep the value prop simple: "We're super affordable, just don't want you to miss out at all."
- ⚠️ EVERY tip MUST end with a QUESTION or a callback ask. Never leave the agent with a dead-end statement.
- ⚠️ If the customer ASKS a question ("when will we schedule?", "what's your website?", "how does this work?"), your script MUST acknowledge/answer their question FIRST, then flow into the golden script. Do NOT ignore what they just asked. The agent should always have something to say next after delivering the script. If the script doesn't end with a question, ADD one (e.g. "Do you currently have a website?" or "Would a quick call work?").
- Goal: Build rapport → secure callback agreement

⚠️ ANTI-REPETITION (CRITICAL — READ THIS):
- Check the "ALREADY SUGGESTED" list in the prompt. You MUST NOT output any script that appears there.
- Check what the AGENT has already said in the transcript. If the agent already covered a topic (ownership, SEO, affordability), do NOT cover it again.
- If the agent already INTRODUCED THEMSELVES ("This is [name] from Simple.Biz", "My name is...") → do NOT suggest Basic Intro or Quick Intro again. The intro is DONE. Move to the next step (value prop, engagement question, etc.).
- If the agent already used IP/Control Assurance → the ownership question is ANSWERED. Move on.
- If the agent already used Pricing/Samples → move to Pricing Redirect or Ask Callback. Not the same script.
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

  // Always use Haiku — fast, cheap, and handles our prompt well
  const model = HAIKU_MODEL;

  try {
    // Ultra-compressed user prompt
    const userPrompt = buildCompressedPrompt(request);

    const anthropic = await getAnthropicClient();
    const response = await anthropic.messages.create({
      model,
      max_tokens: 150, // Tips are ~50-80 tokens; lower = faster generation
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

export async function generateAITipStreaming(
  request: AITipRequest,
  onChunk: (delta: string) => Promise<void>
): Promise<AITipResponse> {
  const startTime = Date.now();
  const model = HAIKU_MODEL;

  try {
    const userPrompt = buildCompressedPrompt(request);
    const anthropic = await getAnthropicClient();

    let fullText = '';

    const stream = anthropic.messages.stream({
      model,
      max_tokens: 150,
      temperature: 0.3,
      system: [
        {
          type: 'text' as const,
          text: SYSTEM_PROMPT_COMPRESSED,
          cache_control: { type: 'ephemeral' as const }
        },
        {
          type: 'text' as const,
          text: MARKS_GOLDEN_SCRIPTS,
          cache_control: { type: 'ephemeral' as const }
        }
      ],
      messages: [
        { role: 'user' as const, content: userPrompt }
      ]
    });

    // Use for-await to properly handle async onChunk (sendToConnection)
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullText += text;
        try {
          await onChunk(text);
        } catch (err) {
          console.error('[Claude Stream] Error sending chunk:', err);
        }
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

  } catch (error: any) {
    console.error('[Claude Stream] API Error:', error);
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

  // Include collected info so Claude knows what's missing during CONVERSION
  if (request.collectedInfo) {
    const info = request.collectedInfo;
    parts.push(`\nCOLLECTED INFO (what the agent has/hasn't gathered):`);
    parts.push(`  customerName: ${info.customerName ? 'YES' : 'NO — ask for it'}`);
    parts.push(`  businessName: ${info.businessName ? 'YES' : 'NO — ask for it'}`);
    parts.push(`  phoneNumber: ${info.phoneNumber ? 'YES' : 'NO'}`);
    parts.push(`  email: ${info.email ? 'YES' : 'NO'}`);
  }

  // Include recent conversation (last 10-15 messages with speaker labels)
  // This gives Claude proper context to understand the conversation flow
  if (request.recentTranscript) {
    parts.push(`\nRecent Conversation:\n${request.recentTranscript.substring(0, 1800)}`);
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
      suggestion: "Would you mind if my partner Bob gives you a quick call later to talk about what we can do for your website?"
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
