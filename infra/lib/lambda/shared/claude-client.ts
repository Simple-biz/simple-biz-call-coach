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
  suggestion: string; // SINGLE suggestion (CEO requirement)
  model: 'haiku' | 'sonnet';
  latency: number;
  cacheHitRate: number;
  tokenMetrics: {
    cached: number;
    input: number;
    output: number;
  };
  stage: string;
}

// ============================================================================
// MARK'S GOLDEN SCRIPTS - OPTIMIZED FOR CACHING
// ============================================================================

const MARKS_GOLDEN_SCRIPTS = `# MARK'S QUALITY SCRIPTS (28 PROVEN PATTERNS)

## GREETING (6 scripts)
1. Audio Check: "Good morning, can you hear me okay?"
2. Basic Intro: "My name is [Agent], and Bob and I are here; we're local website designers here in [Location]."
3. Familiar Opener: "Good morning again, can you hear me okay?"
4. Targeted Opener: "Good morning, is [Customer Name] available please?"
5. Quick Intro: "Real quick though, my name is [Agent], and Bob and I are here; we're local website designers here in [Location]."

## VALUE PROPOSITION (3 scripts)
1. Affordable Hook: "We're just wondering if you're interested in building or updating your website, since we're super affordable. Just don't want you to miss out at all."
2. Active Listening: "Oh, okay, yeah. I mean, that's why we're here... I mean, you said you're open to possibly updating if anything?"
3. Local Emphasis: "I mean, that's why we're here, because we're just trying to keep everything local here in [Location]."

## OBJECTION HANDLING (8 scripts)
1. Have One/Busy: "Oh, you already got one though, or just busy right now to talk about it?"
2. SEO Pivot: "Oh okay. I mean, that's great because we also optimize websites as well, especially with SEO, at super affordable costs."
3. SEO Affirmation: "Yeah, I mean, that's great that you already have one because we also optimize websites as well, especially with SEO."
4. Revamp Pivot: "Oh yeah, I mean, that's great that you already have a website because we also optimize or revamp them, especially with SEO."
5. Digital Marketing Pivot: "Of course yeah. I mean, I was just about to say though [Name], we're a whole digital marketing company... and we can help you host, maintain or optimize it, especially with SEO."
6. IP/Control Assurance: "Of course yeah. We definitely let our clienteles get full control of their own website. I mean, we believe in having it to all yourself and for your business."

## CLOSING (11 scripts)
1. Ask Callback: "I mean, would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"
2. Get Email: "Oh, what's your email?"
3. Confirm Name: "And your name is? ... Oh, you're the owner? You're [Customer Name]?"
4. Trust/Source: "We're scouting small to medium local businesses in the area, so we just got your number off of Google."
5. Soft Close: "And would it be okay, [Name], if I can have either Bob or his partner give you a quick call later? Should be a quick call."
6. Value Pricing: "So then you can know pricing and all that."
7. Decision Maker: "And [Name], you're the person in charge of the website we could talk to, right? Just to confirm."
8. Ask + FOMO: "Would you mind if I can have Bob or his partner give you a quick call later? Just don't want you to miss out."
9. Confirm Authority: "Oh, you're the owner? [Name]? ... and you're the person in charge of the website to talk about later just to confirm?"
10. Pricing/Samples: "Would you mind if I could have Bob or his partner give you a quick call later today to talk about pricing and all these samples?"

## CONVERSION (2 scripts)
1. Sign Off (Options): "We'll get back to you later. Have a beautiful day and I'm happy and glad that you're open for options and I'm super excited for you."
2. Sign Off (Excited): "Of course yeah, I'll talk to you later then. Have a beautiful day [Name] and I'm super excited for you. Take care."`;

// ============================================================================
// ULTRA-COMPRESSED SYSTEM PROMPT (OPTIMIZED FOR SPEED)
// ============================================================================

const SYSTEM_PROMPT_COMPRESSED = `Sales coach for local digital services (SEO/web design). Target: small business owners.

YOUR TASK: Select ONE script from Mark's library that matches the call stage and context.

OUTPUT FORMAT (exactly):
[STAGE]: One of GREETING, VALUE_PROP, OBJECTION, CLOSING, CONVERSION
[SCRIPT]: Exact script from Mark's library, personalized with customer context

RULES:
- Use Mark's exact wording
- Replace [Agent], [Name], [Location] with actual values
- Keep it natural and conversational
- NO explanations, just the script`;

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
      max_tokens: 100, // Reduced from 150/300 - we only need ONE script
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

    // Calculate cache hit rate
    const cachedTokens = response.usage.cache_read_input_tokens || 0;
    const totalInputTokens = response.usage.input_tokens + cachedTokens;
    const cacheHitRate = totalInputTokens > 0 ? cachedTokens / totalInputTokens : 0;

    // Extract stage and script
    const stage = extractStage(fullText);
    const suggestion = extractScript(fullText);

    // Performance logging
    if (latency > MAX_LATENCY_MS) {
      console.warn(`[Claude] LATENCY WARNING: ${latency}ms exceeds target ${MAX_LATENCY_MS}ms`);
    }
    if (cacheHitRate < CACHE_HIT_TARGET) {
      console.warn(`[Claude] CACHE WARNING: ${(cacheHitRate * 100).toFixed(1)}% below target ${CACHE_HIT_TARGET * 100}%`);
    }

    console.log(`[Claude] Performance: ${latency}ms, Cache: ${(cacheHitRate * 100).toFixed(1)}%, Model: ${useHaiku ? 'Haiku' : 'Sonnet'}`);

    return {
      suggestion,
      model: useHaiku ? 'haiku' : 'sonnet',
      latency,
      cacheHitRate,
      tokenMetrics: {
        cached: cachedTokens,
        input: response.usage.input_tokens,
        output: response.usage.output_tokens
      },
      stage
    };

  } catch (error: any) {
    console.error('[Claude] API Error:', error);

    // Fallback to default script if API fails
    return {
      suggestion: getFallbackScript(request.callStage),
      model: 'haiku',
      latency: Date.now() - startTime,
      cacheHitRate: 0,
      tokenMetrics: { cached: 0, input: 0, output: 0 },
      stage: request.callStage.toUpperCase()
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildCompressedPrompt(request: AITipRequest): string {
  // Ultra-compressed prompt to minimize tokens
  const parts: string[] = [
    `Stage: ${request.callStage}`,
    `Recent: "${request.recentTranscript.substring(0, 200)}"` // Limit to 200 chars
  ];

  if (request.transcriptCount) {
    parts.push(`Count: ${request.transcriptCount}`);
  }

  if (request.conversationSummary) {
    parts.push(`Context: "${request.conversationSummary.substring(0, 150)}"`);
  }

  return parts.join('\n');
}

function extractStage(text: string): string {
  const stageMatch = text.match(/\[STAGE\]:\s*(\w+)/i);
  if (stageMatch) {
    return stageMatch[1];
  }

  // Fallback detection
  if (text.toLowerCase().includes('greeting') || text.toLowerCase().includes('good morning')) {
    return 'GREETING';
  }
  if (text.toLowerCase().includes('callback') || text.toLowerCase().includes('email')) {
    return 'CLOSING';
  }

  return 'VALUE_PROP';
}

function extractScript(text: string): string {
  // Extract script after [SCRIPT]: marker
  const scriptMatch = text.match(/\[SCRIPT\]:\s*(.+)/is);
  if (scriptMatch) {
    return scriptMatch[1].trim();
  }

  // Fallback: return full text cleaned
  return text.replace(/\[STAGE\]:[^\n]+/i, '').trim();
}

function getFallbackScript(stage: string): string {
  const fallbacks: Record<string, string> = {
    greeting: "Good morning, can you hear me okay?",
    discovery: "I mean, that's why we're here... I mean, you said you're open to possibly updating if anything?",
    objection: "Oh okay. I mean, that's great because we also optimize websites as well, especially with SEO, at super affordable costs.",
    closing: "Would you mind if I can have Bob or his partner give you a quick call later to talk about improving the look or ranking of your website?"
  };

  return fallbacks[stage] || fallbacks.greeting;
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
