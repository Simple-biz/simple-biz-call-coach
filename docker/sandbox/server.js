/**
 * DevAssist Call Coach - Sandbox WebSocket Server
 * Fully offline mock server with Mark's 28 Golden Scripts
 */

const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const http = require('http');

// Load mock data
const mockData = JSON.parse(fs.readFileSync('./mock-data.json', 'utf8'));

// Server configuration
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// In-memory storage
const connections = new Map(); // connectionId -> { conversationId, transcriptCount, stage }
const conversations = new Map(); // conversationId -> { transcripts[], startTime }

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      connections: connections.size,
      conversations: conversations.size,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log('🚀 [Sandbox] Starting DevAssist Call Coach Mock Server...');
console.log('📦 [Sandbox] Loaded Mark\'s 28 Golden Scripts');
console.log(`🔧 [Sandbox] Environment: OFFLINE (No external dependencies)`);

wss.on('connection', (ws, req) => {
  const connectionId = uuidv4();
  console.log(`✅ [Sandbox] New connection: ${connectionId}`);

  // Initialize connection
  connections.set(connectionId, {
    conversationId: null,
    transcriptCount: 0,
    stage: 'GREETING',
    ws
  });

  // Send connection acknowledgment
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    connectionId,
    timestamp: Date.now()
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(connectionId, message, ws);
    } catch (error) {
      console.error('❌ [Sandbox] Error parsing message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: {
          message: 'Invalid JSON',
          code: 'PARSE_ERROR',
          timestamp: Date.now()
        }
      }));
    }
  });

  ws.on('close', () => {
    console.log(`👋 [Sandbox] Connection closed: ${connectionId}`);
    const connection = connections.get(connectionId);
    if (connection && connection.conversationId) {
      conversations.delete(connection.conversationId);
    }
    connections.delete(connectionId);
  });

  ws.on('error', (error) => {
    console.error(`❌ [Sandbox] WebSocket error for ${connectionId}:`, error.message);
  });
});

function handleMessage(connectionId, message, ws) {
  const { type, payload } = message;
  console.log(`📨 [Sandbox] Message from ${connectionId}: ${type}`);

  switch (type) {
    case 'START_CONVERSATION':
      handleStartConversation(connectionId, payload, ws);
      break;

    case 'TRANSCRIPT':
      handleTranscript(connectionId, payload, ws);
      break;

    case 'END_CONVERSATION':
      handleEndConversation(connectionId, payload, ws);
      break;

    case 'OPTION_SELECTED':
      handleOptionSelected(connectionId, payload, ws);
      break;

    case 'PING':
      ws.send(JSON.stringify({ type: 'PONG', payload: { timestamp: Date.now() } }));
      break;

    default:
      console.log(`⚠️ [Sandbox] Unknown message type: ${type}`);
  }
}

function handleStartConversation(connectionId, payload, ws) {
  const conversationId = uuidv4();
  const connection = connections.get(connectionId);

  connection.conversationId = conversationId;
  connection.transcriptCount = 0;
  connection.stage = 'GREETING';

  conversations.set(conversationId, {
    transcripts: [],
    startTime: Date.now(),
    agentId: payload.agentId || 'mock-agent'
  });

  console.log(`🎯 [Sandbox] Started conversation: ${conversationId}`);

  ws.send(JSON.stringify({
    type: 'CONVERSATION_STARTED',
    payload: {
      conversationId,
      agentId: payload.agentId,
      startTime: new Date().toISOString(),
      timestamp: Date.now()
    }
  }));
}

function handleTranscript(connectionId, payload, ws) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.conversationId) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      payload: {
        message: 'No active conversation',
        code: 'NO_CONVERSATION',
        timestamp: Date.now()
      }
    }));
    return;
  }

  const { conversationId, transcriptCount } = connection;
  const conversation = conversations.get(conversationId);

  // Store transcript
  conversation.transcripts.push({
    speaker: payload.speaker,
    text: payload.text,
    timestamp: payload.timestamp || Date.now(),
    isFinal: payload.isFinal
  });

  // Only process final transcripts for AI suggestions
  if (!payload.isFinal) {
    return;
  }

  connection.transcriptCount++;

  // Determine conversation stage based on transcript count
  const stage = determineStage(connection.transcriptCount);
  connection.stage = stage;

  console.log(`📝 [Sandbox] Transcript #${connection.transcriptCount} - Stage: ${stage}`);

  // Generate AI suggestion with mock latency
  const aiStartTime = Date.now();
  const suggestion = generateAISuggestion(stage, payload.text);
  const aiLatency = Math.random() * 400 + 600; // 600-1000ms (fast Haiku simulation)

  // Simulate processing delay
  setTimeout(() => {
    const totalLatency = Date.now() - aiStartTime;
    const meetsTarget = totalLatency < 3000;

    // Send AI suggestion
    ws.send(JSON.stringify({
      type: 'AI_TIP',
      payload: {
        suggestion,
        stage,
        model: 'haiku',
        latency: Math.round(aiLatency),
        cacheHit: Math.random() > 0.1, // 90% cache hit rate
        timestamp: Date.now(),
        performanceMetrics: {
          totalLatency: Math.round(totalLatency),
          aiLatency: Math.round(aiLatency),
          cacheHitRate: 0.92,
          meetsTarget
        }
      }
    }));

    console.log(`💡 [Sandbox] Sent AI suggestion (${Math.round(totalLatency)}ms): "${suggestion.substring(0, 50)}..."`);

    // Send intelligence update every 3 transcripts
    if (connection.transcriptCount % 3 === 0) {
      sendIntelligenceUpdate(connectionId, stage, ws);
    }
  }, aiLatency);
}

function handleEndConversation(connectionId, payload, ws) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.conversationId) {
    return;
  }

  const { conversationId } = connection;
  console.log(`🏁 [Sandbox] Ended conversation: ${conversationId}`);

  ws.send(JSON.stringify({
    type: 'CONVERSATION_ENDED',
    payload: {
      conversationId,
      timestamp: Date.now()
    }
  }));

  // Cleanup
  conversations.delete(conversationId);
  connection.conversationId = null;
  connection.transcriptCount = 0;
  connection.stage = 'GREETING';
}

function handleOptionSelected(connectionId, payload, ws) {
  console.log(`👆 [Sandbox] Option selected: #${payload.selectedOption}`);

  ws.send(JSON.stringify({
    type: 'OPTION_SELECTED_ACK',
    payload: {
      recommendationId: payload.recommendationId,
      selectedOption: payload.selectedOption,
      timestamp: Date.now()
    }
  }));
}

function determineStage(transcriptCount) {
  if (transcriptCount < 3) return 'GREETING';
  if (transcriptCount < 6) return 'VALUE_PROP';
  if (transcriptCount < 10) return 'OBJECTION';
  if (transcriptCount < 15) return 'CLOSING';
  return 'CONVERSION';
}

function generateAISuggestion(stage, transcriptText) {
  const scripts = mockData.marksGoldenScripts[stage] || mockData.marksGoldenScripts.GREETING;

  // Simple keyword-based selection
  const lowerText = transcriptText.toLowerCase();

  if (lowerText.includes('not interested') || lowerText.includes('busy')) {
    return scripts[Math.floor(Math.random() * Math.min(3, scripts.length))];
  }

  if (lowerText.includes('email') || lowerText.includes('send')) {
    const closingScripts = mockData.marksGoldenScripts.CLOSING;
    return closingScripts[0]; // "Perfect! Let me get your email..."
  }

  if (lowerText.includes('yes') || lowerText.includes('sure') || lowerText.includes('okay')) {
    return scripts[scripts.length - 1]; // Last script in stage (usually positive)
  }

  // Random selection from current stage
  return scripts[Math.floor(Math.random() * scripts.length)];
}

function sendIntelligenceUpdate(connectionId, stage, ws) {
  const connection = connections.get(connectionId);
  if (!connection) return;

  // Determine sentiment based on stage
  let sentimentKey = 'neutral';
  if (stage === 'CLOSING' || stage === 'CONVERSION') {
    sentimentKey = 'positive';
  } else if (stage === 'OBJECTION') {
    sentimentKey = Math.random() > 0.5 ? 'neutral' : 'negative';
  }

  const intelligence = {
    ...mockData.mockIntelligence[sentimentKey],
    lastUpdated: Date.now()
  };

  const entities = {
    ...mockData.mockEntities.business,
    timestamp: Date.now()
  };

  ws.send(JSON.stringify({
    type: 'INTELLIGENCE_UPDATE',
    payload: {
      conversationId: connection.conversationId,
      intelligence,
      entities,
      timestamp: Date.now()
    }
  }));

  console.log(`🧠 [Sandbox] Sent intelligence update: ${intelligence.sentiment.label}`);
}

// Start server
server.listen(PORT, HOST, () => {
  console.log(`\n🎉 [Sandbox] Server running!`);
  console.log(`📡 [Sandbox] WebSocket: ws://${HOST}:${PORT}`);
  console.log(`❤️  [Sandbox] Health Check: http://${HOST}:${PORT}/health`);
  console.log(`\n🔧 [Sandbox] Ready for offline testing with Mark's Golden Scripts\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 [Sandbox] SIGTERM received, closing server...');
  server.close(() => {
    console.log('✅ [Sandbox] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n👋 [Sandbox] SIGINT received, closing server...');
  server.close(() => {
    console.log('✅ [Sandbox] Server closed');
    process.exit(0);
  });
});
