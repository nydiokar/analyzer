#!/bin/bash
set -e

echo "This legacy host-build setup script is not the current production path."
echo "Use deployment/README.md and deployment/scripts/deploy.sh instead."
echo "Production images are built in GitHub Actions and pulled by the server."
exit 1

echo "🚀 Production Setup Script"
echo "=========================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check Node.js version
echo "Step 1: Checking Node.js version..."
CURRENT_NODE_VERSION=$(node -v 2>/dev/null || echo "v0.0.0")
if [[ "$CURRENT_NODE_VERSION" < "v24" ]]; then
    echo -e "${RED}✗${NC} Node.js 24+ required (current: $CURRENT_NODE_VERSION)"
    echo "Install Node.js 24 first: https://nodejs.org/"
    exit 1
else
    echo -e "${GREEN}✓${NC} Node.js version OK: $CURRENT_NODE_VERSION"
fi

# Step 2: Check Docker
echo ""
echo "Step 2: Checking Docker..."
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker is installed"
    if docker info &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker daemon is running"
    else
        echo -e "${RED}✗${NC} Docker daemon is not running"
        echo "Start Docker daemon, then run this script again."
        exit 1
    fi
else
    echo -e "${RED}✗${NC} Docker is not installed"
    echo "Install Docker from: https://docs.docker.com/get-docker/"
    exit 1
fi

# Step 3: Check .env file
echo ""
echo "Step 3: Checking .env file..."
if [ ! -f .env ]; then
    echo -e "${RED}✗${NC} .env file not found"
    echo "Create .env file from .env.example and configure it"
    exit 1
else
    echo -e "${GREEN}✓${NC} .env file exists"

    # Check critical env vars
    if ! grep -q "^HELIUS_API_KEY=" .env || grep -q "your_helius_api_key_here" .env; then
        echo -e "${RED}✗${NC} HELIUS_API_KEY not configured in .env"
        exit 1
    fi

    if ! grep -q "^DATABASE_URL=" .env; then
        echo -e "${RED}✗${NC} DATABASE_URL not configured in .env"
        exit 1
    fi

    if ! grep -q "^REDIS_PASSWORD=" .env; then
        echo -e "${YELLOW}⚠${NC} REDIS_PASSWORD not set in .env (using default)"
    fi

    echo -e "${GREEN}✓${NC} Environment variables configured"
fi

# Step 4: Install dependencies
echo ""
echo "Step 4: Installing npm dependencies..."
npm ci --production=false
echo -e "${GREEN}✓${NC} Dependencies installed"

# Step 5: Start Redis with Docker Compose
echo ""
echo "Step 5: Starting Redis..."
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

# Step 6: Run Prisma migrations (production mode)
echo ""
echo "Step 6: Running database migrations..."
npx prisma migrate deploy
echo -e "${GREEN}✓${NC} Database migrations applied"

# Step 7: Generate Prisma client
echo ""
echo "Step 7: Generating Prisma client..."
npx prisma generate
echo -e "${GREEN}✓${NC} Prisma client generated"

# Step 8: Build the project
echo ""
echo "Step 8: Building the project..."
npm run build
echo -e "${GREEN}✓${NC} Project built successfully"

# Step 9: Check PM2
echo ""
echo "Step 9: Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}⚠${NC} PM2 not found globally, installing..."
    npm install -g pm2
    echo -e "${GREEN}✓${NC} PM2 installed"
else
    echo -e "${GREEN}✓${NC} PM2 is installed"
fi

# All done!
echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✓ Production Setup Complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "To start the application:"
echo "  pm2 start ecosystem.backend.config.js --env production"
echo ""
echo "Useful PM2 commands:"
echo "  pm2 status      # Check process status"
echo "  pm2 logs        # View logs"
echo "  pm2 restart all # Restart all processes"
echo "  pm2 stop all    # Stop all processes"
echo "  pm2 save        # Save PM2 process list"
echo "  pm2 startup     # Setup PM2 to start on boot"
echo ""
echo "Health check:"
echo "  curl http://localhost:3001/api/health"
echo ""
