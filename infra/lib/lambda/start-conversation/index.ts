import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { getConnection, updateConnection } from '../shared/dynamo-client';
import { createConversation } from '../shared/postgres-client';
import { sendToConnection } from '../shared/apigw-client';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('[StartConversation] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  try {
    // Get connection info
    const connection = await getConnection(connectionId);
    if (!connection) {
      console.error('[StartConversation] Connection not found');
      return { statusCode: 404, body: JSON.stringify({ error: 'Connection not found' }) };
    }

    // Parse message body
    const body = JSON.parse(event.body || '{}');
    const { agentId } = body;

    if (!agentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing agentId' }) };
    }

    // Create conversation in PostgreSQL
    const conversationId = await createConversation(agentId);

    // Update connection with agentId and conversationId
    await updateConnection(connectionId, {
      agentId,
      conversationId,
      lastActiveAt: Date.now()
    });

    console.log(`[StartConversation] Conversation ${conversationId} started for agent ${agentId}`);

    // Send confirmation to client
    await sendToConnection(
      connectionId,
      {
        type: 'CONVERSATION_STARTED',
        payload: { conversationId, agentId }
      },
      domain,
      stage
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ conversationId })
    };
  } catch (error) {
    console.error('[StartConversation] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
