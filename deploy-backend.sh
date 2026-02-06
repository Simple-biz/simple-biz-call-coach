#!/bin/bash
#
# DevAssist-Call-Coach - Backend Deployment Script
# Version: 1.0.0
# Created: 2025-12-26
#

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Project paths
PROJECT_ROOT="/Users/cob/DevAssist/Projects/DevAssist-Call-Coach"
BACKEND_DIR="$PROJECT_ROOT/backend"

# Functions
print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

# Step 1: Collect Information
print_header "Step 1: Collect Required Information"

# Database password
echo -e "${YELLOW}Database Password${NC}"
echo "Please enter a secure password for the RDS PostgreSQL database."
echo "Requirements: 8+ characters, letters, numbers, and symbols"
echo ""
read -s -p "Enter database password: " DB_PASSWORD
echo ""
read -s -p "Confirm password: " DB_PASSWORD_CONFIRM
echo ""
echo ""

if [ "$DB_PASSWORD" != "$DB_PASSWORD_CONFIRM" ]; then
    print_error "Passwords don't match!"
    exit 1
fi

if [ ${#DB_PASSWORD} -lt 8 ]; then
    print_error "Password must be at least 8 characters!"
    exit 1
fi

print_success "Database password set"

# Backend API key (generate or use existing)
echo ""
echo -e "${YELLOW}Backend API Key${NC}"
echo "This key authenticates the extension to the backend."
echo ""
read -p "Generate new API key? (y/n): " GENERATE_KEY

if [ "$GENERATE_KEY" = "y" ]; then
    BACKEND_API_KEY=$(openssl rand -base64 32)
    print_success "Generated new API key: ${BACKEND_API_KEY:0:10}..."
else
    # Try to get from backend/.env
    if [ -f "$BACKEND_DIR/.env" ]; then
        BACKEND_API_KEY=$(grep "^API_KEY=" "$BACKEND_DIR/.env" | cut -d'=' -f2)
        if [ -n "$BACKEND_API_KEY" ]; then
            print_success "Using API key from backend/.env"
        else
            print_error "No API_KEY found in backend/.env"
            exit 1
        fi
    else
        print_error "backend/.env not found"
        exit 1
    fi
fi

# OpenAI API key
echo ""
echo -e "${YELLOW}OpenAI API Key${NC}"
if [ -f "$BACKEND_DIR/.env" ]; then
    OPENAI_API_KEY=$(grep "^OPENAI_API_KEY=" "$BACKEND_DIR/.env" | cut -d'=' -f2)
    if [ -n "$OPENAI_API_KEY" ]; then
        print_success "Found OpenAI API key in backend/.env"
    else
        print_error "No OPENAI_API_KEY found in backend/.env"
        exit 1
    fi
else
    print_error "backend/.env not found"
    exit 1
fi

# Save configuration
print_header "Step 2: Create RDS PostgreSQL Database"

print_info "Creating database instance (this takes 5-10 minutes)..."
echo ""

DB_INSTANCE_ID="devassist-call-coach-db"

# Check if database already exists
if aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" >/dev/null 2>&1; then
    print_warning "Database instance '$DB_INSTANCE_ID' already exists!"
    read -p "Use existing database? (y/n): " USE_EXISTING

    if [ "$USE_EXISTING" = "y" ]; then
        print_info "Using existing database instance..."
        DB_ENDPOINT=$(aws rds describe-db-instances \
            --db-instance-identifier "$DB_INSTANCE_ID" \
            --query 'DBInstances[0].Endpoint.Address' \
            --output text)
        print_success "Database endpoint: $DB_ENDPOINT"
    else
        print_error "Please delete the existing database or choose a different name"
        exit 1
    fi
else
    # Create new database
    aws rds create-db-instance \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --db-instance-class db.t3.micro \
        --engine postgres \
        --engine-version 15.4 \
        --master-username dbadmin \
        --master-user-password "$DB_PASSWORD" \
        --allocated-storage 20 \
        --storage-type gp2 \
        --db-name devassist_call_coach \
        --backup-retention-period 7 \
        --publicly-accessible false \
        --no-multi-az

    print_success "Database creation initiated"
    print_info "Waiting for database to become available (5-10 minutes)..."

    aws rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_ID"

    print_success "Database is now available!"

    # Get database endpoint
    DB_ENDPOINT=$(aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --query 'DBInstances[0].Endpoint.Address' \
        --output text)

    print_success "Database endpoint: $DB_ENDPOINT"
fi

# Construct DATABASE_URL
DATABASE_URL="postgresql://dbadmin:${DB_PASSWORD}@${DB_ENDPOINT}:5432/devassist_call_coach"

# Step 3: Initialize Elastic Beanstalk
print_header "Step 3: Initialize Elastic Beanstalk Application"

cd "$BACKEND_DIR"

# Check if already initialized
if [ -d ".elasticbeanstalk" ]; then
    print_warning "Elastic Beanstalk already initialized in backend/"
    print_info "Using existing configuration"
else
    print_info "Initializing Elastic Beanstalk application..."

    eb init -p node.js-20 devassist-call-coach --region us-east-1

    print_success "Elastic Beanstalk application initialized"
fi

# Step 4: Create Environment
print_header "Step 4: Create Production Environment"

ENV_NAME="devassist-call-coach-prod"

# Check if environment exists
if eb list | grep -q "$ENV_NAME"; then
    print_warning "Environment '$ENV_NAME' already exists!"
    read -p "Use existing environment? (y/n): " USE_EXISTING_ENV

    if [ "$USE_EXISTING_ENV" != "y" ]; then
        print_error "Please terminate the existing environment or choose a different name"
        exit 1
    fi

    print_info "Using existing environment..."
else
    print_info "Creating production environment (this takes 5-10 minutes)..."

    eb create "$ENV_NAME" \
        --instance-type t3.small \
        --elb-type application \
        --envvars NODE_ENV=production,PORT=8080

    print_success "Environment created successfully!"
fi

# Get environment URL
EB_URL=$(eb status | grep "CNAME" | awk '{print $2}')
print_success "Environment URL: $EB_URL"

# Step 5: Configure Environment Variables
print_header "Step 5: Configure Environment Variables"

print_info "Setting environment variables..."

eb setenv \
    DATABASE_URL="$DATABASE_URL" \
    OPENAI_API_KEY="$OPENAI_API_KEY" \
    API_KEY="$BACKEND_API_KEY" \
    ALLOWED_ORIGINS="chrome-extension://PLACEHOLDER" \
    LOG_LEVEL="info" \
    NODE_ENV="production" \
    AI_WARMUP_DURATION_MS="180000" \
    AI_ANALYSIS_INTERVAL_MS="30000" \
    MAX_CONTEXT_TOKENS="100000" \
    SUMMARY_INTERVAL_MS="600000" \
    DATA_RETENTION_DAYS="30"

print_success "Environment variables configured"

# Step 6: Build and Deploy
print_header "Step 6: Build and Deploy Backend"

print_info "Installing dependencies..."
npm install

print_info "Running tests..."
npm test

print_info "Building TypeScript..."
npm run build

print_info "Deploying to Elastic Beanstalk..."
eb deploy

print_success "Backend deployed successfully!"

# Step 7: Run Migrations
print_header "Step 7: Run Database Migrations"

print_info "Connecting to instance via SSH..."
print_warning "You'll be connected to the EC2 instance. Run these commands:"
echo ""
echo "  cd /var/app/current"
echo "  npm run migrate up"
echo "  npm run migrate status"
echo "  exit"
echo ""
read -p "Press Enter to connect via SSH..."

eb ssh

# Step 8: Verify Deployment
print_header "Step 8: Verify Deployment"

print_info "Checking health endpoint..."
sleep 5

HEALTH_URL="https://$EB_URL/health"
HEALTH_RESPONSE=$(curl -s "$HEALTH_URL")

echo ""
echo "Health check response:"
echo "$HEALTH_RESPONSE"
echo ""

if echo "$HEALTH_RESPONSE" | grep -q "\"status\":\"ok\""; then
    print_success "Backend is healthy!"
else
    print_warning "Health check may have issues. Check logs with: eb logs"
fi

# Summary
print_header "Deployment Complete!"

echo ""
print_success "Backend URL: wss://$EB_URL"
print_success "Health Endpoint: https://$EB_URL/health"
print_success "Database Endpoint: $DB_ENDPOINT"
echo ""

print_info "Save these values for extension configuration:"
echo ""
echo "VITE_BACKEND_WS_URL=wss://$EB_URL"
echo "VITE_BACKEND_API_KEY=$BACKEND_API_KEY"
echo ""

print_info "Next steps:"
echo "1. Create .env.production with the values above"
echo "2. Build production extension: NODE_ENV=production npm run build"
echo "3. Test extension locally"
echo "4. Submit to Chrome Web Store"
echo ""

# Save deployment info
cat > "$PROJECT_ROOT/DEPLOYMENT-INFO.txt" << EOF
Deployment Date: $(date)
Backend URL: wss://$EB_URL
Database Endpoint: $DB_ENDPOINT
Backend API Key: $BACKEND_API_KEY

Environment Variables Set:
- DATABASE_URL: postgresql://dbadmin:****@$DB_ENDPOINT:5432/devassist_call_coach
- OPENAI_API_KEY: ****
- API_KEY: $BACKEND_API_KEY
- ALLOWED_ORIGINS: chrome-extension://PLACEHOLDER (update after Chrome Web Store approval)
- LOG_LEVEL: info
- NODE_ENV: production

Next Steps:
1. Update ALLOWED_ORIGINS after getting Chrome extension ID
2. Create .env.production for extension build
3. Build and test extension
4. Submit to Chrome Web Store
EOF

print_success "Deployment information saved to DEPLOYMENT-INFO.txt"

echo ""
print_success "Backend deployment complete! 🚀"
echo ""
