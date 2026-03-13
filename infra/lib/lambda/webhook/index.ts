import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { sendToConnection, WebSocketMessage } from '../shared/apigw-client';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const CALL_EVENTS_TABLE = process.env.CALL_EVENTS_TABLE!;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const CALLTOOLS_WEBHOOK_SECRET = process.env.CALLTOOLS_WEBHOOK_SECRET!;
const WEBSOCKET_API_DOMAIN = process.env.WEBSOCKET_API_DOMAIN!;
const WEBSOCKET_API_STAGE = process.env.WEBSOCKET_API_STAGE || 'production';

// Valid event types from CallTools
const VALID_EVENTS = ['call.started', 'call.ended'] as const;
type CallToolsEventType = typeof VALID_EVENTS[number];

export interface CallToolsWebhookPayload {
  event: CallToolsEventType;
  callId: string;
  agentId: string;
  timestamp: number;
  metadata?: {
    phoneNumber?: string;
    campaign?: string;
    [key: string]: any;
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  console.log('[Webhook] Received call event webhook');

  // 1. Validate Authorization header
  const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[Webhook] Missing or malformed Authorization header');
    return response(401, { error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  if (token !== CALLTOOLS_WEBHOOK_SECRET) {
    console.warn('[Webhook] Invalid webhook secret');
    return response(401, { error: 'Unauthorized' });
  }

  // 2. Parse and validate payload
  let payload: CallToolsWebhookPayload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    console.warn('[Webhook] Invalid JSON body');
    return response(400, { error: 'Invalid JSON body' });
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    console.warn('[Webhook] Validation failed:', validationError);
    return response(400, { error: validationError });
  }

  console.log(`[Webhook] Processing ${payload.event} for agent ${payload.agentId}, call ${payload.callId}`);

  // 3. Idempotency check — skip if this exact event was already processed
  const alreadyProcessed = await checkIdempotency(payload.callId, payload.event);
  if (alreadyProcessed) {
    console.log(`[Webhook] Duplicate event skipped: ${payload.callId}/${payload.event}`);
    return response(200, { message: 'Event already processed', callId: payload.callId });
  }

  // 4. Store event in DynamoDB
  await storeCallEvent(payload);

  // 5. Look up connected extensions for this agentId and broadcast
  const broadcastCount = await broadcastToAgent(payload);

  const latencyMs = Date.now() - startTime;
  console.log(`[Webhook] Processed ${payload.event} in ${latencyMs}ms, broadcast to ${broadcastCount} connection(s)`);

  if (latencyMs > 300) {
    console.warn(`[Webhook] Latency exceeded 300ms target: ${latencyMs}ms`);
  }

  return response(200, {
    message: 'Event processed',
    callId: payload.callId,
    broadcastCount,
    latencyMs,
  });
}

function validatePayload(payload: any): string | null {
  if (!payload.event || !VALID_EVENTS.includes(payload.event)) {
    return `Invalid event type. Expected one of: ${VALID_EVENTS.join(', ')}`;
  }
  if (!payload.callId || typeof payload.callId !== 'string') {
    return 'Missing or invalid callId';
  }
  if (!payload.agentId || typeof payload.agentId !== 'string') {
    return 'Missing or invalid agentId';
  }
  if (!payload.timestamp || typeof payload.timestamp !== 'number') {
    return 'Missing or invalid timestamp';
  }
  return null;
}

async function checkIdempotency(callId: string, event: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: CALL_EVENTS_TABLE,
      Key: {
        callId: { S: callId },
        event: { S: event },
      },
    }));
    return !!result.Item;
  } catch (error) {
    console.error('[Webhook] Idempotency check failed:', error);
    // On error, proceed with processing (safe — storeCallEvent uses conditional put)
    return false;
  }
}

async function storeCallEvent(payload: CallToolsWebhookPayload): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24 hours

  const item: Record<string, any> = {
    callId: { S: payload.callId },
    event: { S: payload.event },
    agentId: { S: payload.agentId },
    timestamp: { N: payload.timestamp.toString() },
    ttl: { N: ttl.toString() },
  };

  if (payload.metadata) {
    item.metadata = { S: JSON.stringify(payload.metadata) };
  }

  try {
    await dynamoClient.send(new PutItemCommand({
      TableName: CALL_EVENTS_TABLE,
      Item: item,
      // Conditional put for idempotency — won't overwrite existing
      ConditionExpression: 'attribute_not_exists(callId) AND attribute_not_exists(#evt)',
      ExpressionAttributeNames: { '#evt': 'event' },
    }));
    console.log(`[Webhook] Event stored: ${payload.callId}/${payload.event}`);
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`[Webhook] Event already exists (conditional put): ${payload.callId}/${payload.event}`);
      return;
    }
    console.error('[Webhook] Error storing event:', error);
    throw error;
  }
}

async function broadcastToAgent(payload: CallToolsWebhookPayload): Promise<number> {
  // Query connections by agentId using GSI
  let connectionIds: string[];
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'agentId-index',
      KeyConditionExpression: 'agentId = :agentId',
      ExpressionAttributeValues: {
        ':agentId': { S: payload.agentId },
      },
    }));

    connectionIds = (result.Items || [])
      .map(item => item.connectionId?.S)
      .filter((id): id is string => !!id);
  } catch (error) {
    console.error('[Webhook] Error querying connections for agent:', error);
    return 0;
  }

  if (connectionIds.length === 0) {
    console.log(`[Webhook] No connected extensions for agent ${payload.agentId}`);
    return 0;
  }

  console.log(`[Webhook] Found ${connectionIds.length} connection(s) for agent ${payload.agentId}`);

  // Map CallTools event to extension message type
  const messageType = payload.event === 'call.started' ? 'CALL_STARTED' : 'CALL_ENDED';

  const message: WebSocketMessage = {
    type: 'STATUS_UPDATE',
    payload: {
      event: messageType,
      callId: payload.callId,
      agentId: payload.agentId,
      timestamp: payload.timestamp,
      metadata: payload.metadata,
    },
  };

  let successCount = 0;
  await Promise.all(
    connectionIds.map(async (connectionId) => {
      try {
        const sent = await sendToConnection(connectionId, message, WEBSOCKET_API_DOMAIN, WEBSOCKET_API_STAGE);
        if (sent) successCount++;
      } catch (error) {
        console.error(`[Webhook] Failed to send to ${connectionId}:`, error);
      }
    })
  );

  return successCount;
}

function response(statusCode: number, body: Record<string, any>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}
