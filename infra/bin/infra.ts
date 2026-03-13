#!/usr/bin/env node
import 'source-map-support/register';
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { WebSocketStack } from '../lib/websocket-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// Read environment variables
const rdsConnectionString = process.env.DATABASE_URL || '';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
const backendApiKey = process.env.BACKEND_API_KEY || 'dev-api-key-change-in-production';
const callToolsWebhookSecret = process.env.CALLTOOLS_WEBHOOK_SECRET || '';
const alertEmail = process.env.ALERT_EMAIL || 'cob@example.com';

// Validate required environment variables
if (!rdsConnectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

if (!anthropicApiKey) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

console.log('🚀 Deploying DevAssist Call Coach AWS Infrastructure');
console.log('📍 Region: us-east-1');
console.log('🔐 Backend API Key:', backendApiKey.substring(0, 10) + '...');
console.log('📧 Alert Email:', alertEmail);

// Database Stack (DynamoDB)
const databaseStack = new DatabaseStack(app, 'DevAssist-Database', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
  },
  description: 'DevAssist Call Coach - DynamoDB Connections Table'
});

// WebSocket Stack (API Gateway + Lambda)
const webSocketStack = new WebSocketStack(app, 'DevAssist-WebSocket', {
  connectionsTable: databaseStack.connectionsTable,
  callEventsTable: databaseStack.callEventsTable,
  rdsConnectionString,
  anthropicApiKey,
  backendApiKey,
  callToolsWebhookSecret,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
  },
  description: 'DevAssist Call Coach - API Gateway WebSocket + Lambda Functions'
});
webSocketStack.addDependency(databaseStack);

// Monitoring Stack (CloudWatch + X-Ray + SNS)
const monitoringStack = new MonitoringStack(app, 'DevAssist-Monitoring', {
  webSocketApi: webSocketStack.webSocketApi,
  connectHandlerName: 'DevAssist-WebSocket-ConnectHandler',
  transcriptHandlerName: 'DevAssist-WebSocket-TranscriptHandler',
  alertEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
  },
  description: 'DevAssist Call Coach - CloudWatch Dashboard + Alarms'
});
monitoringStack.addDependency(webSocketStack);

app.synth();
