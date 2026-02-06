import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

// DynamoDB Client
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

export interface WebSocketConnection {
  connectionId: string;
  agentId?: string;
  conversationId?: string;
  connectedAt: number;
  lastActiveAt: number;
  metadata?: Record<string, any>;
  ttl: number; // Auto-expire after 2 hours
}

export async function saveConnection(connection: WebSocketConnection): Promise<void> {
  try {
    if (!CONNECTIONS_TABLE) {
      throw new Error('CONNECTIONS_TABLE environment variable is not defined');
    }
    console.log(`[DynamoDB] Saving connection: ${connection.connectionId} to table ${CONNECTIONS_TABLE}`);
    const item: Record<string, any> = {
      connectionId: { S: connection.connectionId },
      connectedAt: { N: connection.connectedAt.toString() },
      lastActiveAt: { N: connection.lastActiveAt.toString() },
      ttl: { N: connection.ttl.toString() }
    };

    if (connection.agentId) {
      item.agentId = { S: connection.agentId };
    }

    if (connection.conversationId) {
      item.conversationId = { S: connection.conversationId };
    }

    if (connection.metadata) {
      item.metadata = { S: JSON.stringify(connection.metadata) };
    }

    await dynamoClient.send(new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: item
    }));
    console.log(`[DynamoDB] Connection saved: ${connection.connectionId}`);
  } catch (error) {
    console.error('[DynamoDB] Error saving connection:', error);
    throw error;
  }
}

export async function getConnection(connectionId: string): Promise<WebSocketConnection | null> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        connectionId: { S: connectionId }
      }
    }));

    if (!result.Item) {
      return null;
    }

    return {
      connectionId: result.Item.connectionId.S!,
      agentId: result.Item.agentId?.S,
      conversationId: result.Item.conversationId?.S,
      connectedAt: parseInt(result.Item.connectedAt.N!),
      lastActiveAt: parseInt(result.Item.lastActiveAt.N!),
      metadata: result.Item.metadata?.S ? JSON.parse(result.Item.metadata.S) : undefined,
      ttl: parseInt(result.Item.ttl.N!)
    };
  } catch (error) {
    console.error('[DynamoDB] Error getting connection:', error);
    return null;
  }
}

export async function updateConnection(connectionId: string, updates: Partial<WebSocketConnection>): Promise<void> {
  const updateExpression: string[] = [];
  const expressionAttributeValues: Record<string, any> = {};

  if (updates.agentId !== undefined) {
    updateExpression.push('agentId = :agentId');
    expressionAttributeValues[':agentId'] = { S: updates.agentId };
  }

  if (updates.conversationId !== undefined) {
    updateExpression.push('conversationId = :conversationId');
    expressionAttributeValues[':conversationId'] = { S: updates.conversationId };
  }

  if (updates.lastActiveAt !== undefined) {
    updateExpression.push('lastActiveAt = :lastActiveAt');
    expressionAttributeValues[':lastActiveAt'] = { N: updates.lastActiveAt.toString() };
  }

  if (updateExpression.length === 0) {
    return;
  }

  try {
    await dynamoClient.send(new UpdateItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        connectionId: { S: connectionId }
      },
      UpdateExpression: `SET ${updateExpression.join(', ')}`,
      ExpressionAttributeValues: expressionAttributeValues
    }));
    console.log(`[DynamoDB] Connection updated: ${connectionId}`);
  } catch (error) {
    console.error('[DynamoDB] Error updating connection:', error);
    throw error;
  }
}

export async function deleteConnection(connectionId: string): Promise<void> {
  try {
    await dynamoClient.send(new DeleteItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        connectionId: { S: connectionId }
      }
    }));
    console.log(`[DynamoDB] Connection deleted: ${connectionId}`);
  } catch (error) {
    console.error('[DynamoDB] Error deleting connection:', error);
    throw error;
  }
}
