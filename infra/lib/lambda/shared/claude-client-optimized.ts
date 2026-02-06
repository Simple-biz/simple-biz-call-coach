import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
});

const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20250929';
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || 'claude-sonnet-4-5-20250929';

// Performance targets
const MAX_LATENCY_MS = 2000; // CEO requirement: <3s total, budget 2s for Claude
const CACHE_HIT_TARGET = 0.90; // 90% cache hit rate

export interface AITipRequest {
  conversationId: string;
  callStage: 'greeting' | 'discovery' | 'objection' | 'closing';
  recentTranscript: string;
  conversationSummary?: string;
  transcriptCount?: number;
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
1. Basic Intro [ID: intro-basic]: "My name is [Agent], and Bob and I are here; we're local website designers here in [Location]."
   → USE WHEN: Customer asks "Who is this?" or "Who are you?" or at start of call
2. Familiar Opener: "Good morning again, can you hear me okay?"
3. Targeted Opener: "Good morning, is [Name] available please?"
4. Quick Intro: "Real quick though, my name is [Agent], and Bob and I are here; we're local website designers here in [Location]."

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

## CONVERSION (2 scripts)
1. Sign Off (Options): "We'll get back to you later. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
2. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

// ============================================================================
// ULTRA-COMPRESSED SYSTEM PROMPT (OPTIMIZED FOR SPEED)
// ============================================================================

const SYSTEM_PROMPT_COMPRESSED = `Sales coach for local digital services (SEO/web design). Target: small business owners. Goal: Get customer to agree to callback from Bob/partner.

YOUR TASK: Analyze recent transcript and select the SINGLE BEST script from Mark's library based on customer intent and conversation stage.

OUTPUT FORMAT (exactly):
[HEADING]: 2-word title (e.g., "Intro", "Ask Callback")
[STAGE]: One of GREETING, VALUE_PROP, OBJECTION_HANDLING, CLOSING, CONVERSION
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
1. Customer is AI assistant/voicemail (says "I'm Delta's AI", "Leave a message", "Press 1 for", etc.) → USE: Quick Intro [ID: intro-basic] and suggest asking for human/callback
2. Customer asks "Who is this?" or "Who are you?" → USE: Basic Intro [ID: intro-basic]
3. Customer asks "What do you need?" or "I'm busy" or "What is this about?" → USE: Affordable Hook [ID: hook-affordable]
4. Customer says "We already have a website" or "I already have one" or "Not interested" → USE: Have One/Busy [ID: obj-busy-or-have]
5. After agent delivered pitch AND handled objections → USE: Ask Callback [ID: ask-callback]
6. Customer agrees to callback → USE: Get Email or Confirm Name
7. Customer asks about ownership/control → USE: IP/Control Assurance

CRITICAL - AI ASSISTANT DETECTION:
- If customer says "I'm [Company]'s AI assistant" or "Leave a message" or similar automated responses
- Agent should acknowledge and ask for callback: "Would you mind if I can have Bob or his partner give you a quick call later?"
- DO NOT treat automated deflection as objection or existing website claim

STAGE DETERMINATION (Analyze transcript to determine current stage):
- GREETING: First 1-2 exchanges, no pitch given yet
- VALUE_PROP: Intro done, customer asking what you want, pitch not fully delivered
- OBJECTION_HANDLING: Customer expressed resistance/objection/has existing solution
- CLOSING: Pitch delivered, objections handled, time to ask for callback
- CONVERSION: Customer agreed to callback, finalizing details

CONTEXT-AWARE PERSONALIZATION:
- Keep 80%+ of Mark's proven wording EXACTLY as written
- Make MINOR adjustments ONLY for:
  1. Customer name (if mentioned in transcript, replace [Name] with their actual name)
  2. Emotion awareness (if customer sounds frustrated: add brief acknowledgment / if excited: match energy)
  3. Location (replace [Location] with actual city if known)
- Remove ALL filler words: "uh", "uhm", "ah", "you know", "I mean", "Oh", "Oh okay", "Oh yeah"
- Keep natural flow - sound conversational, not robotic
- Goal: Build rapport → secure callback agreement`;


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
    return getFallbackOptions(request.callStage, Date.now() - startTime);
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
    parts.push(`\nRecent Conversation:\n${request.recentTranscript.substring(0, 800)}`);
  }

  // Include summary for additional context
  if (request.conversationSummary) {
    parts.push(`\nSummary: ${request.conversationSummary.substring(0, 300)}`);
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
    closing: 'Ask Callback'
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
