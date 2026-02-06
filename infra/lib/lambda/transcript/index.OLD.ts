import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection, saveTranscript, getTranscriptCount, saveAIRecommendation, getConversationSummary } from '../shared/db-client';
import { generateAITip } from '../shared/claude-client';
import { sendToConnection } from '../shared/apigw-client';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
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
    const { speaker, text, timestamp } = body;

    if (!speaker || !text) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing speaker or text' }) };
    }

    // 1. Save transcript to PostgreSQL
    await saveTranscript({
      conversation_id: connection.conversationId,
      speaker,
      text,
      timestamp: new Date(timestamp || Date.now()),
      is_final: true
    });

    console.log(`[Transcript] Saved: ${speaker}: ${text.substring(0, 50)}...`);

    // 2. Determine call stage (greeting vs objection)
    const transcriptCount = await getTranscriptCount(connection.conversationId);
    const callStage = transcriptCount < 10 ? 'greeting' : 'objection';

    console.log(`[Transcript] Call stage: ${callStage}, transcript count: ${transcriptCount}`);

    // 3. Generate AI tip using Claude (Haiku or Sonnet)
    let conversationSummary = '';
    if (callStage !== 'greeting') {
      conversationSummary = await getConversationSummary(connection.conversationId);
    }

    const aiTip = await generateAITip({
      conversationId: connection.conversationId,
      callStage,
      recentTranscript: text,
      conversationSummary
    });

    console.log(`[Transcript] AI tip generated using ${aiTip.model} in ${aiTip.latency}ms`);

    // 4. Save AI recommendation to PostgreSQL
    await saveAIRecommendation({
      conversation_id: connection.conversationId,
      heading: aiTip.heading,
      suggestion: aiTip.suggestion,
      model_used: aiTip.model,
      latency_ms: aiTip.latency,
      reasoning: aiTip.reasoning,
      cached_tokens: aiTip.cachedTokens,
      input_tokens: aiTip.inputTokens,
      output_tokens: aiTip.outputTokens
    });

    // 5. Send AI tip back to client via WebSocket
    await sendToConnection(
      connectionId,
      {
        type: 'AI_TIP',
        payload: {
          heading: aiTip.heading,
          suggestion: aiTip.suggestion,
          model: aiTip.model,
          latency: aiTip.latency,
          cached: (aiTip.cachedTokens || 0) > 0,
          timestamp: Date.now()
        }
      },
      domain,
      stage
    );

    console.log(`[Transcript] AI tip sent to client`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Processed successfully' })
    };
  } catch (error) {
    console.error('[Transcript] Error:', error);

    // Send error status to client
    try {
      await sendToConnection(
        connectionId,
        {
          type: 'STATUS_UPDATE',
          payload: { status: 'error', message: 'AI temporarily unavailable' }
        },
        domain,
        stage
      );
    } catch (sendError) {
      console.error('[Transcript] Error sending error status:', sendError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
