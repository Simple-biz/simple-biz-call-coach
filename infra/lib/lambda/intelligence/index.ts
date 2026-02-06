import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { getRecentTranscripts, getTranscriptCount, saveAIRecommendation } from '../shared/postgres-client';
import { generateConversationIntelligence } from '../shared/intelligence-client';
import { generateAITip } from '../shared/claude-client-optimized';
import { sendToConnection } from '../shared/apigw-client';

/**
 * IntelligenceHandler Lambda Function
 *
 * Purpose: Generate conversation intelligence (sentiment, entities, intents, topics)
 * using Claude Haiku 4.5 for fast, cost-effective analysis.
 *
 * Performance Target: <500ms (using Haiku for speed)
 * Trigger: Called on-demand via getIntelligence WebSocket route
 */

const INTELLIGENCE_LATENCY_TARGET_MS = 500;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestStartTime = Date.now();
  console.log('[Intelligence] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  try {
    // Get connection info
    const connection = await getConnection(connectionId);
    if (!connection) {
      console.error('[Intelligence] Connection not found');
      return { statusCode: 404, body: JSON.stringify({ error: 'Connection not found' }) };
    }

    if (!connection.conversationId) {
      console.error('[Intelligence] No conversation ID associated with connection');
      return { statusCode: 400, body: JSON.stringify({ error: 'No active conversation' }) };
    }

    const conversationId = connection.conversationId;

    // Parse message body (optional parameters)
    const body = JSON.parse(event.body || '{}');
    const { limit = 50 } = body; // Default: analyze last 50 transcripts

    console.log(`[Intelligence] Analyzing conversation: ${conversationId} (limit: ${limit})`);

    // 1. Fetch recent transcripts from PostgreSQL
    const transcripts = await getRecentTranscripts(conversationId, limit);

    if (transcripts.length === 0) {
      console.warn('[Intelligence] No transcripts found for analysis');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No transcripts available for intelligence analysis' })
      };
    }

    console.log(`[Intelligence] Fetched ${transcripts.length} transcripts for analysis`);

    // 2. Generate intelligence using Claude Haiku 4.5
    const aiStartTime = Date.now();
    const intelligence = await generateConversationIntelligence({
      conversationId,
      transcripts
    });
    const aiLatency = Date.now() - aiStartTime;

    // Performance logging
    const totalLatency = Date.now() - requestStartTime;
    console.log(`[Intelligence] Performance Breakdown:`);
    console.log(`  - AI Analysis: ${aiLatency}ms`);
    console.log(`  - Total Lambda: ${totalLatency}ms`);
    console.log(`  - Model Used: ${intelligence.model}`);
    console.log(`  - Sentiment: ${intelligence.sentiment.label} (${intelligence.sentiment.score.toFixed(2)})`);

    // Performance target alert
    if (aiLatency > INTELLIGENCE_LATENCY_TARGET_MS) {
      console.warn(`[Intelligence] ⚠️ AI latency exceeded target: ${aiLatency}ms > ${INTELLIGENCE_LATENCY_TARGET_MS}ms`);
    }

    // 3. Send INTELLIGENCE_UPDATE to client via WebSocket
    await sendToConnection(
      connectionId,
      {
        type: 'INTELLIGENCE_UPDATE',
        payload: {
          conversationId,
          intelligence: {
            sentiment: intelligence.sentiment,
            intents: intelligence.intents,
            topics: intelligence.topics,
            summary: intelligence.summary,
            lastUpdated: Date.now()
          },
          entities: intelligence.entities,
          timestamp: Date.now()
        }
      },
      domain,
      stage
    );

    console.log(`[Intelligence] Intelligence update sent to client`);

    // 4. ALSO generate a NEW AI tip from golden script based on current context
    console.log(`[Intelligence] Generating new AI tip from golden script...`);

    const transcriptCount = await getTranscriptCount(conversationId);

    // Determine call stage
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

    // Get last 10-15 transcripts for proper context (not just the last one!)
    const contextWindow = 15;
    const recentTranscripts = transcripts.slice(-contextWindow);

    // Build conversation context with speaker labels
    const conversationContext = recentTranscripts
      .map(t => `${t.speaker.toUpperCase()}: "${t.text}"`)
      .join('\n');

    console.log(`[Intelligence] Context window: ${recentTranscripts.length} messages`);

    const aiTipStartTime = Date.now();
    const aiTip = await generateAITip({
      conversationId,
      callStage,
      recentTranscript: conversationContext, // Send full context, not just last message
      conversationSummary: intelligence.summary,
      transcriptCount
    });
    const aiTipLatency = Date.now() - aiTipStartTime;

    console.log(`[Intelligence] AI Tip generated in ${aiTipLatency}ms, Stage: ${aiTip.stage}, Heading: ${aiTip.heading}`);

    // Save AI recommendation to database (store in option1, leave option2/3 as placeholders)
    const recommendationId = await saveAIRecommendation({
      conversation_id: conversationId,
      heading: aiTip.heading,
      stage: aiTip.stage,
      context: aiTip.context,
      option1_label: 'Best Match',
      option1_script: aiTip.suggestion,
      option2_label: 'Alternative',
      option2_script: aiTip.suggestion, // Same as option1 (placeholder)
      option3_label: 'Alternative',
      option3_script: aiTip.suggestion  // Same as option1 (placeholder)
    });

    // Send AI_TIP to client (single suggestion format)
    await sendToConnection(
      connectionId,
      {
        type: 'AI_TIP',
        payload: {
          heading: aiTip.heading,
          stage: aiTip.stage,
          context: aiTip.context,
          suggestion: aiTip.suggestion,
          recommendationId,
          timestamp: Date.now()
        }
      },
      domain,
      stage
    );

    console.log(`[Intelligence] New AI tip sent to client`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Intelligence and AI tip generated successfully',
        latency: totalLatency,
        transcriptCount: transcripts.length,
        aiTipGenerated: true,
        aiTipStage: aiTip.stage
      })
    };

  } catch (error: any) {
    console.error('[Intelligence] Error:', error);

    const totalLatency = Date.now() - requestStartTime;
    console.error(`[Intelligence] Failed after ${totalLatency}ms:`, error.message);

    // Send error status to client
    try {
      await sendToConnection(
        connectionId,
        {
          type: 'ERROR',
          payload: {
            message: 'Intelligence analysis temporarily unavailable',
            code: 'INTELLIGENCE_ERROR',
            timestamp: Date.now()
          }
        },
        domain,
        stage
      );
    } catch (sendError) {
      console.error('[Intelligence] Error sending error message:', sendError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', latency: totalLatency })
    };
  }
};
