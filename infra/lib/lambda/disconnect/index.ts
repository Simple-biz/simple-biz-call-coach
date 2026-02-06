import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection, endConversation } from '../shared/db-client';
import { deleteConnection } from '../shared/dynamo-client';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('[Disconnect] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;

  try {
    // Get connection info
    const connection = await getConnection(connectionId);

    if (connection) {
      // End conversation if active
      if (connection.conversationId) {
        await endConversation(connection.conversationId);
        console.log(`[Disconnect] Conversation ${connection.conversationId} ended`);
      }

      // Delete connection from DynamoDB
      await deleteConnection(connectionId);
      console.log(`[Disconnect] Connection ${connectionId} removed`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected' })
    };
  } catch (error) {
    console.error('[Disconnect] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
