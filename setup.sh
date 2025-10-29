#!/bin/bash
set -e

echo "🚀 Analyzer Setup Script"
echo "========================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running in WSL
if grep -qi microsoft /proc/version; then
    echo -e "${GREEN}✓${NC} Detected WSL environment"
    IS_WSL=true
else
    IS_WSL=false
fi

# Step 1: Check/Install Node.js 22
echo ""
echo "Step 1: Checking Node.js version..."
CURRENT_NODE_VERSION=$(node -v 2>/dev/null || echo "v0.0.0")
REQUIRED_MAJOR=22

if [[ "$CURRENT_NODE_VERSION" < "v22" ]]; then
    echo -e "${YELLOW}⚠${NC} Current Node.js version: $CURRENT_NODE_VERSION"
    echo -e "${YELLOW}⚠${NC} Node.js 22+ required"
    echo ""
    echo "Installing Node.js 22 via nvm..."

    # Check if nvm is installed
    if [ ! -d "$HOME/.nvm" ]; then
        echo "Installing nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    else
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    # Install Node 22
    nvm install 22
    nvm use 22
    nvm alias default 22

    echo -e "${GREEN}✓${NC} Node.js $(node -v) installed"
else
    echo -e "${GREEN}✓${NC} Node.js version OK: $CURRENT_NODE_VERSION"
fi

# Step 2: Check Docker
echo ""
echo "Step 2: Checking Docker..."
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker is installed"

    # Check if Docker daemon is running
    if docker info &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker daemon is running"
    else
        echo -e "${RED}✗${NC} Docker daemon is not running"
        echo ""
        if [ "$IS_WSL" = true ]; then
            echo "Start Docker Desktop on Windows, then run this script again."
        else
            echo "Start Docker daemon, then run this script again."
        fi
        exit 1
    fi
else
    echo -e "${RED}✗${NC} Docker is not installed"
    echo ""
    if [ "$IS_WSL" = true ]; then
        echo "Install Docker Desktop for Windows from: https://www.docker.com/products/docker-desktop/"
        echo "Make sure to enable WSL2 integration in Docker Desktop settings."
    else
        echo "Install Docker from: https://docs.docker.com/get-docker/"
    fi
    exit 1
fi

# Step 3: Install npm dependencies
echo ""
echo "Step 3: Installing npm dependencies..."
npm install
echo -e "${GREEN}✓${NC} Dependencies installed"

# Step 4: Start Redis with Docker Compose
echo ""
echo "Step 4: Starting Redis..."
docker-compose up -d redis
sleep 3

# Check if Redis is healthy
echo "Checking Redis health..."
for i in {1..10}; do
    if docker-compose exec -T redis redis-cli ping &> /dev/null; then
        echo -e "${GREEN}✓${NC} Redis is running and healthy"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}✗${NC} Redis failed to start"
        exit 1
    fi
    sleep 1
done

# Step 5: Check .env file
echo ""
echo "Step 5: Checking .env file..."
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠${NC} .env file not found"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo -e "${YELLOW}⚠${NC} IMPORTANT: Edit .env and add your API keys:"
    echo "  - HELIUS_API_KEY"
    echo "  - HELIUS_METADATA_API_KEY (optional but recommended)"
    echo ""
    echo "Run this script again after updating .env"
    exit 0
else
    echo -e "${GREEN}✓${NC} .env file exists"

    # Check if critical env vars are set
    source .env
    if [ -z "$HELIUS_API_KEY" ] || [ "$HELIUS_API_KEY" = "your_helius_api_key_here" ]; then
        echo -e "${RED}✗${NC} HELIUS_API_KEY not set in .env"
        echo "Please edit .env and add your Helius API key"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} HELIUS_API_KEY is configured"

    if [ -n "$HELIUS_METADATA_API_KEY" ] && [ "$HELIUS_METADATA_API_KEY" != "your_helius_metadata_api_key_here" ]; then
        echo -e "${GREEN}✓${NC} HELIUS_METADATA_API_KEY is configured (separate account)"
    else
        echo -e "${YELLOW}⚠${NC} HELIUS_METADATA_API_KEY not set (will use main key)"
    fi
fi

# Step 6: Run Prisma migrations
echo ""
echo "Step 6: Running database migrations..."
npx prisma migrate dev --name add_onchain_metadata_fields
echo -e "${GREEN}✓${NC} Database migrated"

# Step 7: Generate Prisma client
echo ""
echo "Step 7: Generating Prisma client..."
npx prisma generate
echo -e "${GREEN}✓${NC} Prisma client generated"

# All done!
echo ""
echo -e "${GREEN}========================${NC}"
echo -e "${GREEN}✓ Setup Complete!${NC}"
echo -e "${GREEN}========================${NC}"
echo ""
echo "Next steps:"
echo "  1. Start the backend: npm run dev"
echo "  2. Test enrichment: curl -X POST http://localhost:3000/api/token-info \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -H 'x-api-key: YOUR_API_KEY' \\"
echo "       -d '{\"tokenAddresses\": [\"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263\"]}'"
echo ""
echo "Useful commands:"
echo "  - View logs: npm run dev"
echo "  - View database: npx prisma studio"
echo "  - Stop Redis: docker-compose down"
echo "  - Restart Redis: docker-compose restart redis"
echo ""
