#!/usr/bin/env node
import 'source-map-support/register';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.production') });
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { WebSocketStack } from '../lib/websocket-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// Read environment variables
const rdsConnectionString = process.env.DATABASE_URL || '';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const backendApiKey = process.env.BACKEND_API_KEY || '';
const callToolsWebhookSecret = process.env.CALLTOOLS_WEBHOOK_SECRET || '';
const alertEmail = process.env.ALERT_EMAIL || 'cob@example.com';

// Read infrastructure IDs from environment
const vpcId = process.env.VPC_ID || '';
const privateSubnetIds = (process.env.PRIVATE_SUBNET_IDS || '').split(',').filter(Boolean);
const rdsSecurityGroupId = process.env.RDS_SECURITY_GROUP_ID || '';

// Validate required environment variables
if (!rdsConnectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

if (!anthropicApiKey) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY environment variable is required (used as fallback when Anthropic is down)');
}

if (!vpcId || privateSubnetIds.length === 0 || !rdsSecurityGroupId) {
  throw new Error('VPC_ID, PRIVATE_SUBNET_IDS, and RDS_SECURITY_GROUP_ID environment variables are required');
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
  openaiApiKey,
  backendApiKey,
  callToolsWebhookSecret,
  vpcId,
  privateSubnetIds,
  rdsSecurityGroupId,
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
  connectHandlerName: webSocketStack.connectHandlerName,
  transcriptHandlerName: webSocketStack.transcriptHandlerName,
  alertEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
  },
  description: 'DevAssist Call Coach - CloudWatch Dashboard + Alarms'
});
monitoringStack.addDependency(webSocketStack);

app.synth();
