import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

let apigwClient: ApiGatewayManagementApiClient | null = null;

function getApiGwClient(domain: string, stage: string): ApiGatewayManagementApiClient {
  if (!apigwClient) {
    apigwClient = new ApiGatewayManagementApiClient({
      endpoint: `https://${domain}/${stage}`
    });
  }
  return apigwClient;
}

export interface WebSocketMessage {
  type: 'CONVERSATION_STARTED' | 'AI_TIP' | 'STATUS_UPDATE' | 'CONVERSATION_ENDED' | 'INTELLIGENCE_UPDATE' | 'ERROR' | 'PONG';
  payload?: any;
}

export async function sendToConnection(
  connectionId: string,
  message: WebSocketMessage,
  domain: string,
  stage: string
): Promise<boolean> {
  const client = getApiGwClient(domain, stage);

  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));

    console.log(`[API Gateway] Message sent to ${connectionId}:`, message.type);
    return true;
  } catch (error: any) {
    if (error.statusCode === 410) {
      // Connection is stale (GoneException)
      console.warn(`[API Gateway] Connection ${connectionId} is stale, removing...`);
      return false;
    }

    console.error(`[API Gateway] Error sending message to ${connectionId}:`, error);
    throw error;
  }
}

export async function broadcastToConnections(
  connectionIds: string[],
  message: WebSocketMessage,
  domain: string,
  stage: string
): Promise<number> {
  let successCount = 0;

  await Promise.all(
    connectionIds.map(async (connectionId) => {
      const sent = await sendToConnection(connectionId, message, domain, stage);
      if (sent) successCount++;
    })
  );

  console.log(`[API Gateway] Broadcast sent to ${successCount}/${connectionIds.length} connections`);
  return successCount;
}

export async function removeStaleConnection(
  connectionId: string,
  domain: string,
  stage: string
): Promise<void> {
  const client = getApiGwClient(domain, stage);

  try {
    await client.send(new DeleteConnectionCommand({
      ConnectionId: connectionId
    }));
    console.log(`[API Gateway] Stale connection removed: ${connectionId}`);
  } catch (error) {
    console.error(`[API Gateway] Error removing stale connection ${connectionId}:`, error);
  }
}
