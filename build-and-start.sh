#!/bin/bash
# Build and Start Script
# Builds both backend and frontend, then starts them in separate tmux sessions

# Note: We handle errors explicitly rather than using set -e
# because we need to handle errors gracefully in some cases

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🚀 Building and starting services...${NC}"
echo ""

# Get the script directory (project root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || { echo -e "${RED}❌ Failed to change to script directory${NC}"; exit 1; }

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed or not in PATH${NC}"
    exit 1
fi

# Check if node is available
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ node is not installed or not in PATH${NC}"
    exit 1
fi

# Check if dashboard directory exists
if [ ! -d "dashboard" ]; then
    echo -e "${RED}❌ dashboard directory not found${NC}"
    exit 1
fi

# Step 1: Build Backend
echo -e "${YELLOW}📦 Building backend...${NC}"
if ! npm run build; then
    echo -e "${RED}❌ Backend build failed!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Backend built successfully${NC}"
echo ""

# Step 2: Build Frontend
echo -e "${YELLOW}📦 Building frontend...${NC}"
cd dashboard || { echo -e "${RED}❌ Failed to change to dashboard directory${NC}"; exit 1; }

# Build with unbuffered output so we can see what's happening
if ! npm run build 2>&1 | tee /tmp/frontend-build.log; then
    echo -e "${RED}❌ Frontend build failed!${NC}"
    echo -e "${YELLOW}Check /tmp/frontend-build.log for details${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Frontend built successfully${NC}"
echo ""

# Return to root
cd "$SCRIPT_DIR" || { echo -e "${RED}❌ Failed to return to root directory${NC}"; exit 1; }

# Step 3: Start Backend in tmux session
echo -e "${YELLOW}🔧 Starting backend with PM2...${NC}"
if command -v pm2 &> /dev/null; then
    # Stop existing PM2 processes for this app if running
    pm2 stop sova-backend-api 2>/dev/null || true
    pm2 delete sova-backend-api 2>/dev/null || true
fi

if command -v tmux &> /dev/null; then
    # Kill existing session if it exists
    tmux kill-session -t analyzer-backend 2>/dev/null || true
    # Create new tmux session for backend
    # Use single quotes inside tmux to prevent variable expansion issues
    tmux new-session -d -s analyzer-backend -c "$SCRIPT_DIR" \
        'echo "🚀 Starting Backend API..."; \
         npm run pm2:start:backend || { echo "❌ Backend failed to start"; exec bash; }; \
         echo ""; \
         echo "📊 Backend started. Use \`pm2 logs\` to view logs."; \
         pm2 logs; \
         exec bash'
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Backend started in tmux session 'analyzer-backend'${NC}"
        echo -e "   View with: ${CYAN}tmux attach -t analyzer-backend${NC}"
    else
        echo -e "${RED}❌ Failed to create tmux session for backend${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  tmux not installed. Starting backend in background...${NC}"
    BACKEND_PID=$(cd "$SCRIPT_DIR" && nohup npm run pm2:start:backend > /tmp/backend.log 2>&1 & echo $!)
    echo -e "${GREEN}✅ Backend started in background (PID: $BACKEND_PID, logs in /tmp/backend.log)${NC}"
    echo "$BACKEND_PID" > /tmp/backend.pid
fi
echo ""

# Step 4: Start Frontend in tmux session
echo -e "${YELLOW}🎨 Starting frontend...${NC}"
FRONTEND_DIR="$SCRIPT_DIR/dashboard"
if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}❌ Frontend directory not found: $FRONTEND_DIR${NC}"
    exit 1
fi

if command -v tmux &> /dev/null; then
    # Kill existing session if it exists
    tmux kill-session -t analyzer-frontend 2>/dev/null || true
    # Create new tmux session for frontend
    # Use single quotes inside tmux to prevent variable expansion issues
    tmux new-session -d -s analyzer-frontend -c "$FRONTEND_DIR" \
        'echo "🚀 Starting Frontend (Next.js)..."; \
         npm run dev; \
         exec bash'
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Frontend started in tmux session 'analyzer-frontend'${NC}"
        echo -e "   View with: ${CYAN}tmux attach -t analyzer-frontend${NC}"
    else
        echo -e "${RED}❌ Failed to create tmux session for frontend${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  tmux not installed. Starting frontend in background...${NC}"
    FRONTEND_PID=$(cd "$FRONTEND_DIR" && nohup npm run dev > /tmp/frontend.log 2>&1 & echo $!)
    echo -e "${GREEN}✅ Frontend started in background (PID: $FRONTEND_PID, logs in /tmp/frontend.log)${NC}"
    echo "$FRONTEND_PID" > /tmp/frontend.pid
fi
echo ""

echo -e "${GREEN}✨ All services are starting!${NC}"
echo ""
echo -e "${CYAN}💡 Tips:${NC}"
echo "   - Backend: Check the tmux session or PM2 logs"
echo "   - Frontend: Usually runs on http://localhost:3000"
echo "   - Backend API: Usually runs on http://localhost:3001"
echo ""
if command -v tmux &> /dev/null; then
    echo -e "${YELLOW}📝 To view services:${NC}"
    echo "   - Backend: ${CYAN}tmux attach -t analyzer-backend${NC}"
    echo "   - Frontend: ${CYAN}tmux attach -t analyzer-frontend${NC}"
    echo "   - Or use: ${CYAN}tmux list-sessions${NC} to see all"
    echo ""
    echo -e "${YELLOW}📝 To stop services:${NC}"
    echo "   - Backend: ${CYAN}pm2 stop all${NC} (from backend tmux or terminal)"
    echo "   - Frontend: Press Ctrl+C in frontend tmux session"
else
    echo -e "${YELLOW}📝 To view logs:${NC}"
    echo "   - Backend: ${CYAN}tail -f /tmp/backend.log${NC}"
    echo "   - Frontend: ${CYAN}tail -f /tmp/frontend.log${NC}"
    echo ""
    echo -e "${YELLOW}📝 To stop services:${NC}"
    echo "   - Backend: ${CYAN}pm2 stop all${NC}"
    echo "   - Frontend: ${CYAN}pkill -f 'next dev'${NC}"
fi
echo ""

