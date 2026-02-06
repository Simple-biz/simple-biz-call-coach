# 🚀 Backend Deployment - Ready to Start

**Date:** 2025-12-26
**Status:** ✅ Ready to begin deployment
**Estimated Time:** 90 minutes

---

## 📋 Pre-Deployment Verification

### ✅ Confirmed Ready
- ✅ OpenAI API key available (configured in backend/.env)
- ✅ Database password (you'll provide during deployment)
- ✅ Cost approval (~$96/month)
- ✅ EB CLI installed and verified
- ✅ AWS credentials configured

### ✅ Deployment Tools Created
- ✅ Automated deployment script: `deploy-backend.sh`
- ✅ Manual guides available
- ✅ Helper utilities ready

---

## 🎯 Two Deployment Options

### Option 1: Automated Script (Recommended) ⭐

**Best for:** Complete guided deployment with error handling

**Features:**
- ✅ Interactive prompts for sensitive data
- ✅ Validates inputs and checks for existing resources
- ✅ Waits for AWS resources to be ready
- ✅ Provides real-time status updates
- ✅ Saves deployment information automatically
- ✅ Handles errors and provides helpful messages

**Time:** 90 minutes (mostly AWS waiting time)

**To start:**
```bash
./deploy-backend.sh
```

**What it will do:**
1. Prompt for database password (secure input)
2. Generate or use existing backend API key
3. Verify OpenAI API key
4. Create RDS PostgreSQL database (5-10 min wait)
5. Initialize Elastic Beanstalk application
6. Create production environment (5-10 min wait)
7. Configure all environment variables
8. Build and deploy backend code
9. Guide you through SSH to run migrations
10. Verify health endpoint
11. Save deployment info for extension build

---

### Option 2: Manual Step-by-Step

**Best for:** Understanding each step in detail

**Guides available:**
- `DEPLOYMENT-QUICK-START.md` - Streamlined steps
- `PRODUCTION-DEPLOYMENT-CHECKLIST.md` - Comprehensive checklist

**To start:**
```bash
# Follow the quick start guide
open DEPLOYMENT-QUICK-START.md

# Or detailed checklist
open PRODUCTION-DEPLOYMENT-CHECKLIST.md
```

---

## 🚀 Recommended: Start Automated Deployment

The automated script is safer and faster. It handles all the complexity for you.

### Step 1: Run the Script
```bash
./deploy-backend.sh
```

### Step 2: Provide Information When Prompted

You'll be asked for:

1. **Database Password**
   - Must be 8+ characters
   - Include letters, numbers, and symbols
   - Example: `MySecure#Pass2025`
   - You'll type it twice to confirm
   - (Input is hidden for security)

2. **Backend API Key**
   - Script can generate one for you (recommended)
   - Or use existing from backend/.env
   - This authenticates extension to backend

3. **OpenAI API Key**
   - Automatically detected from backend/.env
   - Just confirm it's correct

### Step 3: Wait for AWS Resources

The script will create:
- **RDS Database:** ~5-10 minutes
- **EB Environment:** ~5-10 minutes
- **Total waiting time:** ~15-20 minutes

While waiting, the script shows:
- Progress indicators
- Status messages
- What's happening behind the scenes

### Step 4: Run Migrations

When the script connects you via SSH:
```bash
cd /var/app/current
npm run migrate up
npm run migrate status
exit
```

### Step 5: Verify Health

Script automatically checks:
```bash
curl https://your-backend-url/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2025-12-26T..."
}
```

---

## 📊 What Gets Created

### AWS Resources

**1. RDS PostgreSQL Database**
- Instance ID: `devassist-call-coach-db`
- Class: `db.t3.micro`
- Engine: PostgreSQL 15.4
- Storage: 20 GB
- Backups: 7-day retention
- **Cost:** ~$15/month

**2. Elastic Beanstalk Environment**
- Environment: `devassist-call-coach-prod`
- Platform: Node.js 20 on Amazon Linux 2023
- Instance type: `t3.small`
- Auto-scaling: 1-4 instances
- **Cost:** ~$15/month

**3. Application Load Balancer**
- WebSocket support enabled
- HTTPS/WSS enabled
- Health checks configured
- **Cost:** ~$16/month

**4. CloudWatch Logs**
- 7-day retention
- Application logs
- Error tracking
- **Cost:** ~$5/month

**Total AWS Cost:** ~$60/month

---

## 🔍 During Deployment - What to Watch

### Progress Indicators

The script shows:
```
Creating RDS database...
⏳ Waiting for database (5-10 minutes)...
✓ Database available!
✓ Endpoint: xxx.rds.amazonaws.com

Initializing Elastic Beanstalk...
✓ Application initialized

Creating environment (5-10 minutes)...
⏳ Waiting for environment...
✓ Environment ready!
✓ URL: xxx.elasticbeanstalk.com

Configuring environment variables...
✓ All variables set

Building backend...
✓ Build successful

Deploying to Elastic Beanstalk...
✓ Deployment complete!
```

### Common Waiting Times
- Database creation: 5-10 minutes
- Environment creation: 5-10 minutes
- Deployment: 3-5 minutes
- **Total:** ~15-20 minutes of waiting

---

## 💾 Deployment Info Saved

After completion, you'll have:

**File:** `DEPLOYMENT-INFO.txt`

Contains:
- Backend URL (wss://...)
- Database endpoint
- Backend API key
- All environment variables
- Next steps for extension build

**Example:**
```
Backend URL: wss://devassist-call-coach-prod.us-east-1.elasticbeanstalk.com
Backend API Key: abc123xyz...

For .env.production:
VITE_BACKEND_WS_URL=wss://devassist-call-coach-prod.us-east-1.elasticbeanstalk.com
VITE_BACKEND_API_KEY=abc123xyz...
```

---

## 🆘 If Something Goes Wrong

### Script Handles Common Issues

**Database already exists:**
- Script asks if you want to use existing
- Or prompts to delete and recreate

**Environment already exists:**
- Script asks if you want to use existing
- Or prompts to choose different name

**Tests fail:**
- Script stops before deployment
- Shows which tests failed
- Asks if you want to continue anyway

**Deployment fails:**
- Script shows error message
- Provides rollback instructions
- Links to troubleshooting guide

### Manual Troubleshooting

**Check AWS resources:**
```bash
# List RDS databases
aws rds describe-db-instances

# Check EB environments
eb list

# View logs
eb logs
```

**Rollback if needed:**
```bash
# Terminate EB environment
eb terminate devassist-call-coach-prod

# Delete RDS database
aws rds delete-db-instance \
  --db-instance-identifier devassist-call-coach-db \
  --skip-final-snapshot
```

---

## 📈 After Deployment Success

### You'll Have

1. **Backend running at:**
   - `wss://your-eb-url.elasticbeanstalk.com`
   - Health: `https://your-eb-url/health`

2. **Database running:**
   - PostgreSQL 15.4
   - Tables created via migrations
   - Ready for connections

3. **Deployment info:**
   - Saved in `DEPLOYMENT-INFO.txt`
   - Contains all values for extension build

### Next Steps

1. **Create .env.production** (2 minutes)
   ```bash
   # Use values from DEPLOYMENT-INFO.txt
   cat > .env.production << EOF
   VITE_BACKEND_WS_URL=wss://YOUR_EB_URL
   VITE_BACKEND_API_KEY=YOUR_API_KEY
   VITE_DEEPGRAM_API_KEY=YOUR_DEEPGRAM_KEY
   EOF
   ```

2. **Build production extension** (3 minutes)
   ```bash
   NODE_ENV=production npm run build
   ```

3. **Test locally** (5 minutes)
   - Load dist/ in Chrome
   - Verify connection to production backend

4. **Create Chrome package** (2 minutes)
   ```bash
   cd dist/ && zip -r ../extension.zip .
   ```

---

## 🎯 Ready to Start?

### Recommended Command
```bash
./deploy-backend.sh
```

This will walk you through everything step-by-step with helpful prompts and error handling.

### Alternative: Manual Deployment
```bash
open DEPLOYMENT-QUICK-START.md
```

Follow Phase 1 step-by-step.

---

## ⏱️ Timeline

**Total Time:** 90 minutes

- **Active work:** 30 minutes
  - Providing inputs: 5 min
  - Building/deploying: 10 min
  - Running migrations: 5 min
  - Verification: 5 min
  - Creating extension config: 5 min

- **Waiting on AWS:** 60 minutes
  - Database creation: 5-10 min
  - Environment creation: 5-10 min
  - Deployment: 3-5 min
  - (Can work on other things during wait times)

---

**Status:** 🟢 READY TO START
**Recommended Action:** Run `./deploy-backend.sh`
**Time Required:** 90 minutes
**Prerequisites:** ✅ All met
