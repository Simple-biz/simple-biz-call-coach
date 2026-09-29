// Imported FIRST by simulate-lead-persona.ts: the Lambda modules read these at import time.
process.env.AWS_PROFILE ||= 'simple-biz';
process.env.AWS_REGION ||= 'us-east-1';
process.env.API_KEYS_SECRET_ARN ||= 'call-coach/api-keys';
process.env.CLAUDE_HAIKU_MODEL ||= 'claude-haiku-4-5-20251001';
