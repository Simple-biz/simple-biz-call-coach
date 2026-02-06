import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { saveTranscript, getTranscriptCount, saveAIRecommendation, getConversationSummary } from '../shared/postgres-client';
import { generateAITip, recordMetrics, getPerformanceMetrics } from '../shared/claude-client-optimized';
import { sendToConnection } from '../shared/apigw-client';

// CEO Performance Target: <3s end-to-end
const CEO_LATENCY_TARGET_MS = 3000;
const CLAUDE_LATENCY_BUDGET_MS = 2000; // Reserve 1s for network/DB

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestStartTime = Date.now();
  console.log('[Transcript] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  try {
    // Get connection info
    const connection = await getConnection(connectionId);
    if (!connection) {
      console.error('[Transcript] Connection not found');
      return { statusCode: 404, body: JSON.stringify({ error: 'Connection not found' }) };
    }

    if (!connection.conversationId) {
      console.error('[Transcript] No conversation ID associated with connection');
      return { statusCode: 400, body: JSON.stringify({ error: 'No active conversation' }) };
    }

    // Parse message body
    const body = JSON.parse(event.body || '{}');
    const { speaker, text, timestamp, isFinal } = body;

    if (!speaker || !text) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing speaker or text' }) };
    }

    // OPTIMIZATION: Only process FINAL transcripts to reduce load
    if (!isFinal) {
      console.log('[Transcript] Skipping interim transcript');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Interim transcript - no processing' })
      };
    }

    // 1. Save transcript to PostgreSQL (parallel with AI call)
    const saveTranscriptPromise = saveTranscript({
      conversation_id: connection.conversationId,
      speaker,
      text,
      timestamp: new Date(timestamp || Date.now()),
      is_final: true
    });

    // 2. Get transcript count (needed for stage determination)
    const transcriptCount = await getTranscriptCount(connection.conversationId);

    // 3. Determine call stage based on transcript count
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

    console.log(`[Transcript] Stage: ${callStage}, Count: ${transcriptCount}`);

    // DISABLED: Automatic AI tip generation
    // AI tips are now ONLY generated when user clicks "Get Next Suggestion" button
    // This triggers REQUEST_NEXT_TIP → getIntelligence → IntelligenceHandler

    /*
    // 4. Get conversation summary (only for non-greeting stages)
    let conversationSummary = '';
    if (callStage !== 'greeting') {
      conversationSummary = await getConversationSummary(connection.conversationId);
    }

    // 5. Generate AI tip using optimized Claude client
    const aiStartTime = Date.now();
    const aiTip = await generateAITip({
      conversationId: connection.conversationId,
      callStage,
      recentTranscript: text,
      conversationSummary,
      transcriptCount
    });

    const aiLatency = Date.now() - aiStartTime;

    // Record metrics for monitoring
    recordMetrics(aiTip);
    */

    // Performance logging
    const totalLatency = Date.now() - requestStartTime;
    console.log(`[Transcript] Performance: ${totalLatency}ms (transcript saved only, no AI generation)`);

    // CEO Performance Alert
    if (totalLatency > CEO_LATENCY_TARGET_MS) {
      console.error(`[Transcript] ⚠️ CEO LATENCY TARGET EXCEEDED: ${totalLatency}ms > ${CEO_LATENCY_TARGET_MS}ms`);
    }

    // Wait for transcript save to complete
    await saveTranscriptPromise;

    // DISABLED: Automatic AI tip sending
    // AI tips are now ONLY sent when user clicks "Get Next Suggestion"
    /*
    // 6. Save AI recommendation to PostgreSQL (with performance metrics)
    await saveAIRecommendation({
      conversation_id: connection.conversationId,
      heading: 'MARK_SCRIPT',
      suggestion: aiTip.suggestion,
      model_used: aiTip.model,
      latency_ms: aiTip.latency,
      reasoning: `Stage: ${aiTip.stage}, Cache: ${(aiTip.cacheHitRate * 100).toFixed(1)}%`,
      cached_tokens: aiTip.tokenMetrics.cached,
      input_tokens: aiTip.tokenMetrics.input,
      output_tokens: aiTip.tokenMetrics.output
    });

    // 7. Send SINGLE AI suggestion back to client via WebSocket
    await sendToConnection(
      connectionId,
      {
        type: 'AI_TIP',
        payload: {
          suggestion: aiTip.suggestion,
          stage: aiTip.stage,
          model: aiTip.model,
          latency: aiTip.latency,
          cacheHit: aiTip.cacheHitRate > 0.5,
          timestamp: Date.now(),
          performanceMetrics: {
            totalLatency,
            aiLatency,
            cacheHitRate: aiTip.cacheHitRate,
            meetsTarget: totalLatency < CEO_LATENCY_TARGET_MS
          }
        }
      },
      domain,
      stage
    );

    console.log(`[Transcript] AI tip sent to client: "${aiTip.suggestion.substring(0, 60)}..."`);

    // Log aggregate performance metrics every 10 requests
    if (transcriptCount % 10 === 0) {
      const metrics = getPerformanceMetrics();
      console.log('[Transcript] Aggregate Performance Metrics:', JSON.stringify(metrics));
    }
    */

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Processed successfully',
        latency: totalLatency,
        meetsTarget: totalLatency < CEO_LATENCY_TARGET_MS
      })
    };

  } catch (error: any) {
    console.error('[Transcript] Error:', error);

    const totalLatency = Date.now() - requestStartTime;
    console.error(`[Transcript] Failed after ${totalLatency}ms:`, error.message);

    // Send error status to client with fallback suggestion
    try {
      await sendToConnection(
        connectionId,
        {
          type: 'AI_TIP',
          payload: {
            suggestion: "Good morning, can you hear me okay?", // Fallback to safest script
            stage: 'GREETING',
            model: 'fallback',
            latency: totalLatency,
            cacheHit: false,
            timestamp: Date.now(),
            error: 'AI temporarily unavailable - using fallback script'
          }
        },
        domain,
        stage
      );
    } catch (sendError) {
      console.error('[Transcript] Error sending fallback:', sendError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error', latency: totalLatency })
    };
  }
};
