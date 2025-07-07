# Wallet Tagging System Test Guide

This guide explains how to test the new wallet tagging functionality.

## Test Script

The test script `test-wallet-tagging.ts` provides comprehensive testing of all wallet tagging features:

### What it tests:
- ✅ Adding wallets as favorites with tags and collections
- ✅ Retrieving favorite wallets with metadata
- ✅ Updating wallet tags and collections
- ✅ Getting unique tags across all favorites
- ✅ Getting unique collections across all favorites
- ✅ Marking wallets as viewed (lastViewedAt tracking)
- ✅ Managing multiple wallets with different tags

## Setup

1. **Environment Variables**: Create a `.env` file in the root directory with:
   ```
   BACKEND_API_KEY=your-actual-api-key-here
   BACKEND_URL=http://localhost:3001/api/v1
   ```
   
   ⚠️ **Security Note**: Never commit your `.env` file or expose your API key in logs/console output. The test script will show `***CONFIGURED***` instead of your actual key.

2. **Make sure your backend is running**:
   ```bash
   npm run dev
   ```

3. **Run the test**:
   ```bash
   npm run test:wallet-tagging
   ```

## Test Wallet

The test uses the specific wallet address: `DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm`

## Expected Test Flow

1. **Add Wallet**: Adds the test wallet with initial tags and collections
2. **Retrieve**: Gets all favorites to verify addition
3. **Update**: Updates the wallet with new tags and collections
4. **Get Tags**: Retrieves all unique tags across favorites
5. **Get Collections**: Retrieves all unique collections across favorites
6. **Mark Viewed**: Updates the lastViewedAt timestamp
7. **Add Second Wallet**: Adds SOL token address for comparison
8. **Final Verification**: Shows the complete state

## Sample API Calls

### Add Wallet as Favorite
```bash
POST /users/me/favorites
{
  "walletAddress": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
  "nickname": "Test Wallet - Main Trading Account",
  "tags": ["DeFi", "High Volume", "Test Account"],
  "collections": ["Main Portfolio", "Testing Collection"]
}
```

### Update Wallet
```bash
PUT /users/me/favorites/DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm
{
  "nickname": "Updated Test Wallet - Premium Account",
  "tags": ["DeFi", "Premium", "Active Trading", "Research"],
  "collections": ["Main Portfolio", "Premium Accounts", "Research List"]
}
```

### Get All Favorites
```bash
GET /users/me/favorites
```

### Get Unique Tags
```bash
GET /users/me/favorites/tags
```

### Get Unique Collections
```bash
GET /users/me/favorites/collections
```

### Mark as Viewed
```bash
POST /users/me/favorites/DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm/viewed
```

## Troubleshooting

### Common Issues:

1. **401 Unauthorized**: Check that your `BACKEND_API_KEY` is correct
2. **404 Not Found**: Ensure the backend is running on the correct port (3001)
3. **Connection Refused**: Verify the `BACKEND_URL` is correct (should be `http://localhost:3001/api/v1`)

### Manual Testing with curl:

```bash
# Add wallet
curl -X POST http://localhost:3001/api/v1/users/me/favorites \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "walletAddress": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
    "nickname": "Test Wallet",
    "tags": ["DeFi", "Test"],
    "collections": ["Main Portfolio"]
  }'

# Get favorites
curl -X GET http://localhost:3001/api/v1/users/me/favorites \
  -H "X-API-Key: your-api-key"
```

## Success Indicators

When the test runs successfully, you should see:
- All API calls return 200 status codes
- JSON responses with proper data structure
- Tags and collections are stored and retrieved correctly
- lastViewedAt timestamps are updated
- Aggregated tags/collections include all unique values

## Data Structure

The wallet favorite object structure:
```json
{
  "id": "uuid",
  "walletAddress": "string",
  "nickname": "string",
  "tags": ["string", "string"],
  "collections": ["string", "string"],
  "metadata": {},
  "lastViewedAt": "ISO date string",
  "createdAt": "ISO date string",
  "updatedAt": "ISO date string"
}
``` 