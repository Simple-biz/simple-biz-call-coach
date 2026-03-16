import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { saveConnection } from '../shared/dynamo-client';

const BACKEND_API_KEY = process.env.BACKEND_API_KEY!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('[Connect] Event:', JSON.stringify(event));

  const connectionId = event.requestContext.connectionId!;
  const apiKey = event.queryStringParameters?.apiKey;

  // Authenticate — reject unauthorized connections
  if (!apiKey || apiKey !== BACKEND_API_KEY) {
    console.error(`[Connect] Authentication failed. Got: ${apiKey ? apiKey.substring(0, 10) + '...' : 'NONE'}, Expected: ${BACKEND_API_KEY ? BACKEND_API_KEY.substring(0, 10) + '...' : 'UNDEF'}`);
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Calculate TTL (2 hours from now)
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + 7200; // 2 hours

  // Debug Logging
  console.log('[Connect] Connection Details:', {
    connectionId,
    tableName: process.env.CONNECTIONS_TABLE,
    hasAgentId: !!apiKey,
    region: process.env.AWS_REGION
  });

  if (!process.env.CONNECTIONS_TABLE) {
    console.error('[Connect] CRITICAL: CONNECTIONS_TABLE environment variable is missing!');
    // If table is missing, we must fail or we can't route messages later.
    // However, for debugging, we might want to see this log.
  }

  // Save connection to DynamoDB
  try {
    await saveConnection({
      connectionId,
      connectedAt: now,
      lastActiveAt: now,
      ttl,
      metadata: {
        userAgent: event.headers['User-Agent'],
        sourceIp: event.requestContext.identity?.sourceIp
      }
    });

    console.log(`[Connect] Connection ${connectionId} registered successfully`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Connected', connectionId })
    };
  } catch (error) {
    console.error('[Connect] Error saving connection:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};
