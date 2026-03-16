# AWS Infrastructure — Deployment Guide

## Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Node.js 20+
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- IAM permissions: `ssm:GetParameter` on `cdk-bootstrap/*` and `sts:AssumeRole` on `cdk-*` roles

---

## Step 1: Bootstrap AWS CDK (one-time only)

If you've never used CDK in this AWS account/region:

```bash
cdk bootstrap aws://<YOUR_ACCOUNT_ID>/us-east-1
```

You can find your account ID with:

```bash
aws sts get-caller-identity --query Account --output text
```

---

## Step 2: Verify Environment Variables

All required env vars live in `.env.production` (project root). CDK loads this file automatically. Verify it contains both the Vite and infrastructure sections:

```
# Chrome Extension (Vite)
VITE_BACKEND_WS_URL=wss://...
VITE_BACKEND_API_KEY=devassist-...
VITE_DEEPGRAM_API_KEY=...

# AWS CDK / Lambda Infrastructure
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
BACKEND_API_KEY=devassist-...
CALLTOOLS_WEBHOOK_SECRET=ct-wh-...
ALERT_EMAIL=cob@example.com        # optional
```

No need to export anything — CDK reads `.env.production` directly.

---

## Step 3: Verify AWS Resources

The CDK stack references these hardcoded AWS resource IDs in `infra/lib/websocket-stack.ts`. Confirm they match your account:

| Resource | ID in Code | How to Check |
|---|---|---|
| VPC | `vpc-059fe4065ccc95a67` | `aws ec2 describe-vpcs --query "Vpcs[*].[VpcId,Tags]"` |
| Private Subnet 1a | `subnet-0a927d442cacaa034` | `aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-059fe4065ccc95a67"` |
| Private Subnet 1b | `subnet-0f7dad7c982457924` | (same command) |
| Private Subnet 1c | `subnet-053c8588b4ba9b13c` | (same command) |
| RDS Security Group | `sg-0c836ac7757980973` | `aws ec2 describe-security-groups --group-ids sg-0c836ac7757980973` |

If any IDs don't match, update them in `infra/lib/websocket-stack.ts` before deploying.

---

## Step 4: Install Dependencies

```bash
cd simple-biz-call-coach
npm install

cd infra
npm install
```

---

## Step 5: Deploy

### Deploy all stacks (first time or full deploy)

```bash
cd infra
cdk deploy --all --require-approval broadening
```

This deploys three stacks in order:
1. **DevAssist-Database** — DynamoDB tables (connections + call events)
2. **DevAssist-WebSocket** — API Gateway WebSocket + all Lambda functions + webhook Function URL
3. **DevAssist-Monitoring** — CloudWatch dashboard + alarms

Review the IAM changes when prompted and approve with `y`.

### Deploy a single stack (quick updates)

```bash
cd infra
cdk deploy DevAssist-WebSocket --require-approval broadening
```

Use this when you've only changed Lambda code or environment variables. No need to redeploy Database or Monitoring if they haven't changed.

### Preview changes before deploying

```bash
cd infra
cdk diff
```

---

## Step 6: Verify Outputs

After deployment, CDK prints the key outputs:

```
DevAssist-WebSocket.WebSocketURL = wss://wu4pgdpdv9.execute-api.us-east-1.amazonaws.com/production
DevAssist-WebSocket.WebhookURL = https://xxxxxxxxxx.lambda-url.us-east-1.on.aws/
```

To retrieve outputs later:

```bash
aws cloudformation describe-stacks --stack-name DevAssist-WebSocket \
  --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" --output table
```

---

## Step 7: Register CallTools Resthook (one-time only)

Use the CallTools API to subscribe to call events. Replace `<WEBHOOK_URL>` with the webhook URL from Step 6:

```bash
curl -X POST "https://west-3.calltools.io/api/resthooksubscriptions/" \
  -H "Authorization: Token 266a6541f642451ccfc90ce19790fab57291591d" \
  -H "Content-Type: application/json" \
  -d '{
    "resthook_model": "Call",
    "url": "<WEBHOOK_URL>?secret=ct-wh-a7f3e9b1d4c8052e6f19a3b7d5e2c8f4a1b6d9e3f7024c8a5b1e6d3f9a2c7",
    "description": "DevAssist Call Coach webhook"
  }'
```

---

## Troubleshooting

### EPERM error during bundling (Windows)

Close VS Code or any file explorer windows that have `infra/cdk.out` open, then:

```bash
rm -rf infra/cdk.out
cdk deploy ...
```

### Check Lambda logs

```bash
# Transcript handler
aws logs tail /aws/lambda/DevAssist-WebSocket-TranscriptHandler... --since 30m

# Intelligence handler
aws logs tail /aws/lambda/DevAssist-WebSocket-IntelligenceHandler... --since 30m

# Webhook handler
aws logs tail /aws/lambda/DevAssist-CallTools-Webhook --since 30m
```

### Check CallTools resthook status

```bash
# List active subscriptions
curl -s -H "Authorization: Token 266a6541f642451ccfc90ce19790fab57291591d" \
  "https://west-3.calltools.io/api/resthooksubscriptions/" | python -m json.tool

# Check error logs
curl -s -H "Authorization: Token 266a6541f642451ccfc90ce19790fab57291591d" \
  "https://west-3.calltools.io/api/resthookerrorlogs/" | python -m json.tool
```

### Check DynamoDB events

```bash
aws dynamodb scan --table-name devassist-call-events --limit 5
```
