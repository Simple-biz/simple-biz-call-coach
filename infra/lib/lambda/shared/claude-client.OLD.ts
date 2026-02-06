import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
});

const HAIKU_MODEL = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20250929';
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || 'claude-sonnet-4-5-20250929';

export interface AITipRequest {
  conversationId: string;
  callStage: 'greeting' | 'discovery' | 'objection' | 'closing';
  recentTranscript: string;
  conversationSummary?: string;
  customerContext?: {
    industry?: string;
    painPoints: string[];
    mentionedCompetitors: string[];
  };
}

export interface AITipResponse {
  heading: string;
  suggestion: string;
  model: 'haiku' | 'sonnet';
  latency: number;
  reasoning?: string;
  cachedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

// Prompt templates with cache control
const SYSTEM_PROMPT_GREETING = `You are a sales coaching AI for digital services (SEO, web design, system administration).
Your goal: Help agents have natural, rapport-building conversations.

Task: Select ONE greeting script from the Golden Scripts Library that matches the call stage.
Output format:
- Heading: Exactly 2 words
- Suggestion: One actionable sentence

Keep tone conversational, not pushy.`;

const SYSTEM_PROMPT_OBJECTION = `You are an expert sales coach specializing in objection handling for digital services.

Task:
1. Identify the customer's objection type (price, timing, competitor, skepticism)
2. Select the most relevant script from the Golden Scripts Library
3. Customize the script using the customer's exact words and context
4. Output a natural, empathetic response

Output format:
- Heading: Exactly 2 words (e.g., "Address Budget")
- Suggestion: One customized sentence that uses customer context

Maintain authenticity - use customer's terminology and pain points.`;

// Golden Scripts - Greeting (cached, 1024+ tokens)
const GOLDEN_SCRIPTS_GREETING = `# GOLDEN SCRIPTS LIBRARY - GREETING

## Opening Scripts
1. **Build Rapport** - "I noticed you're in [industry]. How's your current website performing for lead generation?"
2. **Show Interest** - "Thanks for taking my call! I'd love to learn more about your business goals for this quarter."
3. **Value First** - "Many businesses in your space struggle with [pain point]. Is that something you're experiencing?"
4. **Direct Approach** - "I'm calling about helping you improve your online visibility. Do you have a few minutes?"
5. **Referral Opening** - "Your colleague [name] mentioned you might be interested in improving your SEO. Is now a good time?"

## Discovery Scripts
1. **Pain Point** - "What's your biggest challenge with your current marketing efforts?"
2. **Timeline** - "When would be ideal for you to see improvements in [goal]?"
3. **Budget Awareness** - "Have you allocated budget for digital marketing this quarter?"
4. **Decision Process** - "Who else would be involved in making this decision?"
5. **Current Solutions** - "What are you currently doing for SEO/web design?"`;

// Golden Scripts - Full Library (cached, 3000+ tokens)
const GOLDEN_SCRIPTS_FULL = `# GOLDEN SCRIPTS LIBRARY - COMPLETE

## Objection Handling

### Price Objections
1. **Value First** - "I understand budget is a concern. Many of our clients felt the same way initially, but when they saw the ROI from increased leads, they realized it was an investment, not an expense."
2. **Compare Options** - "Let me break down the pricing. We're talking about [amount] per month, which works out to about [daily cost]. That's less than you'd spend on traditional advertising with far better targeting."
3. **Payment Plans** - "We offer flexible payment options. Would it help to spread this over quarterly payments?"
4. **Show Value** - "Our clients typically see a [X]% increase in qualified leads within [timeframe]. What would that be worth to your business?"

### Timing Objections
1. **Future Commitment** - "I totally understand timing is important. When would be better for you - next quarter?"
2. **Urgency Builder** - "I hear you. The challenge is, every day you wait, your competitors are gaining ground online. Can we at least schedule a follow-up?"
3. **Soft Close** - "What if we could start small with just [phase 1] and expand when you're ready?"

### Competitor Objections
1. **Differentiation** - "That's great that you're working with [competitor]. How's that going for you so far?"
2. **Comparison** - "Many of our clients came from [competitor]. The main difference they noticed was our [unique value prop]."
3. **Partnership Angle** - "We can complement what you're already doing. It's not either/or."

### Skepticism
1. **Social Proof** - "I get it - you want to see results. Let me share a case study from a similar business in [industry]..."
2. **Trial Offer** - "What if we could prove it works first? We offer a 30-day trial with no long-term commitment."
3. **Transparency** - "Fair question. Here's exactly how we'd approach your situation: [3-step process]"

### Not Interested
1. **Permission to Follow Up** - "No problem! Would it be okay if I checked back in [timeframe] in case anything changes?"
2. **Curiosity** - "I understand. Out of curiosity, what would it take for you to consider this?"
3. **Soft Exit** - "I appreciate your honesty. Can I at least send you some information to keep on file?"`;

export async function generateAITip(request: AITipRequest): Promise<AITipResponse> {
  const startTime = Date.now();
  const isGreeting = request.callStage === 'greeting';

  try {
    if (isGreeting) {
      // Use Haiku for fast greeting scripts
      const response = await anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 150,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT_GREETING,
            cache_control: { type: 'ephemeral' }
          },
          {
            type: 'text',
            text: GOLDEN_SCRIPTS_GREETING,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: `Call stage: ${request.callStage}\nRecent transcript: ${request.recentTranscript}`
          }
        ]
      });

      const textContent = response.content[0];
      const fullText = textContent.type === 'text' ? textContent.text : '';

      return {
        heading: extractHeading(fullText),
        suggestion: extractSuggestion(fullText),
        model: 'haiku',
        latency: Date.now() - startTime,
        cachedTokens: response.usage.cache_read_input_tokens || 0,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      };
    } else {
      // Use Sonnet for complex objection handling
      const response = await anthropic.messages.create({
        model: SONNET_MODEL,
        max_tokens: 300,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT_OBJECTION,
            cache_control: { type: 'ephemeral' }
          },
          {
            type: 'text',
            text: GOLDEN_SCRIPTS_FULL,
            cache_control: { type: 'ephemeral' }
          },
          {
            type: 'text',
            text: `Conversation Summary: ${request.conversationSummary || 'No summary yet'}`,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: buildObjectionPrompt(request)
          }
        ]
      });

      const textContent = response.content[0];
      const fullText = textContent.type === 'text' ? textContent.text : '';

      return {
        heading: extractHeading(fullText),
        suggestion: extractSuggestion(fullText),
        model: 'sonnet',
        latency: Date.now() - startTime,
        reasoning: extractReasoning(fullText),
        cachedTokens: response.usage.cache_read_input_tokens || 0,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      };
    }
  } catch (error) {
    console.error('[Claude] Error generating AI tip:', error);
    throw error;
  }
}

function buildObjectionPrompt(request: AITipRequest): string {
  const { recentTranscript, customerContext } = request;

  let prompt = `Recent transcript: ${recentTranscript}\n\n`;

  if (customerContext) {
    if (customerContext.industry) {
      prompt += `Industry: ${customerContext.industry}\n`;
    }
    if (customerContext.painPoints.length > 0) {
      prompt += `Pain points mentioned: ${customerContext.painPoints.join(', ')}\n`;
    }
    if (customerContext.mentionedCompetitors.length > 0) {
      prompt += `Competitors mentioned: ${customerContext.mentionedCompetitors.join(', ')}\n`;
    }
  }

  return prompt;
}

function extractHeading(text: string): string {
  const headingMatch = text.match(/Heading:\s*([^\n]+)/i);
  if (headingMatch) {
    return headingMatch[1].trim().substring(0, 30); // Max 30 chars
  }

  // Fallback: Take first 2 words
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return words.slice(0, 2).join(' ');
}

function extractSuggestion(text: string): string {
  const suggestionMatch = text.match(/Suggestion:\s*([^\n]+)/i);
  if (suggestionMatch) {
    return suggestionMatch[1].trim();
  }

  // Fallback: Take first sentence after heading
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length > 1 ? sentences[1].trim() : sentences[0]?.trim() || '';
}

function extractReasoning(text: string): string {
  const reasoningMatch = text.match(/Reasoning:\s*([^\n]+)/i);
  return reasoningMatch ? reasoningMatch[1].trim() : '';
}
