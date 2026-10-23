import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { sendToConnection } from '../shared/apigw-client';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  const body = JSON.parse(event.body || '{}');
  console.log('[Default] connectionId:', connectionId, 'action:', body?.action);

  // Handle ping/pong for heartbeat
  if (body.action === 'ping') {
    await sendToConnection(
      connectionId,
      { type: 'PONG', payload: { timestamp: Date.now() } },
      domain,
      stage
    );
    return { statusCode: 200, body: JSON.stringify({ message: 'pong' }) };
  }

  // v3 live coach (ported from call-coach-hsl CCHv2-ST9): Realtime mini cost, one report per call
  // from the extension. A single structured line on purpose — sum it with Logs Insights:
  //   filter @message like /\[RealtimeUsage\]/ | parse @message '"costUsd":*}' as cost
  //   | stats sum(cost) by agentId, datefloor(@timestamp, 1d)
  if (body.action === 'realtimeUsage') {
    const connection = await getConnection(connectionId);
    console.log('[RealtimeUsage] ' + JSON.stringify({
      agentId: connection?.agentId ?? null,
      conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
      model: typeof body.model === 'string' ? body.model : null,
      seconds: Number(body.seconds) || 0,
      costUsd: Number(body.costUsd) || 0,
    }));
    return { statusCode: 200, body: JSON.stringify({ message: 'logged' }) };
  }

  console.warn(`[Default] Unknown message type or route:`, body);

  // Send error to client
  await sendToConnection(
    connectionId,
    {
      type: 'ERROR',
      payload: { message: 'Unknown message type', received: body }
    },
    domain,
    stage
  );

  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Unknown message type' })
  };
};
