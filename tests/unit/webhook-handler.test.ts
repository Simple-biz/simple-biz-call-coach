import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks and env setup (available to vi.mock factory functions)
const { mockDynamoSend, mockSendToConnection } = vi.hoisted(() => {
  // Set env vars before any module loads
  process.env.CALL_EVENTS_TABLE = 'test-call-events';
  process.env.CONNECTIONS_TABLE = 'test-connections';
  process.env.CALLTOOLS_WEBHOOK_SECRET = 'test-secret-123';
  process.env.WEBSOCKET_API_DOMAIN = 'abc123.execute-api.us-east-1.amazonaws.com';
  process.env.WEBSOCKET_API_STAGE = 'production';

  return {
    mockDynamoSend: vi.fn(),
    mockSendToConnection: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class {
      send = mockDynamoSend;
    },
    PutItemCommand: class {
      input: any;
      _type = 'PutItem';
      constructor(input: any) { this.input = input; }
    },
    GetItemCommand: class {
      input: any;
      _type = 'GetItem';
      constructor(input: any) { this.input = input; }
    },
    QueryCommand: class {
      input: any;
      _type = 'Query';
      constructor(input: any) { this.input = input; }
    },
  };
});

vi.mock('@infra/lib/lambda/shared/apigw-client', () => ({
  sendToConnection: (...args: any[]) => mockSendToConnection(...args),
}));

vi.mock('@infra/lib/lambda/shared/secrets-client', () => ({
  getSecret: vi.fn((key: string) => {
    const secrets: Record<string, string> = {
      CALLTOOLS_WEBHOOK_SECRET: 'test-secret-123',
    };
    return Promise.resolve(secrets[key] || '');
  }),
}));

import { handler } from '@infra/lib/lambda/webhook/index';
import type { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Sample CallTools "Call" resthook payload matching their GET /api/calls/ format.
 */
function makeCallToolsPayload(overrides: Record<string, any> = {}) {
  return {
    id: 1147264796,
    uuid: '33a2b8b8-de0c-44bc-b22a-869e3925d387',
    account_id: 18086,
    contact: null,
    app_user: '8759e97b-505c-41e6-92d9-4e68c15bae49',
    campaign: null,
    system_disposition: null,
    call_disposition: null,
    destination: '+12263361437',
    source: '+12036603494',
    inbound: false,
    start: '2025-12-12T05:02:07Z',
    end: null,
    call_type: 'outbound',
    duration: 0,
    billsec: 0,
    transferred_to: null,
    call_recording_fsfile_id: null,
    created_on: '2025-12-12T05:03:44.003997Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/webhook/call-events',
    headers: {},
    body: JSON.stringify(makeCallToolsPayload()),
    queryStringParameters: { secret: 'test-secret-123' },
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    multiValueHeaders: {},
    isBase64Encoded: false,
    ...overrides,
  };
}

describe('CallTools Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing event (idempotency check returns empty)
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetItem') return Promise.resolve({ Item: null });
      if (cmd._type === 'PutItem') return Promise.resolve({});
      if (cmd._type === 'Query') return Promise.resolve({ Items: [] });
      return Promise.resolve({});
    });
    mockSendToConnection.mockResolvedValue(true);
  });

  describe('Authorization', () => {
    it('should return 401 when no secret is provided', async () => {
      const event = makeEvent({
        headers: {},
        queryStringParameters: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({ error: 'Unauthorized' });
    });

    it('should return 401 when query param secret is wrong', async () => {
      const event = makeEvent({
        queryStringParameters: { secret: 'wrong-secret' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should accept valid secret via query param', async () => {
      const event = makeEvent();
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should accept valid Bearer token', async () => {
      const event = makeEvent({
        headers: { Authorization: 'Bearer test-secret-123' },
        queryStringParameters: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should handle lowercase authorization header', async () => {
      const event = makeEvent({
        headers: { authorization: 'Bearer test-secret-123' },
        queryStringParameters: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should return 401 when Bearer token is invalid', async () => {
      const event = makeEvent({
        headers: { Authorization: 'Bearer wrong-token' },
        queryStringParameters: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should return 401 for non-Bearer auth without query secret', async () => {
      const event = makeEvent({
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
        queryStringParameters: null,
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should prefer query param secret over Bearer token', async () => {
      const event = makeEvent({
        headers: { Authorization: 'Bearer wrong-token' },
        queryStringParameters: { secret: 'test-secret-123' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Payload validation', () => {
    it('should return 400 for invalid JSON body', async () => {
      const event = makeEvent({ body: 'not json' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Invalid JSON body');
    });

    it('should return 400 for missing uuid', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ uuid: undefined })),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('uuid');
    });

    it('should return 400 for non-string uuid', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ uuid: 12345 })),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('uuid');
    });

    it('should return 400 for missing id', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ id: undefined })),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('id');
    });

    it('should return 400 for non-number id', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ id: 'not-a-number' })),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('id');
    });

    it('should return 400 for missing start time', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ start: undefined })),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('start');
    });

    it('should accept valid CallTools payload (call in progress)', async () => {
      const event = makeEvent();
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should accept valid CallTools payload (call ended)', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({
          end: '2025-12-12T05:03:42Z',
          duration: 94,
          billsec: 92,
          system_disposition: 'Answered',
        })),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Event classification', () => {
    it('should classify as call.started when end is null and duration is 0', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ end: null, duration: 0 })),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);
      expect(body.eventType).toBe('call.started');
    });

    it('should classify as call.ended when end is set and duration > 0', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({
          end: '2025-12-12T05:03:42Z',
          duration: 94,
        })),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);
      expect(body.eventType).toBe('call.ended');
    });

    it('should classify as call.started when end is set but duration is 0', async () => {
      // Edge case: end timestamp present but zero duration (e.g., failed call)
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({
          end: '2025-12-12T05:02:08Z',
          duration: 0,
        })),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);
      expect(body.eventType).toBe('call.started');
    });
  });

  describe('Idempotency', () => {
    it('should skip duplicate events', async () => {
      mockDynamoSend.mockImplementation((cmd: any) => {
        if (cmd._type === 'GetItem') {
          return Promise.resolve({
            Item: {
              callId: { S: '33a2b8b8-de0c-44bc-b22a-869e3925d387' },
              event: { S: 'call.started' },
            },
          });
        }
        return Promise.resolve({});
      });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Event already processed');
    });

    it('should process new events', async () => {
      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Event processed');
    });
  });

  describe('DynamoDB storage', () => {
    it('should store event with correct fields from CallTools payload', async () => {
      const event = makeEvent();
      await handler(event);

      const putCall = mockDynamoSend.mock.calls.find(
        (call: any) => call[0]._type === 'PutItem'
      );
      expect(putCall).toBeDefined();

      const putInput = putCall![0].input;
      expect(putInput.TableName).toBe('test-call-events');
      expect(putInput.Item.callId.S).toBe('33a2b8b8-de0c-44bc-b22a-869e3925d387');
      expect(putInput.Item.event.S).toBe('call.started');
      expect(putInput.Item.agentId.S).toBe('8759e97b-505c-41e6-92d9-4e68c15bae49');
      expect(putInput.Item.callToolsId.N).toBe('1147264796');
      expect(putInput.Item.destination.S).toBe('+12263361437');
      expect(putInput.Item.source.S).toBe('+12036603494');
      expect(putInput.Item.callType.S).toBe('outbound');
      expect(putInput.Item.inbound.BOOL).toBe(false);
      expect(putInput.Item.ttl).toBeDefined();
    });

    it('should store optional fields when present', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({
          end: '2025-12-12T05:03:42Z',
          duration: 94,
          campaign: 5001,
          system_disposition: 'Answered',
        })),
      });
      await handler(event);

      const putCall = mockDynamoSend.mock.calls.find(
        (call: any) => call[0]._type === 'PutItem'
      );
      const putInput = putCall![0].input;
      expect(putInput.Item.duration.N).toBe('94');
      expect(putInput.Item.campaignId.N).toBe('5001');
      expect(putInput.Item.systemDisposition.S).toBe('Answered');
    });

    it('should use "unknown" for agentId when app_user is null', async () => {
      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({ app_user: null })),
      });
      await handler(event);

      const putCall = mockDynamoSend.mock.calls.find(
        (call: any) => call[0]._type === 'PutItem'
      );
      const putInput = putCall![0].input;
      expect(putInput.Item.agentId.S).toBe('unknown');
    });

    it('should use conditional put for idempotency', async () => {
      const event = makeEvent();
      await handler(event);

      const putCall = mockDynamoSend.mock.calls.find(
        (call: any) => call[0]._type === 'PutItem'
      );
      const putInput = putCall![0].input;
      expect(putInput.ConditionExpression).toContain('attribute_not_exists');
    });

    it('should handle ConditionalCheckFailedException gracefully', async () => {
      mockDynamoSend.mockImplementation((cmd: any) => {
        if (cmd._type === 'GetItem') return Promise.resolve({ Item: null });
        if (cmd._type === 'PutItem') {
          const err = new Error('Conditional check failed');
          (err as any).name = 'ConditionalCheckFailedException';
          return Promise.reject(err);
        }
        if (cmd._type === 'Query') return Promise.resolve({ Items: [] });
        return Promise.resolve({});
      });

      const event = makeEvent();
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('WebSocket broadcast', () => {
    it('should broadcast CALL_STARTED to connected extensions', async () => {
      mockDynamoSend.mockImplementation((cmd: any) => {
        if (cmd._type === 'GetItem') return Promise.resolve({ Item: null });
        if (cmd._type === 'PutItem') return Promise.resolve({});
        if (cmd._type === 'Query') {
          return Promise.resolve({
            Items: [
              { connectionId: { S: 'conn-001' } },
              { connectionId: { S: 'conn-002' } },
            ],
          });
        }
        return Promise.resolve({});
      });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).broadcastCount).toBe(2);
      expect(mockSendToConnection).toHaveBeenCalledTimes(2);

      const sentMessage = mockSendToConnection.mock.calls[0][1];
      expect(sentMessage.type).toBe('STATUS_UPDATE');
      expect(sentMessage.payload.event).toBe('CALL_STARTED');
      expect(sentMessage.payload.callId).toBe('33a2b8b8-de0c-44bc-b22a-869e3925d387');
      expect(sentMessage.payload.agentId).toBe('8759e97b-505c-41e6-92d9-4e68c15bae49');
      expect(sentMessage.payload.destination).toBe('+12263361437');
      expect(sentMessage.payload.source).toBe('+12036603494');
      expect(sentMessage.payload.callType).toBe('outbound');
      expect(sentMessage.payload.inbound).toBe(false);
    });

    it('should broadcast CALL_ENDED for ended calls', async () => {
      mockDynamoSend.mockImplementation((cmd: any) => {
        if (cmd._type === 'GetItem') return Promise.resolve({ Item: null });
        if (cmd._type === 'PutItem') return Promise.resolve({});
        if (cmd._type === 'Query') {
          return Promise.resolve({
            Items: [{ connectionId: { S: 'conn-001' } }],
          });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        body: JSON.stringify(makeCallToolsPayload({
          end: '2025-12-12T05:03:42Z',
          duration: 94,
        })),
      });
      const result = await handler(event);

      const sentMessage = mockSendToConnection.mock.calls[0][1];
      expect(sentMessage.payload.event).toBe('CALL_ENDED');
      expect(sentMessage.payload.duration).toBe(94);
      expect(sentMessage.payload.end).toBe('2025-12-12T05:03:42Z');
    });

    it('should query connections by agentId using GSI', async () => {
      const event = makeEvent();
      await handler(event);

      const queryCall = mockDynamoSend.mock.calls.find(
        (call: any) => call[0]._type === 'Query'
      );
      expect(queryCall).toBeDefined();
      const queryInput = queryCall![0].input;
      expect(queryInput.TableName).toBe('test-connections');
      expect(queryInput.IndexName).toBe('agentId-index');
      expect(queryInput.ExpressionAttributeValues[':agentId'].S).toBe(
        '8759e97b-505c-41e6-92d9-4e68c15bae49'
      );
    });

    it('should handle no connected extensions gracefully', async () => {
      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).broadcastCount).toBe(0);
      expect(mockSendToConnection).not.toHaveBeenCalled();
    });

    it('should continue broadcasting even if one connection fails', async () => {
      mockDynamoSend.mockImplementation((cmd: any) => {
        if (cmd._type === 'GetItem') return Promise.resolve({ Item: null });
        if (cmd._type === 'PutItem') return Promise.resolve({});
        if (cmd._type === 'Query') {
          return Promise.resolve({
            Items: [
              { connectionId: { S: 'conn-001' } },
              { connectionId: { S: 'conn-002' } },
            ],
          });
        }
        return Promise.resolve({});
      });

      mockSendToConnection
        .mockRejectedValueOnce(new Error('Connection gone'))
        .mockResolvedValueOnce(true);

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).broadcastCount).toBe(1);
    });
  });

  describe('Response format', () => {
    it('should return latency in response', async () => {
      const event = makeEvent();
      const result = await handler(event);

      const body = JSON.parse(result.body);
      expect(body.latencyMs).toBeDefined();
      expect(typeof body.latencyMs).toBe('number');
    });

    it('should return Content-Type header', async () => {
      const event = makeEvent();
      const result = await handler(event);
      expect(result.headers?.['Content-Type']).toBe('application/json');
    });

    it('should return callId and eventType in response', async () => {
      const event = makeEvent();
      const result = await handler(event);
      const body = JSON.parse(result.body);
      expect(body.callId).toBe('33a2b8b8-de0c-44bc-b22a-869e3925d387');
      expect(body.eventType).toBe('call.started');
    });
  });
});
