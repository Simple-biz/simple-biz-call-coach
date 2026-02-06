import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { sendToConnection } from '../shared/apigw-client';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('[Default] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  const body = JSON.parse(event.body || '{}');

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
