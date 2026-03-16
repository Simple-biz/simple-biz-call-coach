# CallTools Webhook Lambda — Deployment Guide

## Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Node.js 20+
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Your AWS account has a VPC with RDS PostgreSQL already running

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

## Step 5: Deploy the CDK Stacks

```bash
cd infra
cdk deploy --all --require-approval broadening
```

This deploys three stacks in order:
1. **DevAssist-Database** — DynamoDB tables (connections + call events)
2. **DevAssist-WebSocket** — API Gateway WebSocket + all Lambda functions + webhook Function URL
3. **DevAssist-Monitoring** — CloudWatch dashboard + alarms

Review the IAM changes when prompted and approve with `y`.

---

## Step 6: Copy the Webhook URL

After deployment, CDK outputs the webhook URL:

```
DevAssist-WebSocket.WebhookURL = https://xxxxxxxxxx.lambda-url.us-east-1.on.aws/
```

Save this URL — you'll need it in the next step.

---

## Step 7: Register the CallTools Resthook Subscription

Use the CallTools API to subscribe to call events. Replace `<WEBHOOK_URL>` with the URL from Step 6:

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

You should get a `201` response with the subscription details. Note the returned `id` in case you need to update or delete it later.

---

## Step 8: Verify It Works

### Option A: Make a test call in CallTools
Place a call through CallTools. After the call ends, CallTools will POST the call data to your webhook.

### Option B: Check CloudWatch Logs
```bash
aws logs tail /aws/lambda/DevAssist-CallTools-Webhook --follow
```

### Option C: Send a test payload manually
```bash
curl -X POST "<WEBHOOK_URL>?secret=ct-wh-a7f3e9b1d4c8052e6f19a3b7d5e2c8f4a1b6d9e3f7024c8a5b1e6d3f9a2c7" \
  -H "Content-Type: application/json" \
  -d '{
    "id": 9999999,
    "uuid": "test-0000-0000-0000-000000000001",
    "account_id": 18086,
    "contact": null,
    "app_user": "8759e97b-505c-41e6-92d9-4e68c15bae49",
    "campaign": null,
    "system_disposition": "Answered",
    "call_disposition": null,
    "destination": "+15551234567",
    "source": "+15559876543",
    "inbound": false,
    "start": "2025-12-12T13:01:07Z",
    "end": "2025-12-12T13:02:42Z",
    "call_type": "outbound",
    "duration": 95,
    "billsec": 93,
    "transferred_to": null,
    "call_recording_fsfile_id": null,
    "created_on": "2025-12-12T13:02:44Z"
  }'
```

Expected response:
```json
{
  "message": "Event processed",
  "callId": "test-0000-0000-0000-000000000001",
  "eventType": "call.ended",
  "broadcastCount": 0,
  "latencyMs": 50
}
```

---

## Troubleshooting

### Check resthook error logs
```bash
curl -s -H "Authorization: Token 266a6541f642451ccfc90ce19790fab57291591d" \
  "https://west-3.calltools.io/api/resthookerrorlogs/" | python -m json.tool
```

### List active subscriptions
```bash
curl -s -H "Authorization: Token 266a6541f642451ccfc90ce19790fab57291591d" \
  "https://west-3.calltools.io/api/resthooksubscriptions/" | python -m json.tool
```

### Delete a subscription
```bash
curl -X DELETE -H "Authorization: Token 266a6541f642451ccfc90ce19790fab57291591d" \
  "https://west-3.calltools.io/api/resthooksubscriptions/<SUBSCRIPTION_ID>/"
```

### View Lambda logs
```bash
aws logs tail /aws/lambda/DevAssist-CallTools-Webhook --follow --since 1h
```

### Check DynamoDB for stored events
```bash
aws dynamodb scan --table-name devassist-call-events --limit 5
```
