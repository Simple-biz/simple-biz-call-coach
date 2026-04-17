/**
 * OpenAI Client — Fallback Provider
 *
 * Used when Anthropic Claude is unavailable. Mirrors the shape of the
 * Anthropic client so the existing parsers and Lambda handlers need no changes.
 *
 * Tip generation: streams with OpenAI's Predicted Outputs for structural markers.
 * Intelligence: uses OpenAI structured outputs (JSON schema mode).
 */

import OpenAI from 'openai';
import { getSecret } from './secrets-client';
import {
  SYSTEM_PROMPT_COMPRESSED,
  getScriptsForStage,
  buildCompressedPrompt,
  parseAITipResponse,
  getFallbackSuggestion,
  AITipRequest,
  AITipResponse,
} from './claude-client-optimized';
import type {
  IntelligenceTranscript,
  IntelligenceResult,
} from './intelligence-client';

// ============================================================================
// LAZY CLIENT INIT
// ============================================================================

let openaiClient: OpenAI | null = null;

async function getOpenAIClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const apiKey = await getSecret('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured in Secrets Manager');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AI_RECEPTIONIST_PATTERN = /\b(receptionist|virtual receptionist|ai receptionist|automated (?:system|receptionist)|assist(?:ing)? with appointments|scheduling appointments|i handle scheduling|appointments and inquiries|how can i assist you|team call you back|team reach out|pass it along for a follow-up|provide your contact information|spell (?:out )?your email)\b/i;
const RECEPTIONIST_FORBIDDEN_ASK_PATTERN = /\b(?:what['’]?s your name|your name\b|name of your business|business name|best email(?: for you)?|what['’]?s the best email|what['’]?s your email|could you provide (?:your )?email|provide (?:your )?email)\b/i;
const RECEPTIONIST_ALLOWED_INTENT_PATTERN = /\b(?:connect|transfer|whoever handles|decision(?:-| )maker|pass (?:a )?(?:quick )?message|let (?:them|him|her) know|call (?:us|me) back|reach (?:out|us)|follow up)\b/i;
const RECEPTIONIST_SAFE_SCRIPT = "Of course, no worries - could you connect me with whoever handles website decisions? If that's easier, please pass a quick message that Bob's website team called and ask them to call us back.";

function isReceptionistContext(request: AITipRequest): boolean {
  const contextBlob = [
    request.recentTranscript || '',
    request.conversationSummary || '',
    ...(request.conversationFacts || []),
  ].join('\n');
  if (!contextBlob) return false;
  return AI_RECEPTIONIST_PATTERN.test(contextBlob);
}

// ============================================================================
// STREAMING TIP GENERATION
// ============================================================================

/**
 * Generate AI tip via OpenAI with streaming.
 * Matches the Anthropic streaming interface so upstream code is unchanged.
 */
export async function generateAITipStreamingOpenAI(
  request: AITipRequest,
  onChunk: (delta: string) => Promise<void>
): Promise<AITipResponse> {
  const startTime = Date.now();

  try {
    const openai = await getOpenAIClient();
    const receptionistMode = isReceptionistContext(request);
    let userPrompt = buildCompressedPrompt(request);
    if (receptionistMode) {
      userPrompt += `\n\nRECEPTIONIST STRICT MODE (hard rule):
- Customer is a receptionist or AI gatekeeper, not the owner.
- Do NOT ask for their name, business name, or email.
- Give one short operational line only:
  1) ask for transfer to website decision-maker, OR
  2) ask them to pass a callback message to Bob's website team.`;
    }

    // Combine system prompt + stage-specific scripts (OpenAI uses one system message)
    const fullSystemPrompt = `${SYSTEM_PROMPT_COMPRESSED}\n\n${getScriptsForStage(request.callStage)}`;

    let fullText = '';
    let chunkBuffer = '';

    const stream = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: 300,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (!delta) continue;

      fullText += delta;
      chunkBuffer += delta;

      // Same flush cadence as Anthropic version (~5 tokens or punctuation)
      if (chunkBuffer.length >= 20 || /[.!?,\n]$/.test(chunkBuffer)) {
        try {
          await onChunk(chunkBuffer);
        } catch (err) {
          console.error('[OpenAI Stream] Error sending chunk:', err);
        }
        chunkBuffer = '';
      }
    }

    // Flush remaining buffer
    if (chunkBuffer) {
      try {
        await onChunk(chunkBuffer);
      } catch (err) {
        console.error('[OpenAI Stream] Error sending final chunk:', err);
      }
    }

    const latency = Date.now() - startTime;

    console.log('[OpenAI Stream] Full Response:');
    console.log('=====================================');
    console.log(fullText);
    console.log('=====================================');

    const parsed = parseAITipResponse(fullText, request.callStage);
    let normalized = parsed;
    if (receptionistMode) {
      const looksLikeMisfire = RECEPTIONIST_FORBIDDEN_ASK_PATTERN.test(parsed.suggestion) || !RECEPTIONIST_ALLOWED_INTENT_PATTERN.test(parsed.suggestion);
      if (looksLikeMisfire) {
        console.warn('[OpenAI Stream] Replaced receptionist misfire script');
        normalized = {
          ...parsed,
          heading: 'Receptionist Route',
          stage: 'OBJECTION_HANDLING',
          suggestion: RECEPTIONIST_SAFE_SCRIPT
        };
      }
    }

    console.log(`[OpenAI Stream] Performance: ${latency}ms, Model: ${OPENAI_MODEL}`);

    return {
      ...parsed,
      ...normalized,
      model: 'haiku', // keep 'haiku' literal so downstream types don't change
      latency,
      cacheHitRate: 0, // OpenAI doesn't expose cache hit rate the same way
      tokenMetrics: {
        cached: 0,
        input: 0,
        output: 0,
      },
    };
  } catch (error: any) {
    console.error('[OpenAI Stream] API Error:', error);
    return getFallbackSuggestion(request.callStage, Date.now() - startTime);
  }
}

// ============================================================================
// INTELLIGENCE ANALYSIS (JSON)
// ============================================================================

const INTELLIGENCE_JSON_SCHEMA = {
  name: 'conversation_intelligence',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sentiment: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          score: { type: 'number' },
          averageScore: { type: 'number' },
        },
        required: ['label', 'score', 'averageScore'],
      },
      intents: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: { type: 'string' },
            confidence: { type: 'number' },
            segment: { type: 'string' },
          },
          required: ['intent', 'confidence', 'segment'],
        },
      },
      topics: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            topic: { type: 'string' },
            confidence: { type: 'number' },
            segment: { type: 'string' },
          },
          required: ['topic', 'confidence', 'segment'],
        },
      },
      summary: { type: 'string' },
      entities: {
        type: 'object',
        additionalProperties: false,
        properties: {
          businessNames: { type: 'array', items: { type: 'string' } },
          contactInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              emails: { type: 'array', items: { type: 'string' } },
              phoneNumbers: { type: 'array', items: { type: 'string' } },
              urls: { type: 'array', items: { type: 'string' } },
            },
            required: ['emails', 'phoneNumbers', 'urls'],
          },
          locations: { type: 'array', items: { type: 'string' } },
          dates: { type: 'array', items: { type: 'string' } },
          people: { type: 'array', items: { type: 'string' } },
          websiteStatus: { type: 'string', enum: ['has_website', 'no_website', 'unknown'] },
        },
        required: ['businessNames', 'contactInfo', 'locations', 'dates', 'people', 'websiteStatus'],
      },
    },
    required: ['sentiment', 'intents', 'topics', 'summary', 'entities'],
  },
};

/**
 * Generate conversation intelligence via OpenAI using structured outputs.
 * Matches the Anthropic intelligence interface so upstream code is unchanged.
 */
export async function generateConversationIntelligenceOpenAI(params: {
  conversationId: string;
  transcripts: IntelligenceTranscript[];
}): Promise<IntelligenceResult> {
  const { conversationId, transcripts } = params;

  console.log(`[Intelligence OpenAI] Analyzing ${transcripts.length} transcripts for conversation: ${conversationId}`);

  const conversationText = transcripts
    .slice() // don't mutate caller array
    .reverse()
    .map((t) => `[${t.speaker.toUpperCase()}]: ${t.text}`)
    .join('\n');

  // Same system prompt used by Anthropic intelligence client — model-agnostic
  const systemPrompt = `You analyze sales conversations and extract intelligence.

IMPORTANT: This is a sales call between an AGENT (seller) and a CALLER/CUSTOMER (buyer/prospect).
Extract entities ONLY from what the CUSTOMER/CALLER says. Ignore the agent's own name, company, and contact info.

Extraction rules:
- ONLY extract entities from [CALLER] lines. The agent's info (their name, company, Bob) must be EXCLUDED.
- urls: Extract ANY website or domain the CUSTOMER mentions. Do NOT include the agent's company domain.
- dates: Extract ALL time references including relative ones ("tomorrow", "next Monday") and specific ones.
- phoneNumbers: Extract numbers the CUSTOMER provides. Do NOT include numbers the agent offers.
- people: Extract the CUSTOMER's name only. Do NOT include the agent's name, "Bob", or other agent team members.
- businessNames: Extract the CUSTOMER's business name. Do NOT include the agent's company name.
- websiteStatus: "has_website" if they say they have one, "no_website" if they say they don't, "unknown" otherwise.

HOSTILE/FAKE INPUT FILTER — DO NOT extract these as entities (leave arrays empty for the affected field):
- Emails containing profanity ("fuckoff@", "fuckyou@") or dismissals ("none@", "nope@", "leavemealone@", "dontcall@", "nothanks@", "fake@")
- Names that are obvious placeholders ("John Doe", "Jane Doe", "Mickey Mouse") or profanity
- Phone numbers matching reserved/fake patterns (555-0100 to 555-0199, 111-111-1111, 000-000-0000, 123-456-7890)
When hostile patterns appear, add intent "not_interested" with high confidence instead.

Common intents: interested, not_interested, pricing_inquiry, request_callback, objection, purchase_intent, information_seeking
Common topics: pricing, services, website_optimization, SEO, marketing, scheduling, follow_up`;

  const userPrompt = `Analyze this sales conversation:\n\n${conversationText}`;

  try {
    const openai = await getOpenAIClient();
    const startTime = Date.now();

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: INTELLIGENCE_JSON_SCHEMA as any,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const latency = Date.now() - startTime;
    console.log(`[Intelligence OpenAI] Response received in ${latency}ms`);

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error('Empty response from OpenAI');
    }

    const intelligenceData = JSON.parse(rawContent);

    const result: IntelligenceResult = {
      sentiment: {
        label: intelligenceData.sentiment?.label || 'neutral',
        score: intelligenceData.sentiment?.score ?? 0,
        averageScore: intelligenceData.sentiment?.averageScore ?? intelligenceData.sentiment?.score ?? 0,
      },
      intents: intelligenceData.intents || [],
      topics: intelligenceData.topics || [],
      summary: intelligenceData.summary || 'Conversation in progress',
      entities: {
        businessNames: intelligenceData.entities?.businessNames || [],
        contactInfo: {
          emails: intelligenceData.entities?.contactInfo?.emails || [],
          phoneNumbers: intelligenceData.entities?.contactInfo?.phoneNumbers || [],
          urls: intelligenceData.entities?.contactInfo?.urls || [],
        },
        locations: intelligenceData.entities?.locations || [],
        dates: intelligenceData.entities?.dates || [],
        people: intelligenceData.entities?.people || [],
        websiteStatus: intelligenceData.entities?.websiteStatus || 'unknown',
      },
      model: OPENAI_MODEL,
    };

    console.log(`[Intelligence OpenAI] Analysis complete:`, {
      sentiment: result.sentiment.label,
      intentCount: result.intents.length,
      topicCount: result.topics.length,
    });

    return result;
  } catch (error: any) {
    console.error('[Intelligence OpenAI] Error:', error);

    return {
      sentiment: { label: 'neutral', score: 0, averageScore: 0 },
      intents: [],
      topics: [],
      summary: 'Intelligence analysis unavailable',
      entities: {
        businessNames: [],
        contactInfo: { emails: [], phoneNumbers: [], urls: [] },
        locations: [],
        dates: [],
        people: [],
        websiteStatus: 'unknown',
      },
      model: OPENAI_MODEL,
    };
  }
}
