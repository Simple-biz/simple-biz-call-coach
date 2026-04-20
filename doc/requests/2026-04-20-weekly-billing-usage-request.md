# Call Coach Weekly Billing & Usage Request

**For:** Sir @Cob Bautista
**Date:** April 20, 2026
**Requested by:** Kayser B
**Request for:** Weekly cost & usage breakdown, April 13–19, 2026
**Active user count during period:** 12–15 sales agents

---

## Purpose

Establish a baseline for Call Coach operational cost at **12–15 active users** so we can:

- Understand per-user cost economics
- Project spend as leadgen team scales beyond 15 users
- Identify which service is the largest cost driver
- Surface any unexpected billing anomalies early

---

## Period Requested

**Week of April 13 – April 19, 2026** (Monday through Friday, 5 working days)

This week included:

- Normal production traffic
- v2.2.3 deploy (trim window, 2026-04-15)
- v2.2.4 deploy (identity framing, 2026-04-15)
- v2.2.5 deploy (hostile input detection, 2026-04-15)
- v2.2.6 deploy (OpenAI failover, 2026-04-17)

Each deploy involved brief redeploys of the Intelligence Lambda and OpenAI Secrets Manager setup.

---

## Data Requested

### AWS (via Cost Explorer or AWS Bills Console)

| Service | What to capture |
|---------|-----------------|
| **Lambda** | Total invocations, GB-seconds, cost — broken down by function (IntelligenceHandler, TranscriptHandler, ConnectHandler, WebhookHandler, DefaultHandler, StartConversationHandler, EndConversationHandler, DisconnectHandler) |
| **API Gateway (WebSocket)** | Message count, connection minutes, cost |
| **DynamoDB** | Read/Write units consumed, storage, cost (connections + call-events tables) |
| **Secrets Manager** | API calls to `call-coach/api-keys` secret + storage cost |
| **CloudWatch** | Log ingestion, metric cost, dashboard cost |
| **RDS (PostgreSQL)** | Instance hours, storage, data transfer |
| **VPC / NAT Gateway** (if applicable) | Data processing, hours |
| **Data Transfer** | Inter-region + egress to internet |

### Third-party APIs

| Provider | What to capture |
|----------|-----------------|
| **Anthropic (Claude Haiku 4.5)** | Total input tokens, output tokens, cache-read tokens, cache-write tokens, total cost |
| **OpenAI (gpt-4.1-mini)** | Should be ~$0 this week — fallback only, Anthropic had no downtime. Confirm spend is negligible. |
| **Deepgram (nova-2)** | Minutes transcribed, cost |

---

## Access Required

If pulling this myself, I'd need read access to:

- AWS Cost Explorer (billing account)
- AWS Cost and Usage Reports (optional, for CSV export)
- Anthropic Console billing page
- OpenAI Console usage page
- Deepgram Console usage page

Alternatively, whoever owns billing access can pull the numbers and share.
