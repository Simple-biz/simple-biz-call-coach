# Production Deployment - Quick Start Guide

**Version:** 1.0.0
**Date:** 2025-12-26
**Estimated Time:** 2-4 hours

---

## 🎯 Overview

This guide walks you through deploying DevAssist-Call-Coach to production in 3 phases:
1. **Backend** → AWS Elastic Beanstalk + RDS PostgreSQL
2. **Extension** → Build for production and create Chrome Web Store package
3. **Distribution** → Chrome Web Store submission and team rollout

---

## 📋 Prerequisites (30 minutes)

### Accounts Needed
- [ ] **AWS Account** - https://aws.amazon.com/free
- [ ] **OpenAI Account** - https://platform.openai.com (requires billing)
- [ ] **Deepgram Account** - Already have API key
- [ ] **Chrome Web Store Developer** - https://chrome.google.com/webstore/devconsole ($5 one-time)

### Tools to Install
```bash
# AWS CLI
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /

# AWS Elastic Beanstalk CLI
pip install awsebcli --upgrade --user

# Verify installations
aws --version
eb --version
```

### API Keys to Obtain
1. **OpenAI API Key**
   - Go to https://platform.openai.com/api-keys
   - Create new key
   - Add billing method
   - Copy key (starts with `sk-`)

2. **Backend API Key** (generate now)
   ```bash
   openssl rand -base64 32
   ```
   Save this - you'll use it in both backend and extension

---

## 🚀 Phase 1: Deploy Backend (60-90 minutes)

### Step 1: Configure AWS Credentials
```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Region: us-east-1
# Output format: json
```

### Step 2: Create RDS Database
```bash
# Create PostgreSQL database (takes 5-10 minutes)
aws rds create-db-instance \
  --db-instance-identifier devassist-call-coach-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username dbadmin \
  --master-user-password CHOOSE_SECURE_PASSWORD_HERE \
  --allocated-storage 20 \
  --db-name devassist_call_coach \
  --backup-retention-period 7

# Wait for database to be ready
aws rds wait db-instance-available --db-instance-identifier devassist-call-coach-db

# Get database endpoint (save this)
aws rds describe-db-instances \
  --db-instance-identifier devassist-call-coach-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

### Step 3: Initialize Elastic Beanstalk
```bash
cd backend/

# Initialize EB application
eb init -p node.js-20 devassist-call-coach --region us-east-1

# Create production environment (takes 5-10 minutes)
eb create devassist-call-coach-prod \
  --instance-type t3.small \
  --elb-type application

# This creates your backend infrastructure
```

### Step 4: Configure Environment Variables
```bash
# Replace placeholders with your actual values
eb setenv \
  DATABASE_URL="postgresql://dbadmin:YOUR_DB_PASSWORD@YOUR_RDS_ENDPOINT:5432/devassist_call_coach" \
  OPENAI_API_KEY="sk-YOUR_OPENAI_KEY" \
  API_KEY="YOUR_GENERATED_API_KEY_FROM_STEP_2" \
  ALLOWED_ORIGINS="chrome-extension://PLACEHOLDER" \
  LOG_LEVEL="info" \
  NODE_ENV="production"
```

### Step 5: Deploy Backend Code
```bash
# Build and deploy
npm install
npm run build
eb deploy

# Monitor deployment
eb logs --stream
```

### Step 6: Run Database Migrations
```bash
# SSH into backend instance
eb ssh

# Run migrations
cd /var/app/current
npm run migrate up

# Exit SSH
exit
```

### Step 7: Verify Backend
```bash
# Get backend URL
eb status

# Test health endpoint
curl https://YOUR_EB_URL/health

# Expected: {"status":"ok","database":"connected",...}
```

**✅ Save your backend URL:** `wss://YOUR_EB_URL`

---

## 🎨 Phase 2: Build Extension (30 minutes)

### Step 1: Create Production Environment File
```bash
cd /Users/cob/DevAssist/Projects/DevAssist-Call-Coach

# Create .env.production file
cat > .env.production << EOF
VITE_BACKEND_WS_URL=wss://YOUR_EB_URL_FROM_PHASE_1
VITE_BACKEND_API_KEY=YOUR_GENERATED_API_KEY
VITE_DEEPGRAM_API_KEY=YOUR_DEEPGRAM_KEY
EOF
```

### Step 2: Build Production Extension
```bash
# Install dependencies
npm install

# Build for production
NODE_ENV=production npm run build

# Verify dist/ folder created
ls -la dist/
```

### Step 3: Test Locally (Important!)
1. Open Chrome: `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `dist/` folder
5. Test:
   - Extension loads without errors
   - Connects to production backend (check status indicator)
   - Start a test call
   - Click "Start AI Coaching"
   - Wait 3 minutes for warmup
   - Verify AI tips appear

### Step 4: Create Chrome Web Store Package
```bash
# Create zip file for Chrome Web Store
cd dist/
zip -r ../devassist-call-coach-v1.0.0.zip .
cd ..

# Verify package
unzip -l devassist-call-coach-v1.0.0.zip | head -20

# SECURITY CHECK: Ensure no .env files in package!
unzip -l devassist-call-coach-v1.0.0.zip | grep .env
# Should return nothing
```

**✅ Package ready:** `devassist-call-coach-v1.0.0.zip`

---

## 📦 Phase 3: Chrome Web Store Submission (45 minutes + review time)

### Step 1: Prepare Assets

**Screenshots Needed (create 3-5):**
- Extension side panel with AI tips
- Warmup loading state
- Option selection interface
- Tips history expanded
- Error state (optional)

**Screenshot Tool:**
```bash
# Use Chrome's screenshot tool:
# 1. Open extension side panel
# 2. Press Cmd+Shift+5 (Mac) or use Chrome DevTools
# 3. Capture at 1280x800 resolution
```

### Step 2: Submit to Chrome Web Store

1. **Go to Developer Dashboard**
   ```bash
   open https://chrome.google.com/webstore/devconsole
   ```

2. **Create New Item**
   - Click "New Item"
   - Upload `devassist-call-coach-v1.0.0.zip`
   - Pay $5 developer fee (one-time, if first extension)

3. **Fill Store Listing**
   - **Title:** DevAssist-Call-Coach
   - **Category:** Productivity
   - **Language:** English (United States)

   - **Short Description (132 chars max):**
     ```
     Real-time AI conversation coaching for sales agents. Get instant suggestions during live customer calls.
     ```

   - **Detailed Description:**
     ```
     DevAssist-Call-Coach provides real-time AI conversation coaching for sales agents during live customer calls.

     KEY FEATURES:
     ✓ Real-time transcription of your calls
     ✓ AI-powered coaching suggestions every 30 seconds
     ✓ 3 dialogue options: Minimal, Explanative, Contextual
     ✓ Buying signal identification
     ✓ Natural conversation flow maintained

     HOW IT WORKS:
     1. Start a customer call
     2. Click "Start AI Coaching" in extension
     3. AI analyzes conversation after 3-minute warmup
     4. Receive actionable coaching tips in real-time
     5. Choose from 3 response styles
     6. Close more deals with better conversations

     REQUIREMENTS:
     - Chrome 110+
     - Backend deployment (included)
     - OpenAI API key (GPT-4o-mini)
     ```

4. **Upload Assets**
   - Upload 3-5 screenshots (1280x800)
   - Icons already included (128x128, 48x48, 16x16)

5. **Privacy Policy**
   - Create simple privacy policy (template below)
   - Host on GitHub Pages or company website
   - Add URL to store listing

**Privacy Policy Template:**
```markdown
# Privacy Policy - DevAssist-Call-Coach

Last updated: 2025-12-26

## Data Collection
We collect call transcripts and conversation metadata to provide AI coaching suggestions.

## Data Storage
- Transcripts stored for 30 days, then automatically deleted
- Data encrypted in transit (WSS) and at rest (AWS RDS)
- No data sold or shared with third parties

## Data Usage
Transcripts are sent to OpenAI GPT-4o-mini for analysis. See OpenAI's privacy policy.

## Contact
Questions? Email: your-support-email@company.com
```

6. **Set Visibility to Private**
   - Distribution tab → Visibility: "Private"
   - Add allowed user emails (your sales team)

7. **Submit for Review**
   - Click "Submit for Review"
   - Review time: 1-3 business days

### Step 3: After Approval

Once approved, you'll receive an extension ID (e.g., `chrome-extension://abcdefghijklmnop`)

**Update Backend CORS:**
```bash
cd backend/
eb setenv ALLOWED_ORIGINS="chrome-extension://YOUR_EXTENSION_ID"
eb deploy
```

### Step 4: Distribute to Team

**Share installation link:**
```
https://chrome.google.com/webstore/detail/devassist-call-coach/YOUR_EXTENSION_ID
```

**Send to team:**
```
Subject: New Tool: DevAssist AI Call Coach

Hi Team,

DevAssist-Call-Coach is now available! Get real-time AI coaching during customer calls.

INSTALLATION:
1. Install: [Chrome Web Store Link]
2. Click extension icon to open side panel
3. Start a call and click "Start AI Coaching"
4. AI tips appear after 3-minute warmup

You'll receive coaching suggestions like:
- "Ask Budget" when cost concerns arise
- "Build Trust" for relationship opportunities
- "Close Next Steps" when buying signals appear

Questions? Reach out on Slack: #devassist-call-coach
```

---

## ✅ Deployment Complete!

### Final Verification
- [ ] Backend health endpoint returns 200 OK
- [ ] Extension connects to production backend
- [ ] AI tips appear during test call
- [ ] Team can install extension
- [ ] CloudWatch logs show no errors

### Monitoring Setup
```bash
# View backend logs
cd backend/
eb logs --stream

# Check OpenAI usage
# Visit: https://platform.openai.com/usage

# Check AWS costs
# Visit: https://console.aws.amazon.com/billing
```

### Monthly Costs (Estimated)
- AWS (RDS + EB + ALB): ~$60/month
- OpenAI API (100 agents): ~$36/month
- **Total: ~$96/month**

---

## 🆘 Troubleshooting

### Extension Can't Connect to Backend
```bash
# Check backend is running
eb status

# Check CORS configuration
eb printenv | grep ALLOWED_ORIGINS

# Test WebSocket manually
wscat -c wss://YOUR_EB_URL
```

### Backend Database Errors
```bash
# Check database connection
eb ssh
psql $DATABASE_URL

# Verify migrations ran
npm run migrate status
```

### High Costs
```bash
# Check OpenAI usage
# Dashboard: https://platform.openai.com/usage

# Verify rate limiting (30s between analyses)
eb logs | grep "AI_ANALYSIS"
```

---

## 📚 Additional Resources

- **Full Deployment Guide:** `DEPLOYMENT-GUIDE.md`
- **Detailed Checklist:** `PRODUCTION-DEPLOYMENT-CHECKLIST.md`
- **Deployment Helper Script:** `./deploy-helper.sh`
- **Architecture Docs:** `docs/architecture.md`

---

## 🎉 You're Live!

Your AI coaching assistant is now in production. Monitor for the first 24-48 hours and gather user feedback.

**Next Steps:**
1. Set up CloudWatch alarms for errors
2. Configure AWS budget alerts ($150/month)
3. Schedule weekly log reviews
4. Plan first team training session
5. Create feedback channel (#devassist-feedback)

---

**Deployed By:** _______________
**Deployment Date:** _______________
**Backend URL:** _______________
**Extension ID:** _______________
**Status:** 🚀 LIVE
