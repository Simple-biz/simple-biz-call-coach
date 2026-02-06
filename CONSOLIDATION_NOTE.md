# Project Consolidation Note

**Active Directory**: `/Users/cob/Aivax/Brain2/devassist-call-coach`
**Status**: CANONICAL SOURCE OF TRUTH
**Last Updated**: 2026-02-03

This directory contains the unified frontend (Vite/React) and backend infrastructure (AWS CDK).
Please do not use the following legacy directories:
- `/Users/cob/DevAssist/Projects/DevAssist-Call-Coach` (Legacy Frontend)
- `/Users/cob/DevAssist/Projects/DevAssist-Call-Coach-Backend` (Legacy Socket.io Backend)

## Architecture
- **Frontend**: Vite + React + TypeScript (located in `src/`)
- **Backend**: AWS API Gateway + Lambda + DynamoDB (located in `infra/`)
- **Infrastructure**: AWS CDK

## Debugging
- If you encounter 500 errors on WebSocket connections, check CloudWatch Logs for the `ConnectHandler`.
- Ensure `CONNECTIONS_TABLE` and `BACKEND_API_KEY` are correctly set in the Lambda environment.
