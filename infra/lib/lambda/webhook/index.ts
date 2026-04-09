import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { sendToConnection, WebSocketMessage } from '../shared/apigw-client';
import { getSecret } from '../shared/secrets-client';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const CALL_EVENTS_TABLE = process.env.CALL_EVENTS_TABLE!;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const WEBSOCKET_API_DOMAIN = process.env.WEBSOCKET_API_DOMAIN!;
const WEBSOCKET_API_STAGE = process.env.WEBSOCKET_API_STAGE || 'production';

/**
 * CallTools resthook "Call" payload — matches the GET /api/calls/ format.
 * Webhook fires on call creation (when the call record is written).
 */
export interface CallToolsCallPayload {
  id: number;
  uuid: string;
  account_id: number;
  contact: number | null;
  app_user: string | null;           // Agent UUID in CallTools
  campaign: number | null;
  system_disposition: string | null;
  call_disposition: number | null;
  destination: string;
  source: string;
  inbound: boolean;
  start: string;                     // ISO 8601 e.g. "2025-12-12T13:01:07Z"
  end: string | null;
  call_type: string;                 // "outbound", "inbound", "async-outbound"
  duration: number;
  billsec: number;
  transferred_to: string | null;
  call_recording_fsfile_id: number | null;
  created_on: string;
  [key: string]: any;                // Future-proof for extra fields
}

/**
 * Determines if a CallTools payload represents a "call started" or "call ended" event.
 * - If `end` is null and `duration` is 0 → call.started
 * - If `end` is set → call.ended
 * CallTools "Call" resthook fires on call creation, so both are possible.
 */
function classifyEvent(payload: CallToolsCallPayload): 'call.started' | 'call.ended' {
  if (payload.end && payload.duration > 0) {
    return 'call.ended';
  }
  return 'call.started';
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  console.log('[Webhook] Received CallTools webhook');

  // 1. Validate webhook secret (query param or Authorization header)
  // CallTools doesn't send Bearer auth — we validate via a secret query param on the URL
  // e.g. https://your-lambda-url/?secret=your-secret
  const querySecret = event.queryStringParameters?.['secret'];
  const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const callToolsWebhookSecret = await getSecret('CALLTOOLS_WEBHOOK_SECRET');
  if (callToolsWebhookSecret) {
    const providedSecret = querySecret || bearerToken;
    if (!providedSecret) {
      console.warn('[Webhook] Missing webhook secret');
      return response(401, { error: 'Unauthorized' });
    }
    if (providedSecret !== callToolsWebhookSecret) {
      console.warn('[Webhook] Invalid webhook secret');
      return response(403, { error: 'Forbidden' });
    }
  }

  // 2. Parse payload
  let payload: CallToolsCallPayload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    console.warn('[Webhook] Invalid JSON body');
    return response(400, { error: 'Invalid JSON body' });
  }

  // 3. Validate required fields
  const validationError = validatePayload(payload);
  if (validationError) {
    console.warn('[Webhook] Validation failed:', validationError);
    return response(400, { error: validationError });
  }

  // Log raw payload keys to debug agent ID field
  console.log(`[Webhook] Raw payload keys:`, Object.keys(payload));
  console.log(`[Webhook] Raw payload:`, JSON.stringify(payload));

  const eventType = classifyEvent(payload);
  const callId = payload.uuid;
  // CallTools sends agent UUID as either app_user or app_user_id depending on context
  const agentId = payload.app_user || (payload as any).app_user_id || 'unknown';

  console.log(`[Webhook] Processing ${eventType} for agent ${agentId}, call ${callId}`);

  // 4. Idempotency check
  const alreadyProcessed = await checkIdempotency(callId, eventType);
  if (alreadyProcessed) {
    console.log(`[Webhook] Duplicate event skipped: ${callId}/${eventType}`);
    return response(200, { message: 'Event already processed', callId });
  }

  // 5. Store event in DynamoDB
  await storeCallEvent(callId, eventType, agentId, payload);

  // 6. Broadcast to connected extensions
  const broadcastCount = await broadcastToAgent(agentId, eventType, callId, payload);

  const latencyMs = Date.now() - startTime;
  console.log(`[Webhook] Processed ${eventType} in ${latencyMs}ms, broadcast to ${broadcastCount} connection(s)`);

  if (latencyMs > 300) {
    console.warn(`[Webhook] Latency exceeded 300ms target: ${latencyMs}ms`);
  }

  return response(200, {
    message: 'Event processed',
    callId,
    eventType,
    broadcastCount,
    latencyMs,
  });
}

function validatePayload(payload: any): string | null {
  if (!payload.uuid || typeof payload.uuid !== 'string') {
    return 'Missing or invalid uuid';
  }
  // id and start are optional for auto-dial campaigns (may arrive later)
  return null;
}

async function checkIdempotency(callId: string, eventType: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: CALL_EVENTS_TABLE,
      Key: {
        callId: { S: callId },
        event: { S: eventType },
      },
    }));
    return !!result.Item;
  } catch (error) {
    console.error('[Webhook] Idempotency check failed:', error);
    return false;
  }
}

async function storeCallEvent(
  callId: string,
  eventType: string,
  agentId: string,
  payload: CallToolsCallPayload
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const timestamp = payload.start ? new Date(payload.start).getTime() : Date.now();

  const item: Record<string, any> = {
    callId: { S: callId },
    event: { S: eventType },
    agentId: { S: agentId },
    timestamp: { N: timestamp.toString() },
    ttl: { N: ttl.toString() },
  };

  // Only add fields that exist (auto-dial may send partial payloads)
  if (payload.id != null) item.callToolsId = { N: payload.id.toString() };
  if (payload.destination) item.destination = { S: payload.destination };
  if (payload.source) item.source = { S: payload.source };
  if (payload.call_type) item.callType = { S: payload.call_type };
  if (payload.inbound != null) item.inbound = { BOOL: payload.inbound };
  if (payload.duration) item.duration = { N: payload.duration.toString() };
  if (payload.campaign) item.campaignId = { N: payload.campaign.toString() };
  if (payload.system_disposition) item.systemDisposition = { S: payload.system_disposition };

  try {
    await dynamoClient.send(new PutItemCommand({
      TableName: CALL_EVENTS_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(callId) AND attribute_not_exists(#evt)',
      ExpressionAttributeNames: { '#evt': 'event' },
    }));
    console.log(`[Webhook] Event stored: ${callId}/${eventType}`);
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`[Webhook] Event already exists (conditional put): ${callId}/${eventType}`);
      return;
    }
    console.error('[Webhook] Error storing event:', error);
    throw error;
  }
}

async function broadcastToAgent(
  agentId: string,
  eventType: string,
  callId: string,
  payload: CallToolsCallPayload
): Promise<number> {
  // Query only agent-specific connections — no broadcast fallback
  let connectionIds: string[];
  try {
    const agentResult = await dynamoClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'agentId-index',
      KeyConditionExpression: 'agentId = :agentId',
      ExpressionAttributeValues: {
        ':agentId': { S: agentId },
      },
    }));

    connectionIds = (agentResult.Items || [])
      .map(item => item.connectionId?.S)
      .filter((id): id is string => !!id);
  } catch (error) {
    console.error('[Webhook] Error querying connections:', error);
    return 0;
  }

  if (connectionIds.length === 0) {
    console.log(`[Webhook] No connected extensions for agent ${agentId}`);
    return 0;
  }

  console.log(`[Webhook] Found ${connectionIds.length} connection(s) for agent ${agentId}`);

  const messageType = eventType === 'call.started' ? 'CALL_STARTED' : 'CALL_ENDED';

  const message: WebSocketMessage = {
    type: 'STATUS_UPDATE',
    payload: {
      event: messageType,
      callId,
      agentId,
      destination: payload.destination,
      source: payload.source,
      callType: payload.call_type,
      inbound: payload.inbound,
      start: payload.start,
      end: payload.end,
      duration: payload.duration,
      campaign: payload.campaign,
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
