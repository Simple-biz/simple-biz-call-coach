import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { getRecentTranscriptsWithCount, saveAIRecommendation } from '../shared/postgres-client';
import { generateConversationIntelligence } from '../shared/intelligence-client';
import { generateAITip } from '../shared/claude-client-optimized';

/**
 * IntelligenceHandler Lambda Function
 *
 * Returns data via route response (API Gateway sends Lambda response body
 * back to the client automatically). No sendToConnection needed.
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
    const { limit = 50 } = body;

    console.log(`[Intelligence] Analyzing conversation: ${conversationId} (limit: ${limit})`);

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

    // 2. Generate intelligence using Claude Haiku 4.5 (with prompt caching)
    const aiStartTime = Date.now();
    const intelligence = await generateConversationIntelligence({
      conversationId,
      transcripts
    });
    const aiLatency = Date.now() - aiStartTime;

    console.log(`[Intelligence] Analysis complete in ${aiLatency}ms, model: ${intelligence.model}`);

    // 3. Generate AI tip from golden script
    console.log(`[Intelligence] Generating AI tip...`);

    let callStage: 'greeting' | 'discovery' | 'objection' | 'closing';
    if (transcriptCount < 5) {
      callStage = 'greeting';
    } else if (transcriptCount < 10) {
      callStage = 'discovery';
    } else if (transcriptCount < 20) {
      callStage = 'objection';
    } else {
      callStage = 'closing';
    }

    const contextWindow = 15;
    const recentTranscripts = transcripts.slice(-contextWindow);
    const conversationContext = recentTranscripts
      .map(t => `${t.speaker.toUpperCase()}: "${t.text}"`)
      .join('\n');

    const aiTipStartTime = Date.now();
    const aiTip = await generateAITip({
      conversationId,
      callStage,
      recentTranscript: conversationContext,
      conversationSummary: intelligence.summary,
      transcriptCount
    });
    const aiTipLatency = Date.now() - aiTipStartTime;

    console.log(`[Intelligence] AI Tip generated in ${aiTipLatency}ms, Stage: ${aiTip.stage}, Heading: ${aiTip.heading}`);

    // 4. Save AI recommendation to database
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

    const totalLatency = Date.now() - requestStartTime;
    console.log(`[Intelligence] Done in ${totalLatency}ms`);

    // 5. Return AI_TIP via route response (API Gateway sends this back to client)
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 'AI_TIP',
        payload: {
          heading: aiTip.heading,
          stage: aiTip.stage,
          context: aiTip.context,
          suggestion: aiTip.suggestion,
          recommendationId,
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
