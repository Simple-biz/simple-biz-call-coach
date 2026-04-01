import Anthropic from '@anthropic-ai/sdk';
import { Transcript } from './db-client';
import { getSecret } from './secrets-client';

/**
 * Intelligence Client - Conversation Analysis using Claude Haiku 4.5
 *
 * Extracts: Sentiment, Entities, Intents, Topics from conversation transcripts
 * Performance: <500ms target (Haiku is fast and cost-effective)
 */

// Initialize Anthropic client lazily (reuse across Lambda invocations)
let anthropicClient: Anthropic | null = null;

async function getAnthropicClient(): Promise<Anthropic> {
  if (!anthropicClient) {
    const apiKey = await getSecret('ANTHROPIC_API_KEY');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20250929';

// Intelligence data structures
export interface ConversationIntelligence {
  sentiment: {
    label: 'positive' | 'neutral' | 'negative';
    score: number; // -1 to 1
    averageScore: number;
  };
  intents: Array<{
    intent: string;
    confidence: number;
    segment: string;
  }>;
  topics: Array<{
    topic: string;
    confidence: number;
    segment: string;
  }>;
  summary: string;
  model: string;
}

export interface ExtractedEntities {
  businessNames: string[];
  contactInfo: {
    emails: string[];
    phoneNumbers: string[];
    urls: string[];
  };
  locations: string[];
  dates: string[];
  people: string[];
}

export interface IntelligenceResult {
  sentiment: ConversationIntelligence['sentiment'];
  intents: ConversationIntelligence['intents'];
  topics: ConversationIntelligence['topics'];
  summary: string;
  entities: ExtractedEntities;
  model: string;
}

/**
 * Generate conversation intelligence using Claude Haiku 4.5
 */
export async function generateConversationIntelligence(params: {
  conversationId: string;
  transcripts: Transcript[];
}): Promise<IntelligenceResult> {
  const { conversationId, transcripts } = params;

  console.log(`[Intelligence] Analyzing ${transcripts.length} transcripts for conversation: ${conversationId}`);

  // Format transcripts for Claude analysis
  const conversationText = transcripts
    .reverse() // Chronological order
    .map(t => `[${t.speaker.toUpperCase()}]: ${t.text}`)
    .join('\n');

  // Static system prompt (cached across invocations for ~90% cost reduction)
  const systemPrompt = `You analyze sales conversations and extract intelligence in JSON format.

IMPORTANT: This is a sales call between an AGENT (seller) and a CALLER/CUSTOMER (buyer/prospect).
Extract entities ONLY from what the CUSTOMER/CALLER says. Ignore the agent's own name, company, and contact info.

Extract and return ONLY valid JSON with this structure:
{
  "sentiment": {
    "label": "positive" | "neutral" | "negative",
    "score": <number between -1 and 1>,
    "averageScore": <same as score>
  },
  "intents": [
    { "intent": "intent_name", "confidence": <0-1>, "segment": "relevant quote" }
  ],
  "topics": [
    { "topic": "topic_name", "confidence": <0-1>, "segment": "relevant quote" }
  ],
  "summary": "1-2 sentence summary of conversation status and customer disposition",
  "entities": {
    "businessNames": ["CUSTOMER's business names only — NOT the agent's company"],
    "contactInfo": {
      "emails": ["CUSTOMER's email addresses only"],
      "phoneNumbers": ["CUSTOMER's phone numbers only — NOT numbers the agent mentions"],
      "urls": ["CUSTOMER's website URLs only — NOT the agent's company domain"]
    },
    "locations": ["cities, states, countries, street addresses"],
    "dates": ["ANY date, time, day, or scheduling reference — e.g. 'tomorrow', 'March 19', '9AM', 'Thursday afternoon', 'next week'"],
    "people": ["CUSTOMER's name only — NOT the agent's name, NOT 'Bob' or other agent team members"]
  }
}

IMPORTANT extraction rules:
- ONLY extract entities from [CALLER] lines. The agent's info (their name, company, Bob, partner) must be EXCLUDED.
- urls: Extract ANY website or domain the CUSTOMER mentions. Do NOT include the agent's company domain (e.g. "simple.biz", "support.biz").
- dates: Extract ALL time references including relative ones ("tomorrow", "next Monday", "this Thursday") and specific ones ("March 19 at 9AM", "2pm").
- phoneNumbers: Extract numbers the CUSTOMER provides. Do NOT include numbers the agent offers.
- people: Extract the CUSTOMER's name only. Do NOT include the agent's name, "Bob", or other agent team members.
- businessNames: Extract the CUSTOMER's business name. Do NOT include the agent's company name.

Common intents: interested, not_interested, pricing_inquiry, request_callback, objection, purchase_intent, information_seeking
Common topics: pricing, services, website_optimization, SEO, marketing, scheduling, follow_up

Return ONLY the JSON object, no other text.`;

  // User prompt contains only the dynamic conversation text
  const userPrompt = `Analyze this sales conversation:\n\n${conversationText}`;

  try {
    const client = await getAnthropicClient();

    const startTime = Date.now();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      temperature: 0, // Deterministic for consistent analysis
      system: [
        {
          type: 'text',
          text: systemPrompt,
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
    console.log(`[Intelligence] Claude Haiku response received in ${latency}ms`);

    // Extract JSON from response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let intelligenceData: any;
    try {
      // Try to parse the full response as JSON
      intelligenceData = JSON.parse(content.text);
    } catch (parseError) {
      // If full response isn't JSON, try to extract JSON from text
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        intelligenceData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to extract JSON from Claude response');
      }
    }

    // Validate and structure the result
    const result: IntelligenceResult = {
      sentiment: {
        label: intelligenceData.sentiment?.label || 'neutral',
        score: intelligenceData.sentiment?.score || 0,
        averageScore: intelligenceData.sentiment?.averageScore || intelligenceData.sentiment?.score || 0
      },
      intents: intelligenceData.intents || [],
      topics: intelligenceData.topics || [],
      summary: intelligenceData.summary || 'Conversation in progress',
      entities: {
        businessNames: intelligenceData.entities?.businessNames || [],
        contactInfo: {
          emails: intelligenceData.entities?.contactInfo?.emails || [],
          phoneNumbers: intelligenceData.entities?.contactInfo?.phoneNumbers || [],
          urls: intelligenceData.entities?.contactInfo?.urls || []
        },
        locations: intelligenceData.entities?.locations || [],
        dates: intelligenceData.entities?.dates || [],
        people: intelligenceData.entities?.people || []
      },
      model: HAIKU_MODEL
    };

    console.log(`[Intelligence] Analysis complete:`, {
      sentiment: result.sentiment.label,
      intentCount: result.intents.length,
      topicCount: result.topics.length,
      entityCount: {
        businesses: result.entities.businessNames.length,
        people: result.entities.people.length,
        locations: result.entities.locations.length
      }
    });

    return result;

  } catch (error: any) {
    console.error('[Intelligence] Error generating intelligence:', error);

    // Return fallback intelligence on error
    return {
      sentiment: {
        label: 'neutral',
        score: 0,
        averageScore: 0
      },
      intents: [],
      topics: [],
      summary: 'Intelligence analysis unavailable',
      entities: {
        businessNames: [],
        contactInfo: {
          emails: [],
          phoneNumbers: [],
          urls: []
        },
        locations: [],
        dates: [],
        people: []
      },
      model: HAIKU_MODEL
    };
  }
}
