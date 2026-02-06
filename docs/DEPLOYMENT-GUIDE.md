# Deployment Guide - DevAssist-Call-Coach

**Version:** 1.0
**Last Updated:** 2025-12-23
**Target Platform:** AWS Elastic Beanstalk + Chrome Web Store

## Overview

This guide covers deploying DevAssist-Call-Coach to production:
- **Chrome Extension** → Chrome Web Store
- **Backend** → AWS Elastic Beanstalk (Node.js 20 on Amazon Linux 2023)
- **Database** → AWS RDS PostgreSQL 15

## Prerequisites

### Required Accounts
- AWS account with Elastic Beanstalk and RDS permissions
- Chrome Web Store Developer account ($5 one-time registration fee)
- OpenAI API account (GPT-4o-mini access)
- Deepgram API account (transcription services)

### Environment Variables

Production environment requires these variables:

**Backend (AWS Elastic Beanstalk):**
```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://username:password@your-rds-endpoint:5432/devassist_call_coach
OPENAI_API_KEY=sk-...
BACKEND_API_KEY=your_secure_random_key_for_extension_auth
CORS_ORIGIN=chrome-extension://your-extension-id
LOG_LEVEL=info
AWS_REGION=us-east-1
```

**Extension (.env for build):**
```bash
VITE_BACKEND_WS_URL=wss://your-backend.elasticbeanstalk.com
VITE_BACKEND_API_KEY=your_secure_random_key_for_extension_auth
VITE_DEEPGRAM_API_KEY=your_deepgram_api_key
```

## Part 1: Backend Deployment to AWS

### Step 1: Install AWS Tools

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /

# Install Elastic Beanstalk CLI
pip install awsebcli --upgrade --user

# Verify installation
aws --version
eb --version
```

### Step 2: Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure
# AWS Access Key ID: [your-access-key]
# AWS Secret Access Key: [your-secret-key]
# Default region name: us-east-1
# Default output format: json
```

### Step 3: Create RDS PostgreSQL Database

```bash
# Create RDS PostgreSQL instance via AWS Console or CLI
aws rds create-db-instance \
  --db-instance-identifier devassist-call-coach-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username dbadmin \
  --master-user-password YourSecurePassword123! \
  --allocated-storage 20 \
  --storage-type gp2 \
  --vpc-security-group-ids sg-xxxxxx \
  --db-name devassist_call_coach \
  --backup-retention-period 7 \
  --port 5432

# Wait for database to be available (5-10 minutes)
aws rds wait db-instance-available --db-instance-identifier devassist-call-coach-db

# Get database endpoint
aws rds describe-db-instances \
  --db-instance-identifier devassist-call-coach-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

**Note database endpoint:** `devassist-call-coach-db.xxxxxxxxx.us-east-1.rds.amazonaws.com`

### Step 4: Initialize Elastic Beanstalk Application

```bash
# Navigate to backend directory
cd backend/

# Initialize EB application
eb init -p node.js-20 devassist-call-coach --region us-east-1

# When prompted:
# - Application name: devassist-call-coach
# - Platform: Node.js 20 running on 64bit Amazon Linux 2023
# - SSH access: yes (optional but recommended)
```

### Step 5: Create Elastic Beanstalk Environment

```bash
# Create production environment
eb create devassist-call-coach-prod \
  --instance-type t3.small \
  --elb-type application \
  --envvars NODE_ENV=production

# This creates:
# - EC2 instance (t3.small)
# - Application Load Balancer (ALB) with WebSocket support
# - Auto-scaling group (min 1, max 4 instances)
# - Security groups

# Wait for environment to be created (5-10 minutes)
```

### Step 6: Configure Environment Variables

```bash
# Set all required environment variables
eb setenv \
  DATABASE_URL="postgresql://dbadmin:YourSecurePassword123!@devassist-call-coach-db.xxxxxxxxx.us-east-1.rds.amazonaws.com:5432/devassist_call_coach" \
  OPENAI_API_KEY="sk-your-openai-api-key" \
  BACKEND_API_KEY="your_secure_random_key_for_extension_auth" \
  CORS_ORIGIN="chrome-extension://your-extension-id-will-be-set-after-first-deployment" \
  LOG_LEVEL="info" \
  AWS_REGION="us-east-1"
```

### Step 7: Deploy Backend

```bash
# Build TypeScript
npm run build

# Deploy to Elastic Beanstalk
eb deploy

# Monitor deployment
eb logs --stream
```

### Step 8: Run Database Migrations

```bash
# SSH into EB instance
eb ssh

# Navigate to app directory
cd /var/app/current

# Run migrations
npm run migrate up

# Exit SSH
exit
```

### Step 9: Verify Backend Deployment

```bash
# Get backend URL
eb status

# Test WebSocket connection
curl -I https://your-app-name.elasticbeanstalk.com/health

# Expected response: 200 OK
```

**Backend URL:** `wss://devassist-call-coach-prod.us-east-1.elasticbeanstalk.com`

---

## Part 2: Chrome Extension Deployment

### Step 1: Update Extension Configuration

Update `.env` with production backend URL:

```bash
# .env
VITE_BACKEND_WS_URL=wss://devassist-call-coach-prod.us-east-1.elasticbeanstalk.com
VITE_BACKEND_API_KEY=your_secure_random_key_for_extension_auth
VITE_DEEPGRAM_API_KEY=your_deepgram_api_key
```

### Step 2: Build Production Extension

```bash
# Navigate to project root
cd /Users/cob/DevAssist/Projects/DevAssist-Call-Coach

# Install dependencies (if not already done)
npm install

# Build for production
npm run build

# Verify dist/ folder was created
ls -la dist/
```

### Step 3: Test Build Locally

```bash
# Load dist/ folder as unpacked extension in Chrome
# 1. Open chrome://extensions
# 2. Enable "Developer mode" (top right)
# 3. Click "Load unpacked"
# 4. Select dist/ folder
# 5. Test AI coaching on a call

# Verify:
# - Extension loads without errors
# - WebSocket connects to production backend
# - Transcription works
# - AI coaching tips appear after 3-minute warmup
```

### Step 4: Create Chrome Web Store Package

```bash
# Create zip file for Chrome Web Store
cd dist/
zip -r ../devassist-call-coach-v1.0.0.zip .
cd ..

# Verify zip file
unzip -l devassist-call-coach-v1.0.0.zip
```

### Step 5: Prepare Chrome Web Store Listing

**Required Assets:**

1. **Icon Images:**
   - 128x128 PNG icon (required)
   - 48x48 PNG icon (optional but recommended)
   - 16x16 PNG icon (optional)

2. **Screenshots:** (minimum 1, maximum 5)
   - 1280x800 or 640x400 PNG/JPEG
   - Show extension in action (side panel with AI tips)

3. **Promotional Images:** (optional)
   - 440x280 Small tile
   - 920x680 Large tile
   - 1400x560 Marquee

4. **Store Listing Text:**
   - **Title:** DevAssist-Call-Coach (45 characters max)
   - **Short Description:** Real-time AI conversation coaching for sales agents (132 characters max)
   - **Detailed Description:** (see template below)

**Detailed Description Template:**
```markdown
DevAssist-Call-Coach provides real-time AI conversation coaching for sales agents during live customer calls.

KEY FEATURES:
✓ Real-time transcription of your calls
✓ AI-powered coaching suggestions every 30 seconds
✓ Conversation-first guidance to build rapport
✓ Buying signal identification
✓ Natural conversation flow maintained

HOW IT WORKS:
1. Start a customer call
2. Click "Start AI Coaching" in the extension
3. AI analyzes conversation after 3-minute warmup
4. Receive actionable coaching tips in real-time
5. Close more deals with better conversations

BUILT FOR TECHNICAL SALES TEAMS
- 10-100 concurrent agents supported
- AWS infrastructure for 99.9% uptime
- <1 second AI latency
- ~$0.045 cost per 30-minute call

PRIVACY & SECURITY:
- Encrypted WebSocket communication (WSS)
- API key authentication
- 30-day data retention policy
- HTTPS-only connections

REQUIREMENTS:
- Chrome 110+
- Backend deployment (included)
- OpenAI API key (GPT-4o-mini)
- Deepgram API key (transcription)
```

### Step 6: Submit to Chrome Web Store

```bash
# 1. Go to Chrome Web Store Developer Dashboard
open https://chrome.google.com/webstore/devconsole

# 2. Click "New Item"
# 3. Upload devassist-call-coach-v1.0.0.zip
# 4. Fill out store listing:
#    - Category: Productivity
#    - Language: English
#    - Price: Free (internal tool)
#    - Visibility: Private (only accessible by specific users)
# 5. Add screenshots and promotional images
# 6. Add privacy policy URL (required)
# 7. Click "Submit for Review"

# Review process: 1-3 business days
```

### Step 7: Update Backend CORS with Extension ID

After Chrome Web Store approval, you'll receive an extension ID (e.g., `chrome-extension://abcdefghijklmnop`):

```bash
# Update backend CORS_ORIGIN environment variable
cd backend/
eb setenv CORS_ORIGIN="chrome-extension://abcdefghijklmnop"

# Redeploy backend
eb deploy
```

### Step 8: Distribute to Team

**For Private Distribution:**

```bash
# 1. Chrome Web Store Dashboard → Visibility
# 2. Select "Private" visibility
# 3. Add allowed users by email:
#    - agent1@yourcompany.com
#    - agent2@yourcompany.com
#    - etc.
# 4. Save settings

# Share extension link with team:
# https://chrome.google.com/webstore/detail/devassist-call-coach/[extension-id]
```

**For Team Installation:**

```text
Send this to your sales team:

Subject: New Tool: DevAssist AI Call Coach

Hi Team,

We've launched DevAssist-Call-Coach - an AI assistant that provides real-time coaching during customer calls!

INSTALLATION:
1. Install extension: [Chrome Web Store Link]
2. Click extension icon to open side panel
3. Enter API key: [Provided separately via secure channel]
4. Click "Start AI Coaching" during your next call
5. AI will begin analyzing after 3 minutes

You'll receive helpful coaching tips like:
- "Ask Budget" - when client mentions cost concerns
- "Build Trust" - when relationship building opportunity arises
- "Close Next Steps" - when buying signals appear

Questions? Reach out to #devassist-call-coach on Slack.
```

---

## Part 3: Monitoring & Maintenance

### Application Monitoring

**CloudWatch Logs:**
```bash
# View real-time logs
eb logs --stream

# View specific log file
eb logs --log-group /aws/elasticbeanstalk/devassist-call-coach-prod/var/log/nodejs/nodejs.log
```

**CloudWatch Metrics:**

Set up custom metrics in AWS Console:
- AI Analysis Latency (target: <1 second P95)
- WebSocket Connection Success Rate (target: 95%+)
- LLM Token Usage (track costs)
- Error Rate (target: <5%)

**CloudWatch Alarms:**

```bash
# Create alarm for high error rate
aws cloudwatch put-metric-alarm \
  --alarm-name devassist-high-error-rate \
  --alarm-description "Trigger when error rate > 5%" \
  --metric-name ErrorRate \
  --namespace AWS/ElasticBeanstalk \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

### Database Backups

**RDS Automated Backups:**
- Configured during RDS creation (7-day retention)
- Daily backups at 2 AM UTC (off-peak)
- Point-in-time recovery available

**Manual Snapshot:**
```bash
# Create manual snapshot before major changes
aws rds create-db-snapshot \
  --db-instance-identifier devassist-call-coach-db \
  --db-snapshot-identifier devassist-backup-$(date +%Y-%m-%d)
```

### Log Management

**Log Retention:**
- CloudWatch Logs: 7 days (configurable)
- Backend logs: Structured JSON format (Winston)
- Extension logs: Chrome DevTools Console (local only)

**Access Logs:**
```bash
# Search logs for specific conversation
eb logs | grep "conversationId: abc123"

# Search for errors
eb logs | grep "ERROR"

# Export logs to S3 (for long-term storage)
aws logs create-export-task \
  --log-group-name /aws/elasticbeanstalk/devassist-call-coach-prod \
  --from $(date -u -d '7 days ago' +%s)000 \
  --to $(date -u +%s)000 \
  --destination your-s3-bucket \
  --destination-prefix eb-logs/
```

---

## Part 4: Security Considerations

### SSL/TLS
- ✅ Elastic Beanstalk provides free SSL certificates
- ✅ HTTPS/WSS enforced on all connections
- ✅ Chrome extension requires secure context (HTTPS)

### Environment Variables
- ❌ NEVER commit .env files to git
- ✅ Use Elastic Beanstalk environment variable management
- ✅ Rotate API keys quarterly
- ✅ Use AWS Secrets Manager for production secrets (optional, recommended for scale)

### API Security
- ✅ Rate limiting: 1 AI analysis per 30 seconds per agent
- ✅ CORS configured for: chrome-extension://[extension-id]
- ✅ Authentication: Shared API key (validate on WebSocket handshake)
- ✅ HTTPS/WSS only in production

### Database Security
- ✅ RDS in private subnet (not publicly accessible)
- ✅ Security group allows connections only from EB instances
- ✅ Encrypted at rest (AWS managed keys)
- ✅ Encrypted in transit (SSL/TLS)

---

## Part 5: Scaling

### Current Configuration (Small Business Scale)
- **Instances:** 1-4 t3.small (auto-scaling)
- **Database:** db.t3.micro (upgradable)
- **Supports:** 10-100 concurrent agents
- **Cost:** ~$97/month

### Scaling to 100+ Agents

**If performance degrades:**

1. **Scale Database:**
   ```bash
   # Upgrade RDS instance class
   aws rds modify-db-instance \
     --db-instance-identifier devassist-call-coach-db \
     --db-instance-class db.t3.small \
     --apply-immediately
   ```

2. **Increase EB Instance Size:**
   ```bash
   # Edit .ebextensions/scaling.config
   option_settings:
     aws:autoscaling:launchconfiguration:
       InstanceType: t3.medium  # Upgrade from t3.small
     aws:autoscaling:asg:
       MaxSize: 8  # Increase from 4

   # Deploy changes
   eb deploy
   ```

3. **Add Redis Caching Layer:**
   - Create ElastiCache Redis cluster
   - Cache conversation summaries
   - Reduce database load

---

## Part 6: CI/CD Pipeline (Optional)

### GitHub Actions Automated Deployment

Create `.github/workflows/deploy-backend.yml`:

```yaml
name: Deploy Backend to Elastic Beanstalk

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        working-directory: ./backend
        run: npm ci

      - name: Build
        working-directory: ./backend
        run: npm run build

      - name: Deploy to EB
        uses: einaregilsson/beanstalk-deploy@v21
        with:
          aws_access_key: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws_secret_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          application_name: devassist-call-coach
          environment_name: devassist-call-coach-prod
          region: us-east-1
          version_label: ${{ github.sha }}
          deployment_package: backend/
```

Create `.github/workflows/deploy-extension.yml`:

```yaml
name: Build Chrome Extension

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'manifest.json'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build extension
        run: npm run build

      - name: Create zip
        run: cd dist && zip -r ../extension.zip .

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: chrome-extension
          path: extension.zip
```

---

## Part 7: Troubleshooting

### Common Issues

**1. Backend fails to start:**
```bash
# Check logs for errors
eb logs

# Common causes:
# - DATABASE_URL incorrect
# - Missing environment variables
# - Port already in use (should use PORT=8080)

# Verify environment variables
eb printenv
```

**2. Extension can't connect to backend:**
```bash
# Check CORS configuration
eb printenv | grep CORS_ORIGIN

# Verify WebSocket URL in extension .env
cat .env | grep VITE_BACKEND_WS_URL

# Test WebSocket connection manually
wscat -c wss://your-backend.elasticbeanstalk.com
```

**3. Database connection errors:**
```bash
# Verify security group allows EB instances
aws ec2 describe-security-groups --group-ids sg-xxxxxx

# Test database connection from EB instance
eb ssh
psql $DATABASE_URL
```

**4. High costs:**
```bash
# Check OpenAI API usage
# Dashboard: https://platform.openai.com/usage

# Verify rate limiting is working (30s between analyses)
eb logs | grep "AI_ANALYSIS_RATE_LIMIT"

# Consider reducing warmup time or analysis frequency
```

### Rollback Procedure

If deployment fails or introduces bugs:

```bash
# List previous versions
eb appversion

# Rollback to previous version
eb deploy --version [previous-version-label]

# Alternatively, use AWS Console:
# Elastic Beanstalk → Environments → devassist-call-coach-prod → Application versions → Deploy
```

---

## Part 8: Cost Estimates

### Monthly Cost Breakdown (100 Agents)

| Service | Configuration | Cost/Month |
|---------|--------------|------------|
| Elastic Beanstalk | 1 t3.small instance | ~$15 |
| Application Load Balancer | ALB with WebSocket | ~$16 |
| RDS PostgreSQL | db.t3.micro | ~$15 |
| Data Transfer | ~100GB/month | ~$9 |
| CloudWatch Logs | 7-day retention | ~$5 |
| **AWS Total** | | **~$60/month** |
| OpenAI API | 800 calls × $0.045 | **~$36/month** |
| Deepgram API | Already paid separately | $0 |
| **Grand Total** | | **~$96/month** |

### Cost Optimization

- Use AWS Free Tier for first 12 months (if eligible)
- Schedule auto-scaling to scale down during off-hours
- Use Reserved Instances for consistent workloads (30-50% savings)
- Monitor and optimize OpenAI token usage

---

## Part 9: Support & Maintenance Schedule

### Regular Maintenance Tasks

**Weekly:**
- Review error logs in CloudWatch
- Check AI coaching tip quality (user feedback)
- Monitor cost dashboard

**Monthly:**
- Update Node.js dependencies (`npm outdated`, `npm update`)
- Security patches (`npm audit fix`)
- Review CloudWatch metrics and optimize

**Quarterly:**
- Performance review and optimization
- Database cleanup (verify 30-day retention working)
- Cost analysis and optimization
- Security audit

---

## Next Steps After Deployment

1. ✅ Test all functionality in production
2. ✅ Set up CloudWatch alarms for critical metrics
3. ✅ Configure custom domain (optional, via Route53)
4. ✅ Enable analytics tracking (if applicable)
5. ✅ Schedule first backup verification
6. ✅ Document production incidents and resolutions
7. ✅ Create runbook for common operational tasks
8. ✅ Train team on using the extension

---

## Support Contacts

**Technical Issues:**
- Internal: #devassist-call-coach Slack channel
- Email: devassist-support@yourcompany.com

**AWS Support:**
- AWS Support Portal (if you have support plan)
- AWS Forums: https://forums.aws.amazon.com

**Chrome Web Store:**
- Developer Support: https://support.google.com/chrome_webstore/

---

**🚀 Deployment complete! Your AI coaching assistant is live.**
