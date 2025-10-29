#!/bin/bash

# Simple test script for onchain metadata enrichment
# Run this after starting the backend with: npm run dev

echo "🧪 Testing Onchain Metadata Enrichment"
echo "======================================"
echo ""

# Check if backend is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "❌ Backend is not running on localhost:3000"
    echo "   Start it with: npm run dev"
    exit 1
fi

echo "✅ Backend is running"
echo ""

# Get API key from .env
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Use API key from env or default
API_KEY_TO_USE=${API_KEY:-"demo-key-123"}

echo "Testing with Bonk token (DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263)"
echo ""

# Make the request
RESPONSE=$(curl -s -X POST http://localhost:3000/api/token-info \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_TO_USE" \
  -d '{
    "tokenAddresses": ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"]
  }')

echo "Response received!"
echo ""
echo "Check your backend logs for:"
echo "  ✅ 'Enriching 1 tokens with 3-stage enrichment (onchain-first)'"
echo "  ✅ 'Stage 1: Saved basic metadata for 1 tokens'"
echo "  ✅ 'Stage 2: DexScreener enrichment completed'"
echo "  ✅ 'Stage 3: Social links fetched for 1 tokens'"
echo ""
echo "To view the data in the database:"
echo "  npx prisma studio"
echo ""
echo "Look for TokenInfo table, find token address:"
echo "  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
echo ""
echo "Should see:"
echo "  onchainName: Bonk"
echo "  onchainSymbol: Bonk"
echo "  onchainImageUrl: (image URL)"
echo "  metadataSource: hybrid"
echo ""
