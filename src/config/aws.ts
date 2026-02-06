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

// Backend API Key (stored in extension storage, this is the default)
export const BACKEND_API_KEY = 'j88URgUHnn1MtaezUpQF57IW7fIOY2Hotgya06UgAwQ=';

// Environment detection
export const IS_PRODUCTION = AWS_WEBSOCKET_URL.includes('amazonaws.com');
export const ENVIRONMENT = IS_PRODUCTION ? 'PROD' : 'DEV';

// CloudWatch Dashboard URL
export const CLOUDWATCH_DASHBOARD_URL = 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=DevAssist-WebSocket-Monitoring';
