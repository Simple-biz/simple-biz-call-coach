# DevAssist Call Coach - Sandbox Docker Container

## Overview

Fully offline mock WebSocket server for Developer Mode testing. No internet connection required!

## Features

- ✅ **Mark's 28 Golden Scripts** - All scripts embedded locally
- ✅ **Mock AI Suggestions** - <1s response time (simulated Haiku)
- ✅ **Mock Intelligence** - Sentiment, entities, intents, topics
- ✅ **Stage Detection** - Automatic progression through call stages
- ✅ **Performance Metrics** - Realistic latency simulation
- ✅ **100% Offline** - No external API calls
- ✅ **Health Monitoring** - Built-in health check endpoint

## Quick Start

### Using Docker Compose (Recommended)

```bash
# From project root
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f sandbox-websocket

# Stop
docker-compose down
```

### Using Docker Directly

```bash
# Build
cd docker/sandbox
docker build -t devassist-sandbox .

# Run
docker run -d -p 8080:8080 --name devassist-sandbox devassist-sandbox

# Check logs
docker logs -f devassist-sandbox

# Stop
docker stop devassist-sandbox
docker rm devassist-sandbox
```

### Development Mode (Without Docker)

```bash
cd docker/sandbox

# Install dependencies
npm install

# Start server
npm start

# Or with auto-reload
npm run dev
```

## Endpoints

### WebSocket

```
ws://localhost:8080
```

### Health Check

```bash
curl http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy",
  "connections": 1,
  "conversations": 1,
  "uptime": 123.456
}
```

## WebSocket API

### Connect

Client automatically connects when switching to Sandbox mode.

### Start Conversation

```json
{
  "type": "START_CONVERSATION",
  "payload": {
    "agentId": "test-agent",
    "metadata": {}
  }
}
```

Response:
```json
{
  "type": "CONVERSATION_STARTED",
  "payload": {
    "conversationId": "uuid",
    "agentId": "test-agent",
    "startTime": "2026-01-30T12:00:00.000Z",
    "timestamp": 1643234567890
  }
}
```

### Send Transcript

```json
{
  "type": "TRANSCRIPT",
  "payload": {
    "conversationId": "uuid",
    "speaker": "caller",
    "text": "I'm interested in your services",
    "isFinal": true,
    "timestamp": 1643234567890
  }
}
```

Response (AI Suggestion):
```json
{
  "type": "AI_TIP",
  "payload": {
    "suggestion": "Perfect! Let me get your email and I'll send over that free audit.",
    "stage": "CLOSING",
    "model": "haiku",
    "latency": 850,
    "cacheHit": true,
    "timestamp": 1643234567890,
    "performanceMetrics": {
      "totalLatency": 1950,
      "aiLatency": 850,
      "cacheHitRate": 0.92,
      "meetsTarget": true
    }
  }
}
```

Response (Intelligence Update - every 3 transcripts):
```json
{
  "type": "INTELLIGENCE_UPDATE",
  "payload": {
    "conversationId": "uuid",
    "intelligence": {
      "sentiment": {
        "label": "positive",
        "score": 0.85,
        "averageScore": 0.85
      },
      "intents": [
        { "intent": "interested", "confidence": 0.9, "segment": "sounds good" }
      ],
      "topics": [
        { "topic": "website_optimization", "confidence": 0.88, "segment": "SEO" }
      ],
      "summary": "Customer showing strong interest in services",
      "lastUpdated": 1643234567890
    },
    "entities": {
      "businessNames": ["Simple.Biz"],
      "contactInfo": {
        "emails": ["info@simple.biz"],
        "phoneNumbers": [],
        "urls": ["https://simple.biz"]
      },
      "locations": ["Denver", "Colorado"],
      "dates": [],
      "people": ["Bob"],
      "timestamp": 1643234567890
    },
    "timestamp": 1643234567890
  }
}
```

### End Conversation

```json
{
  "type": "END_CONVERSATION",
  "payload": {
    "conversationId": "uuid"
  }
}
```

## Call Stages

The server automatically progresses through stages based on transcript count:

| Transcript Count | Stage | Scripts Available |
|-----------------|-------|-------------------|
| 1-2 | GREETING | 6 scripts |
| 3-5 | VALUE_PROP | 3 scripts |
| 6-9 | OBJECTION | 8 scripts |
| 10-14 | CLOSING | 11 scripts |
| 15+ | CONVERSION | 2 scripts |

## Mark's Golden Scripts

All 28 scripts are embedded in `mock-data.json`:

- **GREETING** (6 scripts): Audio check, introductions, business verification
- **VALUE_PROP** (3 scripts): Service benefits, traffic increases, comprehensive solutions
- **OBJECTION** (8 scripts): Handling resistance, providing value, follow-up offers
- **CLOSING** (11 scripts): Email collection, scheduling, next steps
- **CONVERSION** (2 scripts): Promotions, limited availability

## Performance

- **AI Suggestion Latency**: 600-1000ms (simulates Haiku)
- **Total End-to-End**: 1500-2500ms (under CEO's 3s target)
- **Cache Hit Rate**: 92% (simulated)
- **Intelligence Updates**: Every 3rd transcript

## Troubleshooting

### Port Already in Use

```bash
# Check what's using port 8080
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=8081 docker-compose up
```

### Container Won't Start

```bash
# Check logs
docker-compose logs sandbox-websocket

# Rebuild
docker-compose build --no-cache
docker-compose up
```

### Health Check Failing

```bash
# Check health status
docker inspect devassist-sandbox | grep Health -A 20

# Test health endpoint
curl http://localhost:8080/health
```

## Development

### File Structure

```
docker/sandbox/
├── Dockerfile          # Container image definition
├── package.json        # Node.js dependencies
├── server.js           # WebSocket server logic
├── mock-data.json      # Mark's scripts + mock intelligence
└── README.md           # This file
```

### Adding Scripts

Edit `mock-data.json` to add or modify scripts:

```json
{
  "marksGoldenScripts": {
    "NEW_STAGE": [
      "New script 1",
      "New script 2"
    ]
  }
}
```

Restart the container to apply changes.

## Integration with Chrome Extension

1. **Enable Developer Mode** in Sidepanel footer
2. **Switch to Sandbox** environment using toggle button
3. **Start Docker** container: `docker-compose up -d`
4. **Load Test Scenario** or use manual input
5. **Test offline** - disconnect internet to verify

## Logs

View real-time logs:

```bash
# Docker Compose
docker-compose logs -f sandbox-websocket

# Docker
docker logs -f devassist-sandbox

# Node.js (development)
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | WebSocket server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `NODE_ENV` | `development` | Node environment |

## License

Internal use only - DevAssist Call Coach Sandbox Environment
