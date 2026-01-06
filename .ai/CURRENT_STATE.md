how to run token affinity 



# Step 1: Create initial session with wallets from Coin A's significant holders 

npx ts-node -r tsconfig-paths/register src/scripts/tokenAffinityAnalysis.ts --walletsFile coinA_holders.csv --tokens "CoinA" --topResults 100

# This creates a session like: affinity_1704567890123_abc123

Session file saved to: analysis_sessions token_affinity_affinity_1704567890123_abc123.json 

# Step 2: Continue with the same wallet pool, analyze against different token sets

npx ts-node -r tsconfig-paths/register src/scripts/tokenAffinityAnalysis.ts --sessionId affinity_1704567890123_abc123 --tokens "CoinB,CoinC,CoinD,CoinE,CoinF" --continue

# Step 3: Analyze another batch

npx ts-node -r tsconfig-paths/register src/scripts/tokenAffinityAnalysis.ts --sessionId affinity_1704567890123_abc123 --tokens "CoinG,CoinH,CoinI,CoinJ" --continue

## From Command Line

# Direct wallet addresses

npx ts-node -r tsconfig-paths/register src/scripts/tokenAffinityAnalysis.ts --wallets "wallet1,wallet2,wallet3" --tokensFile shilled_tokens.txt --topResults 50

Output Example

=== Analysis Complete ===

Session ID: affinity_1704567890123_abc123
Target tokens: 5
Wallets analyzed: 1000
Processing time: 12.34s
Session file: analysis_sessions/token_affinity_affinity_1704567890123_abc123.json

Top 10 matching wallets:

 1. abc12345... - 5/5 tokens (100.0%)  Matches: TokenA..., TokenB..., TokenC..., TokenD..., TokenE...
 2. def67890... - 4/5 tokens (80.0%)   Matches: TokenA..., TokenC..., TokenD..., TokenE...
 3. ghi54321... - 4/5 tokens (80.0%)   Matches: TokenB..., TokenC..., TokenD..., TokenE......