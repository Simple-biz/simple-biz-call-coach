# Production Deployment Checklist
**Date:** 2025-12-26
**Version:** 1.0.0
**Target:** AWS Elastic Beanstalk + Chrome Web Store

---

## 📋 Pre-Deployment Verification

### ✅ Code Readiness
- [x] All tests passing (18 backend + 28 frontend unit tests)
- [x] Extension builds without errors
- [x] All animations implemented and tested
- [x] TypeScript compilation successful
- [x] No console errors in development

### ✅ Prerequisites Checklist

#### AWS Requirements
- [ ] AWS account created
- [ ] AWS CLI installed and configured
- [ ] EB CLI installed (`pip install awsebcli`)
- [ ] AWS credentials configured (`aws configure`)
- [ ] IAM permissions for:
  - Elastic Beanstalk (full access)
  - RDS (create/manage databases)
  - EC2 (launch instances)
  - CloudWatch (logging/monitoring)

#### API Keys Required
- [ ] **OpenAI API Key** (GPT-4o-mini access)
  - Sign up: https://platform.openai.com
  - Create API key
  - Add billing information
  - Estimated cost: ~$36/month for 100 agents

- [ ] **Deepgram API Key** (transcription)
  - Already obtained (check project notes)
  - Used in extension client-side

- [ ] **Backend API Key** (extension authentication)
  - Generate secure random key:
    ```bash
    openssl rand -base64 32
    ```
  - Use same key in extension and backend

#### Chrome Web Store
- [ ] Chrome Web Store Developer account ($5 one-time fee)
  - Register: https://chrome.google.com/webstore/devconsole
  - Verify email and payment
  - Accept developer agreement

#### Domain & SSL (Optional)
- [ ] Custom domain registered (optional)
- [ ] Route53 hosted zone created (if using custom domain)
- [ ] SSL certificate (auto-provided by Elastic Beanstalk)

---

## 🚀 Deployment Steps

### Phase 1: Backend Deployment to AWS

#### Step 1.1: Create RDS PostgreSQL Database
```bash
# Create database instance
aws rds create-db-instance \
  --db-instance-identifier devassist-call-coach-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username dbadmin \
  --master-user-password <SECURE_PASSWORD> \
  --allocated-storage 20 \
  --storage-type gp2 \
  --db-name devassist_call_coach \
  --backup-retention-period 7 \
  --port 5432 \
  --publicly-accessible false

# Wait for creation (5-10 minutes)
aws rds wait db-instance-available --db-instance-identifier devassist-call-coach-db

# Get endpoint
aws rds describe-db-instances \
  --db-instance-identifier devassist-call-coach-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

**Checklist:**
- [ ] RDS instance created
- [ ] Database endpoint noted: `_____________________________`
- [ ] Master password securely stored
- [ ] Security group configured (EB instance access only)

---

#### Step 1.2: Initialize Elastic Beanstalk Application
```bash
cd backend/

# Initialize EB application
eb init -p node.js-20 devassist-call-coach --region us-east-1

# Select SSH keypair for instance access (recommended)
```

**Checklist:**
- [ ] EB application initialized
- [ ] SSH keypair selected (or created)
- [ ] `.elasticbeanstalk/config.yml` created

---

#### Step 1.3: Create Production Environment
```bash
# Create environment with ALB (WebSocket support)
eb create devassist-call-coach-prod \
  --instance-type t3.small \
  --elb-type application \
  --envvars NODE_ENV=production,PORT=8080
```

**Checklist:**
- [ ] Environment created (5-10 minutes)
- [ ] Application Load Balancer created
- [ ] Auto-scaling group configured
- [ ] Security groups created
- [ ] Environment URL noted: `_____________________________`

---

#### Step 1.4: Configure Environment Variables
```bash
# Generate secure API key
BACKEND_API_KEY=$(openssl rand -base64 32)
echo "BACKEND_API_KEY: $BACKEND_API_KEY"

# Set all environment variables
eb setenv \
  DATABASE_URL="postgresql://dbadmin:<PASSWORD>@<RDS_ENDPOINT>:5432/devassist_call_coach" \
  OPENAI_API_KEY="<YOUR_OPENAI_API_KEY>" \
  API_KEY="$BACKEND_API_KEY" \
  ALLOWED_ORIGINS="chrome-extension://PLACEHOLDER" \
  LOG_LEVEL="info" \
  NODE_ENV="production" \
  AI_WARMUP_DURATION_MS="180000" \
  AI_ANALYSIS_INTERVAL_MS="30000" \
  MAX_CONTEXT_TOKENS="100000" \
  SUMMARY_INTERVAL_MS="600000" \
  DATA_RETENTION_DAYS="30"
```

**Checklist:**
- [ ] All environment variables set
- [ ] Backend API key generated and noted: `_____________________________`
- [ ] OpenAI API key configured
- [ ] Database URL correct
- [ ] ALLOWED_ORIGINS will be updated after extension deployment

---

#### Step 1.5: Deploy Backend Code
```bash
cd backend/

# Install dependencies and build
npm install
npm run build

# Verify dist/ folder created
ls -la dist/

# Deploy to Elastic Beanstalk
eb deploy

# Monitor deployment
eb logs --stream
```

**Checklist:**
- [ ] Dependencies installed
- [ ] TypeScript compiled successfully
- [ ] Deployment successful
- [ ] No errors in logs
- [ ] Backend accessible

---

#### Step 1.6: Run Database Migrations
```bash
# SSH into EB instance
eb ssh

# Navigate to app directory
cd /var/app/current

# Run migrations
npm run migrate up

# Verify tables created
npm run migrate status

# Exit SSH
exit
```

**Checklist:**
- [ ] SSH access working
- [ ] Migrations ran successfully
- [ ] All tables created:
  - conversations
  - transcripts
  - ai_recommendations
  - conversation_summaries
  - option_selections

---

#### Step 1.7: Verify Backend Deployment
```bash
# Get backend URL
eb status

# Test health endpoint
curl -I https://<YOUR_EB_URL>/health

# Expected: HTTP/2 200
```

**Checklist:**
- [ ] Health endpoint returns 200 OK
- [ ] Backend URL noted: `_____________________________`
- [ ] WebSocket endpoint: `wss://<YOUR_EB_URL>`
- [ ] No errors in CloudWatch Logs

---

### Phase 2: Extension Build & Packaging

#### Step 2.1: Configure Extension for Production
```bash
cd /Users/cob/DevAssist/Projects/DevAssist-Call-Coach

# Create production .env file
cat > .env.production << EOF
VITE_BACKEND_WS_URL=wss://<YOUR_EB_URL>
VITE_BACKEND_API_KEY=<BACKEND_API_KEY_FROM_STEP_1.4>
VITE_DEEPGRAM_API_KEY=<YOUR_DEEPGRAM_API_KEY>
EOF
```

**Checklist:**
- [ ] `.env.production` created
- [ ] Backend WebSocket URL correct
- [ ] Backend API key matches server
- [ ] Deepgram API key configured

---

#### Step 2.2: Build Production Extension
```bash
# Install dependencies
npm install

# Build for production (uses .env.production)
NODE_ENV=production npm run build

# Verify build
ls -la dist/
```

**Checklist:**
- [ ] Build completed without errors
- [ ] `dist/` folder created
- [ ] `dist/manifest.json` exists
- [ ] Bundle size: ~140 KB (acceptable)
- [ ] No TypeScript errors

---

#### Step 2.3: Test Production Build Locally
```bash
# 1. Load extension in Chrome
# - Open chrome://extensions
# - Enable Developer Mode
# - Click "Load unpacked"
# - Select dist/ folder

# 2. Test connection to production backend
# - Open extension side panel
# - Check connection status
# - Verify "AI Ready" status appears

# 3. Test on a call (CallTools)
# - Start a test call
# - Click "Start AI Coaching"
# - Wait 3 minutes for warmup
# - Verify AI tips appear
```

**Checklist:**
- [ ] Extension loads without errors
- [ ] Connects to production backend
- [ ] WebSocket connection successful
- [ ] AI coaching tips appear after warmup
- [ ] All animations working
- [ ] No console errors

---

#### Step 2.4: Create Chrome Web Store Package
```bash
# Create zip file
cd dist/
zip -r ../devassist-call-coach-v1.0.0.zip .
cd ..

# Verify zip contents
unzip -l devassist-call-coach-v1.0.0.zip | head -20

# Check zip size
ls -lh devassist-call-coach-v1.0.0.zip
```

**Checklist:**
- [ ] Zip file created
- [ ] All files included (manifest.json, assets/, icons/, src/)
- [ ] Zip size: ~150-200 KB
- [ ] No .env files in zip (security check!)

---

### Phase 3: Chrome Web Store Submission

#### Step 3.1: Prepare Store Assets

**Required Files:**
- [ ] **Icons**
  - 16x16 PNG: `public/icons/icon16.png`
  - 48x48 PNG: `public/icons/icon48.png`
  - 128x128 PNG: `public/icons/icon128.png`

- [ ] **Screenshots** (create 3-5 screenshots)
  - Side panel with AI tips
  - Warmup loading state
  - Option selection interface
  - Tips history view
  - Error state

- [ ] **Promotional Images** (optional)
  - 440x280 Small tile
  - 920x680 Large tile
  - 1400x560 Marquee

---

#### Step 3.2: Complete Store Listing

**Store Information:**
- **Title:** DevAssist-Call-Coach
- **Category:** Productivity
- **Language:** English (United States)
- **Visibility:** Private (restrict to specific users)

**Short Description (132 chars max):**
```
Real-time AI conversation coaching for sales agents. Get instant suggestions during live customer calls.
```

**Detailed Description:**
```
DevAssist-Call-Coach provides real-time AI conversation coaching for sales agents during live customer calls.

KEY FEATURES:
✓ Real-time transcription of your calls
✓ AI-powered coaching suggestions every 30 seconds
✓ 3 dialogue options: Minimal, Explanative, Contextual
✓ Conversation-first guidance to build rapport
✓ Buying signal identification
✓ Natural conversation flow maintained

HOW IT WORKS:
1. Start a customer call
2. Click "Start AI Coaching" in the extension
3. AI analyzes conversation after 3-minute warmup
4. Receive actionable coaching tips in real-time
5. Choose from 3 response styles based on situation
6. Close more deals with better conversations

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
- Backend deployment (AWS)
- OpenAI API key (GPT-4o-mini)
- Deepgram API key (transcription)
```

**Privacy Policy URL:**
- [ ] Create privacy policy page
- [ ] Host on company website or GitHub Pages
- [ ] URL: `_____________________________`

**Checklist:**
- [ ] All store information completed
- [ ] Screenshots uploaded (3-5 images)
- [ ] Privacy policy URL provided
- [ ] Contact email configured
- [ ] Visibility set to "Private"

---

#### Step 3.3: Submit for Review
```bash
# 1. Go to Chrome Web Store Developer Dashboard
open https://chrome.google.com/webstore/devconsole

# 2. Click "New Item"
# 3. Upload devassist-call-coach-v1.0.0.zip
# 4. Fill out all store listing information
# 5. Upload screenshots and icons
# 6. Submit for review

# Review time: 1-3 business days
```

**Checklist:**
- [ ] Extension uploaded
- [ ] Store listing complete
- [ ] Submitted for review
- [ ] Confirmation email received
- [ ] Extension ID noted: `_____________________________`

---

#### Step 3.4: Update Backend CORS After Approval

Once Chrome Web Store approves your extension, you'll receive an extension ID:

```bash
# Update backend CORS to allow your extension
cd backend/
eb setenv ALLOWED_ORIGINS="chrome-extension://<YOUR_EXTENSION_ID>"

# Redeploy backend
eb deploy
```

**Checklist:**
- [ ] Extension approved by Chrome Web Store
- [ ] Extension ID obtained
- [ ] Backend CORS updated
- [ ] Backend redeployed
- [ ] Connection tested from published extension

---

### Phase 4: Team Distribution

#### Step 4.1: Configure Private Distribution
```bash
# 1. Chrome Web Store Dashboard → Your Extension
# 2. Navigate to "Distribution" tab
# 3. Set visibility to "Private"
# 4. Add allowed users by email:
#    - agent1@yourcompany.com
#    - agent2@yourcompany.com
#    - manager@yourcompany.com
# 5. Save settings
```

**Checklist:**
- [ ] Visibility set to "Private"
- [ ] Team members added (list emails below)
- [ ] Test installation with one team member
- [ ] Installation link: `_____________________________`

---

#### Step 4.2: Create User Documentation
- [ ] Installation guide for team
- [ ] Usage instructions
- [ ] Troubleshooting guide
- [ ] Support contact information
- [ ] Training session scheduled (optional)

---

### Phase 5: Monitoring & Verification

#### Step 5.1: Set Up CloudWatch Alarms
```bash
# Create alarm for high error rate
aws cloudwatch put-metric-alarm \
  --alarm-name devassist-high-error-rate \
  --alarm-description "Error rate > 5%" \
  --metric-name 4XXError \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold

# Create alarm for instance health
aws cloudwatch put-metric-alarm \
  --alarm-name devassist-instance-health \
  --alarm-description "Instance health degraded" \
  --metric-name HealthyHostCount \
  --namespace AWS/ApplicationELB \
  --statistic Average \
  --period 60 \
  --threshold 1 \
  --comparison-operator LessThanThreshold
```

**Checklist:**
- [ ] Error rate alarm configured
- [ ] Instance health alarm configured
- [ ] SNS topic created for notifications
- [ ] Email subscribed to alerts

---

#### Step 5.2: Test Production System End-to-End
- [ ] Extension connects to production backend
- [ ] AI coaching tips appear during test call
- [ ] 3 options display correctly
- [ ] Option selection works
- [ ] Tips history expansion works
- [ ] Countdown timer accurate
- [ ] All animations smooth
- [ ] No console errors
- [ ] Performance acceptable (<1s latency)

---

#### Step 5.3: Cost Monitoring
```bash
# Set up AWS Budget alert
aws budgets create-budget \
  --account-id <YOUR_ACCOUNT_ID> \
  --budget file://budget.json

# budget.json:
# {
#   "BudgetName": "DevAssist-Monthly-Budget",
#   "BudgetLimit": {
#     "Amount": "150",
#     "Unit": "USD"
#   },
#   "TimeUnit": "MONTHLY",
#   "BudgetType": "COST"
# }
```

**Checklist:**
- [ ] AWS budget configured
- [ ] Budget alert set to $150/month
- [ ] OpenAI usage dashboard bookmarked
- [ ] Cost baseline established

---

## 📊 Post-Deployment Verification

### Production URLs
- **Backend Health:** https://<EB_URL>/health
- **Backend WebSocket:** wss://<EB_URL>
- **Chrome Extension:** chrome-extension://<EXTENSION_ID>
- **Store Listing:** https://chrome.google.com/webstore/detail/<EXTENSION_ID>

### Verification Tests
- [ ] Health endpoint returns 200 OK
- [ ] WebSocket handshake successful
- [ ] AI analysis completes in <1 second
- [ ] Database connection stable
- [ ] Logs show no errors
- [ ] Extension install count: _____ users
- [ ] No crashes reported in first 24 hours

### Performance Metrics (First Week)
- **Target AI Latency:** <1s P95 → Actual: _____
- **WebSocket Success Rate:** >95% → Actual: _____
- **Error Rate:** <5% → Actual: _____
- **Uptime:** >99% → Actual: _____
- **Cost per call:** ~$0.045 → Actual: _____

---

## 🔧 Rollback Plan

If critical issues arise:

```bash
# Backend rollback
cd backend/
eb appversion  # List versions
eb deploy --version <PREVIOUS_VERSION>

# Extension rollback
# 1. Chrome Web Store Dashboard
# 2. Upload previous version zip
# 3. Submit for expedited review
```

---

## 📞 Support Contacts

**Technical Issues:**
- Email: devassist-support@yourcompany.com
- Slack: #devassist-call-coach

**AWS Support:**
- AWS Console: https://console.aws.amazon.com/support

**Chrome Web Store:**
- Developer Support: https://support.google.com/chrome_webstore/

---

## ✅ Deployment Completion Checklist

### Backend
- [ ] RDS database created and migrated
- [ ] Elastic Beanstalk environment running
- [ ] All environment variables configured
- [ ] Health endpoint accessible
- [ ] Logs showing no errors

### Extension
- [ ] Production build created
- [ ] Chrome Web Store submission approved
- [ ] Extension ID obtained
- [ ] Backend CORS updated with extension ID
- [ ] Installation link shared with team

### Monitoring
- [ ] CloudWatch alarms configured
- [ ] Cost budgets set up
- [ ] Error tracking enabled
- [ ] Performance baseline established

### Documentation
- [ ] User guide created
- [ ] Privacy policy published
- [ ] Support channels configured
- [ ] Team trained

---

## 🎉 Go-Live Criteria

**Ready to launch when:**
- ✅ All backend services healthy
- ✅ Extension approved by Chrome Web Store
- ✅ End-to-end test successful
- ✅ Monitoring and alerts configured
- ✅ Team notified and trained
- ✅ Support channels ready

---

**Status:** 🚀 READY TO DEPLOY
**Deployment Date:** _______________
**Deployed By:** _______________
**Version:** 1.0.0
