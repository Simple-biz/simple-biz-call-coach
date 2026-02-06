import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection, endConversation } from '../shared/db-client';
import { sendToConnection } from '../shared/apigw-client';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('[EndConversation] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  try {
    // Get connection info
    const connection = await getConnection(connectionId);
    if (!connection) {
      console.error('[EndConversation] Connection not found');
      return { statusCode: 404, body: JSON.stringify({ error: 'Connection not found' }) };
    }

    if (!connection.conversationId) {
      console.error('[EndConversation] No active conversation');
      return { statusCode: 400, body: JSON.stringify({ error: 'No active conversation' }) };
    }

    // End conversation in PostgreSQL
    await endConversation(connection.conversationId);

    console.log(`[EndConversation] Conversation ${connection.conversationId} ended`);

    // Send confirmation to client
    await sendToConnection(
      connectionId,
      {
        type: 'CONVERSATION_ENDED',
        payload: { conversationId: connection.conversationId }
      },
      domain,
      stage
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Conversation ended' })
    };
  } catch (error) {
    console.error('[EndConversation] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
