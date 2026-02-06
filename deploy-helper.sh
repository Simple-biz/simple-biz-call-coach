#!/bin/bash
#
# DevAssist-Call-Coach Deployment Helper Script
# Version: 1.0.0
# Created: 2025-12-26
#
# This script helps automate common deployment tasks
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project directories
PROJECT_ROOT="/Users/cob/DevAssist/Projects/DevAssist-Call-Coach"
BACKEND_DIR="$PROJECT_ROOT/backend"
DIST_DIR="$PROJECT_ROOT/dist"

# Functions
print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
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
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Menu
show_menu() {
    print_header "DevAssist-Call-Coach Deployment Helper"
    echo ""
    echo "1. Check Prerequisites"
    echo "2. Build Extension for Production"
    echo "3. Create Chrome Web Store Package"
    echo "4. Build Backend for Production"
    echo "5. Test Production Extension Locally"
    echo "6. Generate Secure API Key"
    echo "7. View Deployment Checklist"
    echo "8. Full Production Build (Extension + Backend)"
    echo "9. Exit"
    echo ""
    read -p "Select an option (1-9): " choice
    echo ""

    case $choice in
        1) check_prerequisites ;;
        2) build_extension_production ;;
        3) create_chrome_package ;;
        4) build_backend_production ;;
        5) test_production_extension ;;
        6) generate_api_key ;;
        7) view_checklist ;;
        8) full_production_build ;;
        9) exit 0 ;;
        *) print_error "Invalid option" && show_menu ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"

    # Node.js
    if command_exists node; then
        NODE_VERSION=$(node --version)
        print_success "Node.js installed: $NODE_VERSION"
    else
        print_error "Node.js not installed"
    fi

    # npm
    if command_exists npm; then
        NPM_VERSION=$(npm --version)
        print_success "npm installed: $NPM_VERSION"
    else
        print_error "npm not installed"
    fi

    # AWS CLI
    if command_exists aws; then
        AWS_VERSION=$(aws --version 2>&1 | cut -d' ' -f1)
        print_success "AWS CLI installed: $AWS_VERSION"
    else
        print_warning "AWS CLI not installed (needed for backend deployment)"
        print_info "Install: curl https://awscli.amazonaws.com/AWSCLIV2.pkg -o AWSCLIV2.pkg && sudo installer -pkg AWSCLIV2.pkg -target /"
    fi

    # EB CLI
    if command_exists eb; then
        EB_VERSION=$(eb --version 2>&1 | head -1)
        print_success "EB CLI installed: $EB_VERSION"
    else
        print_warning "EB CLI not installed (needed for backend deployment)"
        print_info "Install: pip install awsebcli --upgrade --user"
    fi

    # Check project files
    echo ""
    print_info "Checking project files..."

    if [ -f "$PROJECT_ROOT/package.json" ]; then
        print_success "Extension package.json found"
    else
        print_error "Extension package.json not found"
    fi

    if [ -f "$BACKEND_DIR/package.json" ]; then
        print_success "Backend package.json found"
    else
        print_error "Backend package.json not found"
    fi

    if [ -d "$PROJECT_ROOT/src" ]; then
        print_success "Extension source directory found"
    else
        print_error "Extension source directory not found"
    fi

    if [ -d "$BACKEND_DIR/src" ]; then
        print_success "Backend source directory found"
    else
        print_error "Backend source directory not found"
    fi

    echo ""
    read -p "Press Enter to continue..."
    show_menu
}

# Build extension for production
build_extension_production() {
    print_header "Building Extension for Production"

    cd "$PROJECT_ROOT"

    # Check for .env.production
    if [ ! -f ".env.production" ]; then
        print_warning ".env.production file not found"
        print_info "Creating template .env.production file..."

        cat > .env.production << 'EOF'
# Production Environment Configuration
# Update these values before building

VITE_BACKEND_WS_URL=wss://your-backend-url.elasticbeanstalk.com
VITE_BACKEND_API_KEY=your-backend-api-key-here
VITE_DEEPGRAM_API_KEY=your-deepgram-api-key-here
EOF

        print_info "Please edit .env.production with your production values"
        print_info "File location: $PROJECT_ROOT/.env.production"
        read -p "Press Enter after updating .env.production..."
    fi

    print_info "Installing dependencies..."
    npm install

    print_info "Building extension..."
    NODE_ENV=production npm run build

    if [ -d "$DIST_DIR" ]; then
        print_success "Extension built successfully!"
        print_info "Build output: $DIST_DIR"

        # Show bundle size
        BUNDLE_SIZE=$(du -sh "$DIST_DIR" | cut -f1)
        print_info "Bundle size: $BUNDLE_SIZE"

        # Verify manifest.json
        if [ -f "$DIST_DIR/manifest.json" ]; then
            print_success "manifest.json present"
            MANIFEST_VERSION=$(grep -o '"version": "[^"]*"' "$DIST_DIR/manifest.json" | cut -d'"' -f4)
            print_info "Extension version: $MANIFEST_VERSION"
        else
            print_error "manifest.json not found in dist/"
        fi
    else
        print_error "Build failed - dist directory not created"
    fi

    echo ""
    read -p "Press Enter to continue..."
    show_menu
}

# Create Chrome Web Store package
create_chrome_package() {
    print_header "Creating Chrome Web Store Package"

    if [ ! -d "$DIST_DIR" ]; then
        print_error "dist/ folder not found. Run 'Build Extension for Production' first."
        read -p "Press Enter to continue..."
        show_menu
        return
    fi

    cd "$PROJECT_ROOT"

    # Get version from manifest
    VERSION=$(grep -o '"version": "[^"]*"' "$DIST_DIR/manifest.json" | cut -d'"' -f4)
    ZIP_NAME="devassist-call-coach-v${VERSION}.zip"

    print_info "Creating zip package: $ZIP_NAME"

    # Remove old zip if exists
    [ -f "$ZIP_NAME" ] && rm "$ZIP_NAME"

    # Create zip
    cd dist/
    zip -r "../$ZIP_NAME" .
    cd ..

    if [ -f "$ZIP_NAME" ]; then
        ZIP_SIZE=$(ls -lh "$ZIP_NAME" | awk '{print $5}')
        print_success "Package created successfully!"
        print_info "File: $PROJECT_ROOT/$ZIP_NAME"
        print_info "Size: $ZIP_SIZE"

        # Security check - ensure no .env files
        print_info "Performing security check..."
        if unzip -l "$ZIP_NAME" | grep -q ".env"; then
            print_error "WARNING: .env file found in package! Do not upload to Chrome Web Store!"
        else
            print_success "Security check passed - no .env files in package"
        fi

        # Show contents
        echo ""
        print_info "Package contents:"
        unzip -l "$ZIP_NAME" | head -20
    else
        print_error "Failed to create zip package"
    fi

    echo ""
    read -p "Press Enter to continue..."
    show_menu
}

# Build backend for production
build_backend_production() {
    print_header "Building Backend for Production"

    cd "$BACKEND_DIR"

    print_info "Installing dependencies..."
    npm install

    print_info "Running tests..."
    npm test

    if [ $? -eq 0 ]; then
        print_success "All tests passed"
    else
        print_error "Tests failed - fix errors before deploying"
        read -p "Press Enter to continue..."
        show_menu
        return
    fi

    print_info "Building TypeScript..."
    npm run build

    if [ -d "$BACKEND_DIR/dist" ]; then
        print_success "Backend built successfully!"
        print_info "Build output: $BACKEND_DIR/dist"

        # Show build size
        BUILD_SIZE=$(du -sh "$BACKEND_DIR/dist" | cut -f1)
        print_info "Build size: $BUILD_SIZE"
    else
        print_error "Build failed - dist directory not created"
    fi

    echo ""
    read -p "Press Enter to continue..."
    show_menu
}

# Test production extension locally
test_production_extension() {
    print_header "Test Production Extension Locally"

    if [ ! -d "$DIST_DIR" ]; then
        print_error "dist/ folder not found. Run 'Build Extension for Production' first."
        read -p "Press Enter to continue..."
        show_menu
        return
    fi

    print_info "To test the production extension:"
    echo ""
    echo "1. Open Chrome and navigate to:"
    echo "   chrome://extensions"
    echo ""
    echo "2. Enable 'Developer mode' (top-right toggle)"
    echo ""
    echo "3. Click 'Load unpacked'"
    echo ""
    echo "4. Select the dist folder:"
    echo "   $DIST_DIR"
    echo ""
    echo "5. Test the extension:"
    echo "   - Open extension side panel"
    echo "   - Verify connection to production backend"
    echo "   - Start a test call"
    echo "   - Click 'Start AI Coaching'"
    echo "   - Wait 3 minutes for warmup"
    echo "   - Verify AI tips appear"
    echo ""

    read -p "Press Enter after testing to continue..."
    show_menu
}

# Generate secure API key
generate_api_key() {
    print_header "Generate Secure API Key"

    if command_exists openssl; then
        API_KEY=$(openssl rand -base64 32)
        echo ""
        print_success "Secure API key generated:"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "$API_KEY"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        print_info "Use this key for:"
        echo "  - Backend environment variable: API_KEY"
        echo "  - Extension .env.production: VITE_BACKEND_API_KEY"
        echo ""
        print_warning "Store this key securely - it authenticates extension to backend"
    else
        print_error "openssl not found - cannot generate API key"
    fi

    echo ""
    read -p "Press Enter to continue..."
    show_menu
}

# View deployment checklist
view_checklist() {
    print_header "Deployment Checklist"

    CHECKLIST="$PROJECT_ROOT/PRODUCTION-DEPLOYMENT-CHECKLIST.md"

    if [ -f "$CHECKLIST" ]; then
        print_info "Opening deployment checklist..."
        if command_exists less; then
            less "$CHECKLIST"
        else
            cat "$CHECKLIST" | more
        fi
    else
        print_error "Deployment checklist not found: $CHECKLIST"
    fi

    show_menu
}

# Full production build
full_production_build() {
    print_header "Full Production Build"

    print_info "This will build both extension and backend for production"
    read -p "Continue? (y/n): " confirm

    if [ "$confirm" != "y" ]; then
        show_menu
        return
    fi

    # Build extension
    build_extension_production

    # Build backend
    build_backend_production

    # Create Chrome package
    create_chrome_package

    print_success "Full production build complete!"

    echo ""
    print_info "Next steps:"
    echo "1. Test extension locally"
    echo "2. Deploy backend to AWS Elastic Beanstalk"
    echo "3. Submit extension to Chrome Web Store"
    echo "4. Follow PRODUCTION-DEPLOYMENT-CHECKLIST.md"

    echo ""
    read -p "Press Enter to continue..."
    show_menu
}

# Main execution
main() {
    clear
    show_menu
}

main
