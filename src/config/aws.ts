/**
 * AWS Configuration
 *
 * Contains URLs and endpoints for AWS services used by the extension.
 *
 * Production values are from the CDK deployment.
 * Dev mode can use local Docker simulation.
 */

// WebSocket API Gateway URL from CDK deployment
export const AWS_WEBSOCKET_URL = 'wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production';

// Backend API Key — read from env var (set in .env.production), fallback to hardcoded
export const BACKEND_API_KEY = import.meta.env.VITE_BACKEND_API_KEY || 'devassist-cce03814ca61352a852641fe9bb4542877975dd1d65d353ba0459add57c15efa';

// Environment detection
export const IS_PRODUCTION = AWS_WEBSOCKET_URL.includes('amazonaws.com');
export const ENVIRONMENT = IS_PRODUCTION ? 'PROD' : 'DEV';

// Feature flags
export const WEBHOOK_ENABLED = import.meta.env.VITE_WEBHOOK_ENABLED === 'true';

// CloudWatch Dashboard URL
export const CLOUDWATCH_DASHBOARD_URL = 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=DevAssist-WebSocket-Monitoring';
