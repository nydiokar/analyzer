# PFT Oracle Bot — Scaffolding Prompt for LLM Coder

You are building a PFT Oracle Bot — a Solana wallet intelligence agent that runs on the Post Fiat (PFTL) network. Users send commands with PFT token payment, the bot calls the analyzer API, transforms JSON into formatted text, and replies on-chain.

Read the plan at `.ai/context/pft-oracle/PLAN_pft-oracle-bot.md` before starting.

---

## CONTEXT: What already exists

### The Analyzer API (DO NOT MODIFY)

A NestJS backend running at `http://localhost:3001/api/v1` with full auth, job queue, WebSocket, and 96+ endpoints. The bot consumes this API as a client using an API key (`x-api-key` header). The API is already running and unchanged.

### The PFT Chatbot MCP (`@postfiatorg/pft-chatbot-mcp`)

An MCP server (npm package) that handles all PFTL chain I/O: encrypted messaging, IPFS uploads, wallet management, bot registration. It runs as a **stdio subprocess** — you spawn it and call its tools programmatically via the `@modelcontextprotocol/sdk` Client class. No LLM is involved at runtime.

PFT MCP tools you'll use:
- `scan_messages({ direction: "inbound", since_ledger?, limit? })` → returns messages array + next_cursor
- `get_message({ tx_hash })` → returns decrypted message with sender, amount_pft, content
- `send_message({ recipient, message, content_type?, attachments?, reply_to_tx?, thread_id? })` → sends encrypted reply
- `upload_content({ content, content_type, encoding? })` → uploads to IPFS, returns { cid, uri }
- `register_bot({ name, description, capabilities, commands?, icon_emoji? })` → registers in agent directory
- `check_balance()` → returns wallet balances

---

## WHAT TO BUILD

Create `pft-bot/` directory inside the analyzer repo root with its own package.json and tsconfig.json. This is a standalone Node.js process, NOT a NestJS module.

### File Structure

```
analyzer/
└── pft-bot_v2/
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── .gitignore
    └── src/
        ├── index.ts              # Entry point
        ├── pft-client.ts         # MCP client wrapper for pft-chatbot-mcp
        ├── scanner.ts            # Scan loop, cursor, dedup, payment validation
        ├── commands.ts           # Command parser + router
        ├── analyzer.ts           # HTTP client for analyzer API
        ├── deferred-jobs.ts      # Poll pending background jobs, send follow-ups
        ├── config.ts             # Environment variables + constants
        └── formatters/
            ├── holders.ts        # Token holder table
            ├── profile.ts        # Wallet profile card
            ├── analysis.ts       # Full analysis result
            └── comparison.ts     # Similarity result
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "@types/node": "^20.0.0"
  }
}
```

Note: `@postfiatorg/pft-chatbot-mcp` is NOT a dependency — it's spawned as a subprocess via npx. The MCP SDK client handles communication.

---

## FILE-BY-FILE IMPLEMENTATION GUIDE

### 1. `src/config.ts` — Environment & Constants

Load from `.env`:

```
BOT_SEED=sEdXXXX                          # PFTL wallet seed
ANALYZER_API_URL=http://localhost:3001/api/v1
ANALYZER_API_KEY=wal_XXXXXXXXXX
SCAN_INTERVAL_MS=5000
MIN_PAYMENT_PFT=100                        # Floor for any interaction
JOB_POLL_INTERVAL_MS=15000
JOB_TIMEOUT_MS=600000
CURSOR_FILE=./data/cursor.json
PENDING_JOBS_FILE=./data/pending-jobs.json
```

Command pricing constants (in whole PFT):
```typescript
export const COMMAND_PRICES: Record<string, number> = {
  '/holders': 1000,
  '/profile': 500,
  '/analyze': 3000,
  '/compare': 3000,
};
```

Also export a help text string used when user sends unrecognized command.

---

### 2. `src/pft-client.ts` — PFT MCP Client Wrapper

Spawn `@postfiatorg/pft-chatbot-mcp` as a stdio subprocess and wrap its tools in typed methods.

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
```

**How to spawn:**
```typescript
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['@postfiatorg/pft-chatbot-mcp'],
  env: {
    ...process.env,
    BOT_SEED: config.BOT_SEED,
  },
});
const client = new Client({ name: 'pft-oracle-bot', version: '1.0.0' }, {});
await client.connect(transport);
```

**Typed wrapper methods:**
```typescript
class PFTClient {
  async scanMessages(sinceLedger?: number, limit?: number): Promise<ScanResult>
  async getMessage(txHash: string): Promise<DecryptedMessage>
  async sendMessage(recipient: string, message: string, opts?: { reply_to_tx?: string; thread_id?: string; attachments?: Attachment[] }): Promise<SendResult>
  async uploadContent(content: string, contentType: string, encoding?: string): Promise<UploadResult>
  async registerBot(registration: BotRegistration): Promise<void>
  async checkBalance(): Promise<BalanceInfo>
}
```

Each method calls `this.client.callTool({ name: toolName, arguments: args })` and parses the text content from the result.

**Important**: MCP tool results come back as `{ content: [{ type: "text", text: "..." }] }`. Parse `JSON.parse(result.content[0].text)` to get the actual data.

**Types to define:**
```typescript
interface ScanMessage {
  tx_hash: string;
  sender: string;
  recipient: string;
  direction: 'inbound' | 'outbound';
  amount_drops: string;
  amount_pft: string;
  cid: string;
  thread_id?: string;
  is_encrypted: boolean;
  ledger_index: number;
  timestamp_iso: string;
}

interface ScanResult {
  messages: ScanMessage[];
  count: number;
  next_cursor: number;
}

interface DecryptedMessage {
  tx_hash: string;
  cid: string;
  sender: string;
  recipient: string;
  message: string;
  content_type: string;
  amount_drops: string;
  thread_id?: string;
  timestamp: string;
}
```

---

### 3. `src/scanner.ts` — Scan Loop

The core runtime loop. Runs forever, polls for new messages.

**Responsibilities:**
- Poll `scanMessages()` every `SCAN_INTERVAL_MS`
- Track cursor (highest ledger_index + 1) for dedup
- Persist cursor to file for crash recovery
- Keep a Set of last 1000 processed tx_hashes as secondary dedup
- For each new inbound message:
  1. Call `getMessage(tx_hash)` to decrypt
  2. Parse the `amount_pft` field (string → number, compare to command price)
  3. Route to command handler
  4. Send reply via `sendMessage()`
- Handle errors gracefully — log and continue, don't crash the loop

**Cursor persistence:**
```typescript
// Save after each batch
function saveCursor(cursor: number): void {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, updatedAt: Date.now() }));
}

function loadCursor(): number | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf-8'));
    return data.cursor;
  } catch { return undefined; }
}
```

**Payment validation:**
- Parse the command from the decrypted message text
- Look up required price from `COMMAND_PRICES`
- If `amount_pft < COMMAND_PRICES[command]`: reply with pricing info and available commands
- If `amount_pft < MIN_PAYMENT_PFT`: ignore silently (dust/spam)

**Error reply on invalid command:**
```
Unknown command. Available commands:

/holders <mint>    — Top holders with behavioral profiles (1000 PFT)
/profile <address> — Quick wallet profile (500 PFT)
/analyze <address> — Deep analysis, 2-15 min (3000 PFT)
/compare <a1> <a2> — Compare wallets (3000 PFT)

Incorrect commands with PFT attached will be noted. Use a valid command to get results.
```

---

### 4. `src/commands.ts` — Command Parser & Router

Parse the decrypted message text into a command + arguments.

```typescript
interface ParsedCommand {
  command: string;          // '/holders', '/profile', '/analyze', '/compare', 'unknown'
  args: string[];           // Addresses/mints extracted
  raw: string;              // Original message
}

function parseCommand(message: string): ParsedCommand
```

**Parsing rules:**
- Trim whitespace, lowercase the command portion
- `/holders <mint>` — extract one Solana address (base58, 32-44 chars)
- `/profile <address>` — extract one Solana address
- `/analyze <address>` — extract one Solana address, optional scope: `flash`, `working`, `deep`
- `/compare <addr1> <addr2> [addr3...]` — extract 2-30 Solana addresses
- Anything else → `unknown`

**Solana address validation:**
- Base58 character set: `[1-9A-HJ-NP-Za-km-z]`
- Length: 32-44 characters
- Simple regex: `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/`

**Route to handlers:**
```typescript
async function handleCommand(parsed: ParsedCommand, sender: string, txHash: string, threadId?: string): Promise<string | { text: string; attachment?: { content: string; contentType: string; filename: string } }>
```

Each handler returns either a plain string (sent as message) or an object with text + attachment (for large results uploaded to IPFS).

---

### 5. `src/analyzer.ts` — Analyzer API Client

HTTP client wrapping the analyzer REST API. All calls use `x-api-key` header.

```typescript
import axios, { AxiosInstance } from 'axios';

class AnalyzerClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { 'x-api-key': apiKey },
      timeout: 30000,
    });
  }
```

**Methods to implement:**

#### `getTopHolders(mint: string): Promise<TopHoldersResponse>`
```
GET /token-info/{mint}/top-holders
```
Returns:
```typescript
{
  mint: string;
  holders: Array<{
    tokenAccount: string;
    ownerAccount?: string;        // The actual wallet address
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
    rank: number;
    knownType?: string;           // BURN | LP | RAYDIUM | ORCA | JUPITER | PROTOCOL | EXCHANGE | SYSTEM
    knownLabel?: string;          // "🔥 Burn Address", "LIQ POOL 💧", "🔒 Lock Vault", etc.
  }>;
  supply?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}
```
Note: `ownerAccount` may be undefined if owner resolution failed. `knownType`/`knownLabel` are present for known system wallets (LP pools, burn addresses, lock vaults, exchanges). Filter these out when looking for real trader wallets.

#### `getHudBatch(addresses: string[]): Promise<BatchHudResponse>`
```
POST /wallets/hud/batch
Body: { walletAddresses: string[] }   // max 200
```
Returns:
```typescript
{
  huds: Record<string, WalletHud>;   // Keyed by wallet address
  notFound: string[];                 // Wallets with no analysis data
  calculatedAt: string;
}
```
Where `WalletHud`:
```typescript
{
  walletAddress: string;
  trimmedMeanPnl: number;            // Realized PNL in SOL, outlier-adjusted
  medianPnlPerToken: number;         // Median PNL per token in SOL
  behaviorCategory?: string;         // "MOMENTUM_TRADER", "DAY_TRADER", "SCALPER", etc.
  behaviorCode: string;              // Single letter: S(niper)/R(scalper)/M(omentum)/I(ntraday)/D(ay)/W(swing)/P(osition)/H(older)/F(lipper)/A(ccumulator)/T(rader)/B(alanced)/L(ow activity)/?(unknown)
  medianHoldTimeHours?: number;
  avgTradesPerDay: number;
  winRate: number;                   // 0-1 decimal (0.68 = 68%)
  isBot: boolean;                    // true if >60 unique tokens/day
  isWhale: boolean;                  // true if portfolio >200 SOL or >$20k USD
  uniqueTokensPerDay: number;
  currentHoldingsSol: number;
  currentHoldingsUsd?: number;
  dataQualityTier: string;           // GOLD | SILVER | BRONZE | INSUFFICIENT
  calculatedAt: string;
}
```

#### `getWalletHud(address: string): Promise<WalletHud | null>`
```
GET /wallets/{address}/hud
```
Returns same `WalletHud` shape. Returns null on 404 (wallet not analyzed).

#### `getWalletSummary(address: string): Promise<WalletSummary>`
```
GET /wallets/{address}/summary
```
Returns:
```typescript
{
  status: 'ok' | 'unanalyzed' | 'restricted';
  walletAddress: string;
  knownType?: string | null;
  knownLabel?: string | null;
  lastAnalyzedAt?: string | null;
  lastActiveTimestamp?: number | null;
  daysActive?: number | string;
  latestPnl?: number | null;           // Realized PNL in SOL
  latestPnlUsd?: number | null;
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;
  netPnl?: number | null;
  tokenWinRate?: number | null;        // 0-100 (percentage, NOT decimal)
  behaviorClassification?: string | null;
  classification?: string | null;      // normal | high_frequency | unknown
  currentSolBalance?: number | null;
  currentSolBalanceUsd?: number | null;
  profitableTradesCount?: number | null;
  totalTradesCount?: number | null;
}
```
Important: `tokenWinRate` here is 0-100 (percentage), while HUD `winRate` is 0-1 (decimal). Normalize when formatting.

#### `getPnlOverview(address: string): Promise<PnlOverview>`
```
GET /wallets/{address}/pnl-overview
```
Returns:
```typescript
{
  allTimeData: {
    realizedPnl: number;
    unrealizedPnl?: number;
    swapWinRate?: number;              // Percentage
    winLossCount?: string;             // "X/Y trades" or "X/Y tokens"
    avgPLTrade?: number;
    totalVolume?: number;
    totalSolSpent: number;
    totalSolReceived: number;
    medianPLToken?: number;
    trimmedMeanPnlPerToken?: number;
    tokenWinRate?: number;
    profitableTokensCount?: number;
    unprofitableTokensCount?: number;
  };
  periodData: { /* same shape */ } | null;
}
```

#### `getBehaviorAnalysis(address: string): Promise<BehaviorAnalysis>`
```
GET /wallets/{address}/behavior-analysis
```
Returns a large object. Key fields for formatting:
```typescript
{
  tradingStyle: string;                // Human-readable classification
  speedCategory?: string;             // ULTRA_FLIPPER | FLIPPER | FAST_TRADER | DAY_TRADER | SWING_TRADER | POSITION_TRADER
  strategyType?: string;
  uniqueTokensTraded: number;
  totalTradeCount: number;
  totalBuyCount: number;
  totalSellCount: number;
  medianHoldTime: number;
  winRate is NOT directly on this response — use PNL overview or HUD for win rate

  tradingFrequency: {
    tradesPerDay: number;
    tradesPerWeek: number;
  };

  riskMetrics: {
    averageTransactionValueSol: number;
    largestTransactionValueSol: number;
  };

  // Rich interpretation (newer, may not exist for all wallets)
  tradingInterpretation?: {
    speedCategory: string;
    typicalHoldTimeHours: number;
    economicRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    behavioralPattern: string;
    interpretation: string;            // Human-readable paragraph
  };

  historicalPattern?: {
    behaviorType: string;              // SNIPER | SCALPER | MOMENTUM | INTRADAY | DAY_TRADER | SWING | POSITION | HODLER
    exitPattern: string;               // GRADUAL | ALL AT ONCE
    dataQuality: number;
    medianCompletedHoldTimeHours: number;
  };

  confidenceScore: number;
}
```

#### `queueDashboardAnalysis(address: string, scope?: string): Promise<AnalysisJobResponse>`
```
POST /analyses/wallets/dashboard-analysis
Body: { walletAddress: string, analysisScope?: 'flash' | 'working' | 'deep' }
```
Returns:
```typescript
{
  jobId: string | null;                // null if skipped
  requestId: string;
  status: 'queued' | 'running' | 'skipped';
  analysisScope: string;
  estimatedProcessingTime: string;     // "2 minute(s)", "8 minute(s)"
  skipped?: boolean;
  skipReason?: string;                 // "known-LP", "fresh-within-30m", etc.
  alreadyRunning?: boolean;
}
```
Important edge cases:
- Known system wallets (LP, BURN) are **skipped** — check `skipped` flag
- Recently analyzed wallets may be skipped with `skipReason: "fresh-within-Xm"`
- If already running, returns existing jobId with `alreadyRunning: true`

#### `queueSimilarityAnalysis(addresses: string[]): Promise<SimilarityJobResponse>`
```
POST /analyses/similarity/queue
Body: { walletAddresses: string[] }    // 2-30 addresses
```
Returns:
```typescript
{
  jobId: string;
  requestId: string;
  status: 'queued';
  walletCount: number;
  estimatedProcessingTime: string;
}
```

#### `getJobResult(jobId: string): Promise<JobResult>`
```
GET /jobs/{jobId}/result
```
Returns:
```typescript
{
  jobId: string;
  status: 'completed' | 'failed' | 'active' | 'waiting';
  result?: any;       // Shape depends on job type
  error?: string;     // Only if failed
}
```

#### `getWalletsStatus(addresses: string[]): Promise<WalletStatusResponse>`
```
POST /analyses/wallets/status
Body: { walletAddresses: string[] }
```
Returns:
```typescript
{
  statuses: Array<{
    walletAddress: string;
    status: 'MISSING' | 'STALE' | 'CURRENT';
  }>;
}
```
Useful for checking which wallets have data before calling HUD batch.

#### `getTokenInfo(mints: string[]): Promise<TokenInfo[]>`
```
POST /token-info
Body: { tokenAddresses: string[] }
```
Returns array of token metadata (name, symbol, imageUrl, marketCap, etc.). Fire-and-forget enrichment runs in background — call this to get whatever's in the DB now, and trigger enrichment for unknowns.

---

### 6. `src/formatters/holders.ts` — Token Holder Table

The main product. Takes top-holders + batch HUD data and produces a formatted text table.

**Input:** Top holders response + batch HUD response + optional token info
**Output:** Formatted string

**Formatting logic:**

1. **Header section:**
   - Token name/symbol if available (from token-info), otherwise just the mint (truncated)
   - Total holders analyzed count
   - Supply info if available

2. **Filter holders:**
   - Separate into "real wallets" and "system accounts" based on `knownType`
   - System accounts (BURN, LP, PROTOCOL, EXCHANGE, SYSTEM, RAYDIUM, ORCA, JUPITER): show separately in a summary line
   - Real wallets (no knownType): show in the main table with HUD data

3. **For each real wallet, merge with HUD data:**
   - If wallet is in `huds` map: show all metrics
   - If wallet is in `notFound`: show with "—" for all HUD fields

4. **Table columns:**
   ```
   #   Wallet         Supply   PnL          Style        Hold      Flags
   ```
   - `#`: rank from top-holders
   - `Wallet`: first 4...last 4 chars of ownerAccount
   - `Supply`: `uiAmount` as percentage of total supply, or raw amount if no supply data
   - `PnL`: `trimmedMeanPnl` from HUD, formatted as SOL with K/M suffix
   - `Style`: `behaviorCategory` from HUD, shortened (DAY_TRADER → "Day Trader", MOMENTUM_TRADER → "Momentum", etc.)
   - `Hold`: `medianHoldTimeHours` from HUD, formatted human-readable (17min, 4.2h, 2.1d)
   - `Flags`: 🤖 if isBot, 🐋 if isWhale, ⭐ if winRate > 0.65 and dataQualityTier is GOLD/SILVER

5. **System accounts summary:**
   ```
   System: 🔥 Burn 42.0% | 💧 LP (Raydium) 15.2% | 🔒 Lock 8.3%
   ```

6. **Distribution summary:**
   Count wallets by behaviorCategory:
   ```
   Trader types: Day Trader 3 | Momentum 2 | Holder 2 | Scalper 1
   ```

7. **Data quality note:**
   ```
   * 4 wallets not yet analyzed — use /analyze <address> for full profile
   ```

8. **Keep total output under ~2000 characters** for chat readability. If more than ~12 real wallets, show top 10 and summarize the rest.

**Behavior category display mapping:**
```typescript
const BEHAVIOR_LABELS: Record<string, string> = {
  'SNIPER': 'Sniper',
  'SCALPER': 'Scalper',
  'MOMENTUM': 'Momentum',
  'MOMENTUM_TRADER': 'Momentum',
  'INTRADAY': 'Intraday',
  'DAY_TRADER': 'Day Trader',
  'SWING': 'Swing',
  'SWING_TRADER': 'Swing',
  'POSITION': 'Position',
  'POSITION_TRADER': 'Position',
  'HODLER': 'Holder',
  'PURE_HOLDER': 'Holder',
  'ACCUMULATOR': 'Accumulator',
  'DISTRIBUTOR': 'Distributor',
  'BALANCED_TRADER': 'Balanced',
  'LOW_ACTIVITY': 'Low Activity',
  'FAST_TRADER': 'Fast Trader',
  'ULTRA_FLIPPER': 'Ultra Flipper',
  'FLIPPER': 'Flipper',
};
```

**Hold time formatting:**
```typescript
function formatHoldTime(hours?: number): string {
  if (!hours) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
```

**PNL formatting:**
```typescript
function formatPnl(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M SOL`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}
```

---

### 7. `src/formatters/profile.ts` — Wallet Profile Card

Formats a single wallet's data into a profile card.

**Input:** WalletHud + optionally WalletSummary + optionally BehaviorAnalysis
**Output:** Formatted string

**For a simple `/profile` (HUD only):**
```
WALLET PROFILE: DNfu..eBHm

PnL:       +1.19K SOL (trimmed mean/token)
Median:    +890 SOL (median/token)
Win Rate:  68%
Style:     Day Trader (D)
Hold Time: 22h median
Activity:  12.5 trades/day
Tokens:    12.3/day unique
Holdings:  245.7 SOL ($28.2K)
Flags:     🐋 Whale
Quality:   GOLD

Data: Oct 2025 — Feb 2026

Use /analyze <address> for deep analysis with full breakdown.
```

**If wallet not found (404 from HUD):**
```
WALLET: DNfu..eBHm
Status: Not yet analyzed

This wallet hasn't been analyzed. Send /analyze DNfu..eBHm (3000 PFT) to run a full analysis.
```

---

### 8. `src/formatters/analysis.ts` — Full Analysis Result

Formats the completed dashboard-analysis job result. This is richer — may warrant a markdown attachment for the full report with a short summary in the chat message.

**Short message (chat):**
```
Analysis complete: DNfu..eBHm

PnL: +1.19K SOL | Win Rate: 68% | Style: Day Trader
Volume: 45.2K SOL total | 342 trades | 87 tokens
Risk: Medium (avg 0.8 SOL/trade, max 12.4 SOL)

Full report attached.
```

**Markdown attachment (uploaded to IPFS):**
A comprehensive report including PNL breakdown, behavior analysis, token performance top 10, etc.

---

### 9. `src/formatters/comparison.ts` — Similarity Result

Format the similarity job result showing how wallets compare.

```
SIMILARITY ANALYSIS: 3 wallets

Pair                    Similarity
DNfu..eBHm ↔ AJof..18KN    72%    (High — likely same strategy)
DNfu..eBHm ↔ 9xQe..VFin    23%    (Low — independent)
AJof..18KN ↔ 9xQe..VFin    18%    (Low — independent)

Verdict: DNfu..eBHm and AJof..18KN show similar trading patterns.
         Possible same operator or copy-trading.
```

---

### 10. `src/deferred-jobs.ts` — Background Job Polling

For `/analyze` and `/compare` commands, the API returns a jobId immediately. The bot needs to poll for completion and send follow-up messages.

```typescript
interface PendingJob {
  jobId: string;
  type: 'analysis' | 'similarity';
  sender: string;          // Reply-to address
  txHash: string;          // Original message tx_hash (for threading)
  threadId?: string;
  queuedAt: number;        // Timestamp
  walletAddress?: string;  // For analysis jobs
  addresses?: string[];    // For similarity jobs
}
```

**Responsibilities:**
- Maintain a list of pending jobs (in-memory + persisted to file)
- Poll `getJobResult(jobId)` every `JOB_POLL_INTERVAL_MS` (15s)
- When job completes:
  - Format the result using the appropriate formatter
  - For large results, upload markdown to IPFS as attachment
  - Send follow-up message via `sendMessage()` with `reply_to_tx` for threading
- When job fails: send error message to user
- When job times out (`JOB_TIMEOUT_MS`): send timeout message, remove from pending
- Persist pending jobs to file for crash recovery
- On boot, reload pending jobs and resume polling

---

### 11. `src/index.ts` — Entry Point

```typescript
import { config } from './config';
import { PFTClient } from './pft-client';
import { Scanner } from './scanner';
import { AnalyzerClient } from './analyzer';
import { DeferredJobs } from './deferred-jobs';

async function main() {
  // 1. Init PFT client (spawns MCP subprocess)
  const pft = new PFTClient(config);
  await pft.connect();

  // 2. Register bot (idempotent — updates if already registered)
  await pft.registerBot({
    name: 'Sova Intel',
    description: 'Solana wallet intelligence. Analyze token holders, profile wallets, compare trading behavior.',
    capabilities: ['text-generation'],
    icon_emoji: '🦉',
    commands: [
      { command: '/holders', description: 'Top holders with behavioral profiles', example: '/holders <token_mint>', min_cost_drops: '1000000000' },
      { command: '/profile', description: 'Quick wallet behavioral profile', example: '/profile <wallet_address>', min_cost_drops: '500000000' },
      { command: '/analyze', description: 'Deep analysis (2-15 min)', example: '/analyze <wallet_address>', min_cost_drops: '3000000000' },
      { command: '/compare', description: 'Compare wallet behavior', example: '/compare <addr1> <addr2>', min_cost_drops: '3000000000' },
    ],
  });

  // 3. Init analyzer client
  const analyzer = new AnalyzerClient(config.ANALYZER_API_URL, config.ANALYZER_API_KEY);

  // 4. Init deferred jobs (loads pending from file)
  const deferred = new DeferredJobs(pft, analyzer, config);
  await deferred.loadPending();

  // 5. Start scan loop
  const scanner = new Scanner(pft, analyzer, deferred, config);
  await scanner.start();

  console.log('Sova Intel bot running. Scanning for messages...');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## EDGE CASES TO HANDLE

### Payment & Commands
- **Underpayment**: User sends less PFT than command price → reply with pricing info
- **Dust** (<100 PFT, below MIN_PAYMENT_PFT): Ignore silently
- **Unknown command**: Reply with help text listing available commands
- **Invalid address**: Reply with "Invalid Solana address. Addresses are 32-44 base58 characters."
- **No address provided**: Reply with command usage example

### API Responses
- **Wallet not analyzed** (HUD 404, summary `status: 'unanalyzed'`): Show what you have, suggest /analyze
- **Known system wallet** (knownType present in top-holders): Skip from main table, show in system summary
- **Analysis skipped** (dashboard-analysis returns `skipped: true`): Tell user why — "This is a known LP address" or "Fresh analysis exists from 10 minutes ago, showing cached results"
- **Analysis already running** (`alreadyRunning: true`): Tell user, add to deferred jobs to poll existing jobId
- **Job failed**: Send error message, suggest retry
- **Job timeout** (>10 min): Send timeout message, suggest retry with flash scope
- **Rate limit** (429 from analyzer): Queue/retry with backoff, don't expose to user

### PFT Chain
- **MCP subprocess crash**: Log error, attempt reconnect. If 3 failures in a row, exit process (let pm2 restart)
- **Duplicate messages**: Cursor + tx_hash Set prevents double-processing
- **Bot out of PFT**: Log warning. Bot only sends minimum drops per reply (1 drop = 0.000001 PFT), so this is unlikely unless replying thousands of times without receiving payment

---

## TESTING APPROACH

### Phase 1: Test without PFT chain
Before wiring up the PFT client, test the core logic:

1. **Formatters**: Write quick scripts that call the analyzer API directly and pipe results through formatters. Verify output looks good.
   ```typescript
   // test-formatters.ts
   const analyzer = new AnalyzerClient(url, key);
   const holders = await analyzer.getTopHolders('known-mint-from-db');
   const ownerAddrs = holders.holders.filter(h => !h.knownType).map(h => h.ownerAccount).filter(Boolean);
   const huds = await analyzer.getHudBatch(ownerAddrs);
   console.log(formatHolderTable(holders, huds));
   ```

2. **Command parser**: Unit test with various inputs.

### Phase 2: Test with PFT chain
1. Register bot on PFTL testnet
2. Send test messages from another wallet
3. Verify scan → parse → API call → format → reply flow

### Finding test data
Wallets that are already analyzed in your database:
```sql
SELECT "walletAddress", "pnlTotalUsd", "winRate"
FROM "WalletSummary"
ORDER BY "updatedAt" DESC LIMIT 5;
```

Token mints with holder data:
```sql
SELECT DISTINCT "tokenAddress" FROM "AnalysisResult" LIMIT 5;
```

---

## WHAT NOT TO DO

- Do NOT modify any analyzer backend code (no new endpoints, no new guards, no schema changes)
- Do NOT add an LLM dependency — all formatting is pure functions
- Do NOT import anything from ai-chat or add submodules
- Do NOT build a web UI or dashboard
- Do NOT add WebSocket client for job progress — use HTTP polling (simpler, good enough)
- Do NOT over-engineer the formatters — start simple, iterate based on real output
- Do NOT handle conversation state or multi-turn memory — each command is independent
- Do NOT create a separate MCP server wrapping the analyzer API — the bot calls HTTP directly
