# AWS WebSocket Migration Guide

## Overview

The DevAssist Call Coach extension has been migrated from a traditional backend server to AWS serverless infrastructure using API Gateway WebSocket and Lambda functions.

## Architecture

```
Chrome Extension (Client)
    ↓
AWS API Gateway WebSocket (wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production)
    ↓
Lambda Functions (Node.js 20.x with Claude 4.5 AI)
    ├── ConnectHandler: Authenticates WebSocket connections
    ├── DisconnectHandler: Cleans up connections
    ├── DefaultHandler: Handles unknown routes
    ├── StartConversationHandler: Initiates AI coaching session
    ├── TranscriptHandler: Processes transcripts with Claude AI
    └── EndConversationHandler: Ends coaching session
    ↓
DynamoDB (devassist-websocket-connections)
PostgreSQL RDS (conversation history)
```

## WebSocket Routes

### 1. `$connect`
- **Handler**: `ConnectHandler`
- **Purpose**: Authenticate and initialize WebSocket connection
- **Auth**: Validates `BACKEND_API_KEY` in connection query params
- **Response**: Connection accepted or rejected

### 2. `startConversation`
- **Handler**: `StartConversationHandler`
- **Payload**:
  ```json
  {
    "action": "startConversation",
    "agentId": "agent@example.com",
    "metadata": {
      "source": "devassist-call-coach",
      "tabId": 123
    }
  }
  ```
- **Response**:
  ```json
  {
    "type": "CONVERSATION_STARTED",
    "payload": {
      "conversationId": "uuid-v4"
    }
  }
  ```

### 3. `transcript`
- **Handler**: `TranscriptHandler` (CRITICAL PATH - 60s timeout, 1024MB memory)
- **Payload**:
  ```json
  {
    "action": "transcript",
    "conversationId": "uuid-v4",
    "speaker": "caller" | "agent",
    "text": "Customer said something...",
    "isFinal": true,
    "timestamp": 1234567890
  }
  ```
- **Processing**:
  1. Save transcript to PostgreSQL
  2. Determine conversation stage (greeting vs objection)
  3. Call Claude AI (Haiku for greeting, Sonnet for objections)
  4. Return 3 dialogue options with recommendation
- **Response**:
  ```json
  {
    "type": "AI_TIP",
    "payload": {
      "heading": "Ask Discovery",
      "stage": "DISCOVERY",
      "context": "Customer mentioned price concerns",
      "options": [
        { "label": "Minimal", "script": "What matters most?" },
        { "label": "Explanative", "script": "I understand budget is important. What specific features are you looking for?" },
        { "label": "Contextual", "script": "Given your budget, let's focus on the features that will give you the best ROI..." }
      ],
      "recommendationId": "uuid-v4",
      "timestamp": 1234567890
    }
  }
  ```

### 4. `endConversation`
- **Handler**: `EndConversationHandler`
- **Payload**:
  ```json
  {
    "action": "endConversation",
    "conversationId": "uuid-v4",
    "timestamp": 1234567890
  }
  ```
- **Response**:
  ```json
  {
    "type": "CONVERSATION_ENDED",
    "payload": {
      "conversationId": "uuid-v4"
    }
  }
  ```

### 5. `$disconnect`
- **Handler**: `DisconnectHandler`
- **Purpose**: Clean up connection metadata in DynamoDB
- **No payload required** - automatic on WebSocket close

## Frontend Integration

### AWS WebSocket Service

Location: `src/services/aws-websocket.service.ts`

```typescript
import { awsWebSocketService } from '@/services/aws-websocket.service';

// Connect to AWS API Gateway
await awsWebSocketService.connect();

// Set up event listeners
awsWebSocketService.setStatusListener((status) => {
  console.log('Connection status:', status);
});

awsWebSocketService.setAITipListener((tip) => {
  console.log('AI Tip:', tip);
});

// Start conversation
const conversationId = await awsWebSocketService.startConversation('agent@example.com');

// Send transcript
await awsWebSocketService.sendTranscript('caller', 'Customer said something', true);

// End conversation
await awsWebSocketService.endConversation();

// Disconnect
awsWebSocketService.disconnect();
```

### Background Service Worker

The background service worker (`src/background/index.ts`) automatically:
1. Connects to AWS WebSocket when recording starts
2. Forwards transcripts from Deepgram to AWS Lambda
3. Broadcasts AI recommendations to UI components
4. Handles reconnection on connection loss

### Message Flow

```
Content Script (CallTools page)
    ↓ [WEBRTC_STREAMS_READY]
Background Service Worker
    ↓ [START_WEBRTC_CAPTURE]
Offscreen Document
    ↓ [Deepgram WebSocket]
TRANSCRIPTION_UPDATE
    ↓
Background Service Worker
    ↓ [AWS WebSocket: transcript]
AWS Lambda (TranscriptHandler)
    ↓ [Claude AI]
AI_TIP response
    ↓
Background Service Worker
    ↓ [Broadcast to UI]
Sidepanel (displays AI recommendations)
```

## Environment Configuration

### Production
- WebSocket URL: `wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production`
- Region: `us-east-1`
- Backend API Key: Stored in `src/config/aws.ts`

### Development
- Use local Docker simulation (future implementation)
- Environment badge shows "DEV" vs "PROD"

## Monitoring

### CloudWatch Dashboard
URL: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=DevAssist-WebSocket-Monitoring

Metrics:
- WebSocket connection count
- Message throughput
- Integration latency
- Lambda duration
- Error rates
- Lambda throttles

### CloudWatch Alarms
Email alerts sent to: cobb@simple.biz

1. **HighErrorRate**: >10 errors in 10 minutes
2. **LambdaThrottling**: >5 throttles in 5 minutes
3. **HighLatency**: >5s duration for 3 periods
4. **LambdaErrors**: >5 errors in 10 minutes

### X-Ray Tracing
All Lambda functions have X-Ray tracing enabled for distributed tracing and performance analysis.

## Cost Optimization

### Provisioned Concurrency
- **ConnectHandler**: 2 warm instances (fast connection)
- **TranscriptHandler**: 5 warm instances (zero cold starts for AI processing)

### Claude AI Models
- **Greeting Stage**: Claude Haiku 4.5 (<500ms response)
- **Objection Handling**: Claude Sonnet 4.5 (<2s response, higher quality)

### Prompt Caching
- 90% cost reduction after first request
- Golden scripts library cached (1024+ tokens)
- Ephemeral cache control for system prompts

## Deployment

### CDK Deployment
```bash
cd infra
export DATABASE_URL="postgresql://..."
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export BACKEND_API_KEY="devassist-..."
export ALERT_EMAIL="cobb@simple.biz"
npx cdk deploy --all
```

### Outputs
- `WebSocketURL`: WebSocket API Gateway URL
- `WebSocketApiId`: API Gateway ID
- `ConnectHandlerName`: Lambda function name
- `TranscriptHandlerName`: Lambda function name
- `DashboardURL`: CloudWatch dashboard URL
- `AlarmTopicArn`: SNS topic ARN

## Troubleshooting

### Connection Issues
1. Check CloudWatch logs for Lambda function
2. Verify WebSocket connection in Network tab
3. Check API Gateway WebSocket metrics
4. Review X-Ray traces for errors

### AI Recommendations Not Appearing
1. Verify `awsWebSocketService.isConnected()` returns `true`
2. Check transcript is marked `isFinal: true`
3. Review TranscriptHandler logs in CloudWatch
4. Verify Claude API key is valid

### High Latency
1. Check provisioned concurrency allocation
2. Review CloudWatch metrics for cold starts
3. Optimize Claude prompt length
4. Enable prompt caching for frequently used prompts

## Testing

### Manual Testing
1. Load extension in Chrome
2. Navigate to CallTools.io
3. Start a call
4. Click "Start AI Coaching"
5. Verify:
   - WebSocket connects (check Network tab)
   - Transcripts appear in sidepanel
   - AI recommendations appear with 3 options
   - Clicking option marks it as selected

### Automated Testing
(Future implementation with Playwright)
- WebSocket connection test
- Transcript forwarding test
- AI recommendation test
- Reconnection test

## Security

### API Key Management
- Backend API key stored in AWS CDK stack
- Validated on `$connect` route
- Never exposed to client (except in config file)

### WebSocket Security
- WSS (TLS encryption)
- Connection ID tracking in DynamoDB
- 2-hour TTL for stale connections
- API Gateway rate limiting (10,000 req/s, 5,000 burst)

### Lambda IAM Roles
- Least privilege access
- DynamoDB read/write only to connections table
- RDS IAM authentication support
- API Gateway ManageConnections permission

## Future Enhancements

1. **Dev Mode Docker Simulation**
   - Local WebSocket server
   - Mock Lambda responses
   - Faster development iteration

2. **Playwright E2E Tests**
   - WebSocket connection tests
   - AI recommendation flow tests
   - Error handling tests

3. **CloudWatch Insights Queries**
   - Custom log analysis
   - Performance optimization insights
   - User behavior analytics

4. **Claude Prompt Optimization**
   - A/B test different prompts
   - Measure accuracy and relevance
   - Optimize token usage
