import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { getRecentTranscriptsWithCount, saveAIRecommendation } from '../shared/postgres-client';
import { generateConversationIntelligence } from '../shared/intelligence-client';
import { generateAITip } from '../shared/claude-client-optimized';
import { getCachedIntelligence, setCachedIntelligence } from './cache';

// Track previous AI suggestions per conversation (Lambda memory — resets on cold start)
const previousSuggestionsCache: Record<string, string[]> = {};

/**
 * IntelligenceHandler Lambda Function
 *
 * Performance optimization: caches intelligence results in Lambda memory.
 * Auto-analysis (skipTip=true) runs every 10s and refreshes the cache.
 * Manual tip requests (skipTip=false) reuse cached intelligence to skip
 * the redundant Claude call, cutting response time by ~1-2 seconds.
 */

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestStartTime = Date.now();
  console.log('[Intelligence] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;

  try {
    // Get connection info
    const connection = await getConnection(connectionId);
    if (!connection) {
      console.error('[Intelligence] Connection not found');
      return { statusCode: 404, body: JSON.stringify({ type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Connection not found' } }) };
    }

    if (!connection.conversationId) {
      console.error('[Intelligence] No conversation ID associated with connection');
      return { statusCode: 400, body: JSON.stringify({ type: 'ERROR', payload: { code: 'NO_CONVERSATION', message: 'No active conversation' } }) };
    }

    const conversationId = connection.conversationId;

    // Parse message body (optional parameters)
    const body = JSON.parse(event.body || '{}');
    const { limit = 50, skipTip = false } = body;

    console.log(`[Intelligence] Analyzing conversation: ${conversationId} (limit: ${limit}, skipTip: ${skipTip})`);

    // 1. Fetch recent transcripts + count in a single query
    const { transcripts, count: transcriptCount } = await getRecentTranscriptsWithCount(conversationId, limit);

    if (transcripts.length === 0) {
      console.warn('[Intelligence] No transcripts found for analysis');
      return {
        statusCode: 200,
        body: JSON.stringify({ type: 'ERROR', payload: { code: 'NO_TRANSCRIPTS', message: 'No transcripts available' } })
      };
    }

    console.log(`[Intelligence] Fetched ${transcripts.length} transcripts (${transcriptCount} total) for analysis`);

    // 2. Check if we can use cached intelligence (for manual tip requests)
    const cached = !skipTip ? getCachedIntelligence(conversationId) : null;

    let intelligence;
    let cacheHit = false;

    if (cached) {
      // FAST PATH: Manual tip request with fresh cached intelligence — skip Claude call
      intelligence = cached;
      cacheHit = true;
      console.log(`[Intelligence] Using cached intelligence — skipping redundant Claude call`);
    } else {
      // NORMAL PATH: Run intelligence analysis (auto-analysis or no cache available)
      const aiStartTime = Date.now();
      intelligence = await generateConversationIntelligence({
        conversationId,
        transcripts
      });
      const aiLatency = Date.now() - aiStartTime;
      console.log(`[Intelligence] Analysis complete in ${aiLatency}ms, model: ${intelligence.model}`);

      // Update cache
      setCachedIntelligence(conversationId, intelligence);
      console.log(`[Intelligence] Cache updated for conversation: ${conversationId}`);
    }

    // 3. Generate AI tip from golden script (only if not skipped)
    let aiTipPayload: any = undefined;

    if (!skipTip) {
      console.log(`[Intelligence] Generating AI tip...`);

      let callStage: 'greeting' | 'discovery' | 'objection' | 'closing' | 'conversion';
      if (transcriptCount < 5) {
        callStage = 'greeting';
      } else if (transcriptCount < 10) {
        callStage = 'discovery';
      } else if (transcriptCount < 20) {
        callStage = 'objection';
      } else {
        callStage = 'closing';
      }

      // Detect conversion: if customer agreed to callback, override stage
      // NOTE: transcripts are DESC ordered (newest first), so slice(0, N) = most recent N
      const recentCustomerMessages = transcripts
        .slice(0, 10)
        .filter(t => t.speaker === 'caller')
        .map(t => t.text.toLowerCase());
      // Direct agreement (requires agent to have asked for callback)
      const directSignals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "i'm good with that", "that's great", "that's fine", "that works", "i'm down", "i'm interested", "go ahead", "let's do it", "fine"];
      const hasDirectAgreement = recentCustomerMessages.some(msg =>
        directSignals.some(signal => msg.includes(signal))
      );
      // Indirect agreement (customer proactively asks for callback — no agent ask needed)
      const indirectSignals = ["have bob call", "call me back", "they can call", "have them call", "bob can call", "give me a call", "i'll take a call", "take a call from bob", "he can call", "bob call me", "can call me"];
      const hasIndirectAgreement = recentCustomerMessages.some(msg =>
        indirectSignals.some(signal => msg.includes(signal))
      );
      // Also check if agent already asked for callback
      const recentAgentMessages = transcripts
        .slice(0, 10)
        .filter(t => t.speaker === 'agent')
        .map(t => t.text.toLowerCase());
      // Must match callback-ask patterns specifically, not just any mention of "Bob" (e.g. "Bob and I are here" in intro)
      const callbackPatterns = ['call later', 'callback', 'quick call', 'call you back', 'give you a call', 'bob or his partner'];
      const askedCallback = recentAgentMessages.some(msg =>
        callbackPatterns.some(p => msg.includes(p))
      );
      const hasAgreed = (hasDirectAgreement && askedCallback) || hasIndirectAgreement;

      console.log('[Intelligence] Conversion detection:', {
        customerMessages: recentCustomerMessages,
        hasAgreed,
        askedCallback,
        currentStage: callStage
      });

      if (hasAgreed) {
        callStage = 'conversion';
        console.log('[Intelligence] Customer agreed to callback — switching to CONVERSION stage');

        // Check if customer already gave their details → force sign-off
        const namePattern = /my name is|it's \w+|i'm \w+|ask for \w+|call me \w+/i;
        const numberPattern = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\d{10}/;
        const timePattern = /after \d|before \d|around \d|at \d|this afternoon|this evening|tomorrow|in the morning/i;
        const alreadyToldYou = /already (said|gave|told)|i got it|yeah yeah/i;

        const customerGaveName = recentCustomerMessages.some(msg => namePattern.test(msg));
        const customerGaveNumber = recentCustomerMessages.some(msg => numberPattern.test(msg));
        const customerGaveTime = recentCustomerMessages.some(msg => timePattern.test(msg));
        const customerFrustrated = recentCustomerMessages.some(msg => alreadyToldYou.test(msg));

        if ((customerGaveName && customerGaveTime) || (customerGaveName && customerGaveNumber) || customerFrustrated) {
          callStage = 'signoff' as any;
          console.log('[Intelligence] Customer already gave details — switching to SIGNOFF');
        }
      }

      // Get most recent transcripts for AI context (DESC order → slice(0, N) then reverse for chronological)
      const contextWindow = 15;
      const recentTranscripts = transcripts.slice(0, contextWindow).reverse();
      const conversationContext = recentTranscripts
        .map(t => `${t.speaker.toUpperCase()}: "${t.text}"`)
        .join('\n');

      // Get previous suggestions for this conversation
      const prevSuggestions = previousSuggestionsCache[conversationId] || [];

      const aiTipStartTime = Date.now();
      const aiTip = await generateAITip({
        conversationId,
        callStage,
        recentTranscript: conversationContext,
        conversationSummary: intelligence.summary,
        transcriptCount,
        previousSuggestions: prevSuggestions,
        collectedInfo: {
          customerName: (intelligence.entities?.people?.length ?? 0) > 0,
          businessName: (intelligence.entities?.businessNames?.length ?? 0) > 0,
          phoneNumber: (intelligence.entities?.contactInfo?.phoneNumbers?.length ?? 0) > 0,
          email: (intelligence.entities?.contactInfo?.emails?.length ?? 0) > 0,
        },
      });
      const aiTipLatency = Date.now() - aiTipStartTime;

      // Track this suggestion
      if (!previousSuggestionsCache[conversationId]) {
        previousSuggestionsCache[conversationId] = [];
      }
      previousSuggestionsCache[conversationId].push(aiTip.suggestion);
      // Keep last 10 suggestions max
      if (previousSuggestionsCache[conversationId].length > 10) {
        previousSuggestionsCache[conversationId] = previousSuggestionsCache[conversationId].slice(-10);
      }

      console.log(`[Intelligence] AI Tip generated in ${aiTipLatency}ms, Stage: ${aiTip.stage}, Heading: ${aiTip.heading}, Previous suggestions: ${prevSuggestions.length}`);

      // Save AI recommendation to database
      const recommendationId = await saveAIRecommendation({
        conversation_id: conversationId,
        heading: aiTip.heading,
        stage: aiTip.stage,
        context: aiTip.context,
        option1_label: 'Best Match',
        option1_script: aiTip.suggestion,
        option2_label: 'Alternative',
        option2_script: aiTip.suggestion,
        option3_label: 'Alternative',
        option3_script: aiTip.suggestion
      });

      aiTipPayload = {
        heading: aiTip.heading,
        stage: aiTip.stage,
        context: aiTip.context,
        suggestion: aiTip.suggestion,
        recommendationId,
      };
    } else {
      console.log(`[Intelligence] Skipping AI tip generation (auto-analysis mode)`);
    }

    const totalLatency = Date.now() - requestStartTime;
    console.log(`[Intelligence] Done in ${totalLatency}ms (cache ${cacheHit ? 'HIT' : 'MISS'})`);

    // 4. Return intelligence (+ AI tip if requested)
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 'INTELLIGENCE_UPDATE',
        payload: {
          intelligence: {
            sentiment: intelligence.sentiment,
            intents: intelligence.intents,
            topics: intelligence.topics,
            summary: intelligence.summary,
          },
          entities: intelligence.entities,
          ...(aiTipPayload ? { aiTip: aiTipPayload } : {}),
          timestamp: Date.now()
        }
      })
    };

  } catch (error: any) {
    console.error('[Intelligence] Error:', error);
    const totalLatency = Date.now() - requestStartTime;
    console.error(`[Intelligence] Failed after ${totalLatency}ms:`, error.message);

    // Return error via route response
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 'ERROR',
        payload: {
          message: 'Intelligence analysis temporarily unavailable',
          code: 'INTELLIGENCE_ERROR',
          timestamp: Date.now()
        }
      })
    };
  }
};
