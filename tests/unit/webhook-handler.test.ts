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

import { handler } from '@infra/lib/lambda/webhook/index';
import type { APIGatewayProxyEvent } from 'aws-lambda';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/webhook/call-events',
    headers: {
      'Authorization': 'Bearer test-secret-123',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event: 'call.started',
      callId: 'call_abc123',
      agentId: 'agent_12345',
      timestamp: 1710000000000,
      metadata: { phoneNumber: '+1234567890', campaign: 'inbound' },
    }),
    queryStringParameters: null,
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
    it('should return 401 when Authorization header is missing', async () => {
      const event = makeEvent({ headers: {} });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({ error: 'Unauthorized' });
    });

    it('should return 401 when token is invalid', async () => {
      const event = makeEvent({
        headers: { Authorization: 'Bearer wrong-secret' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should return 401 when Authorization header is not Bearer', async () => {
      const event = makeEvent({
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });

    it('should accept valid Bearer token', async () => {
      const event = makeEvent();
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should handle lowercase authorization header', async () => {
      const event = makeEvent({
        headers: { authorization: 'Bearer test-secret-123' },
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

    it('should return 400 for missing event type', async () => {
      const event = makeEvent({
        body: JSON.stringify({
          callId: 'call_123',
          agentId: 'agent_1',
          timestamp: 123,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('Invalid event type');
    });

    it('should return 400 for invalid event type', async () => {
      const event = makeEvent({
        body: JSON.stringify({
          event: 'call.transferred',
          callId: 'call_123',
          agentId: 'agent_1',
          timestamp: 123,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 for missing callId', async () => {
      const event = makeEvent({
        body: JSON.stringify({
          event: 'call.started',
          agentId: 'agent_1',
          timestamp: 123,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('callId');
    });

    it('should return 400 for missing agentId', async () => {
      const event = makeEvent({
        body: JSON.stringify({
          event: 'call.started',
          callId: 'call_123',
          timestamp: 123,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('agentId');
    });

    it('should return 400 for missing timestamp', async () => {
      const event = makeEvent({
        body: JSON.stringify({
          event: 'call.started',
          callId: 'call_123',
          agentId: 'agent_1',
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('timestamp');
    });

    it('should accept call.started event', async () => {
      const event = makeEvent();
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should accept call.ended event', async () => {
      const event = makeEvent({
        body: JSON.stringify({
          event: 'call.ended',
          callId: 'call_abc123',
          agentId: 'agent_12345',
          timestamp: 1710000000000,
        }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Idempotency', () => {
    it('should skip duplicate events', async () => {
      // Simulate existing event in DynamoDB
      mockDynamoSend.mockImplementation((cmd: any) => {
        if (cmd._type === 'GetItem') {
          return Promise.resolve({
            Item: {
              callId: { S: 'call_abc123' },
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
    it('should store event in call_events table', async () => {
      const event = makeEvent();
      await handler(event);

      // Find the PutItem call
      const putCall = mockDynamoSend.mock.calls.find(
        (call: any) => call[0]._type === 'PutItem'
      );
      expect(putCall).toBeDefined();

      const putInput = putCall![0].input;
      expect(putInput.TableName).toBe('test-call-events');
      expect(putInput.Item.callId.S).toBe('call_abc123');
      expect(putInput.Item.event.S).toBe('call.started');
      expect(putInput.Item.agentId.S).toBe('agent_12345');
      expect(putInput.Item.ttl).toBeDefined();
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
    it('should broadcast to connected extensions for the agent', async () => {
      // Mock: agent has one connected extension
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

      // Verify message format
      const sentMessage = mockSendToConnection.mock.calls[0][1];
      expect(sentMessage.type).toBe('STATUS_UPDATE');
      expect(sentMessage.payload.event).toBe('CALL_STARTED');
      expect(sentMessage.payload.callId).toBe('call_abc123');
      expect(sentMessage.payload.agentId).toBe('agent_12345');
    });

    it('should broadcast CALL_ENDED for call.ended events', async () => {
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
        body: JSON.stringify({
          event: 'call.ended',
          callId: 'call_abc123',
          agentId: 'agent_12345',
          timestamp: 1710000000000,
        }),
      });
      const result = await handler(event);

      const sentMessage = mockSendToConnection.mock.calls[0][1];
      expect(sentMessage.payload.event).toBe('CALL_ENDED');
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

      // First call fails, second succeeds
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
  });
});
