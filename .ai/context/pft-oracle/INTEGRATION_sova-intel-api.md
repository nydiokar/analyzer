# Sova Intel — API Integration Reference

**Purpose**: Personal reference. Maps the four PFT Oracle Bot commands to Sova Intel (analyzer) API endpoints, documents the JSON schemas the formatters consume, specifies the transformation logic for on-chain replies, and covers error handling cases.

Source of truth: `PLAN_pft-oracle-bot.md` + `PROMPT_scaffold-pft-bot.md`

---

## Data Flow

```
User on PFTL chain
    │
    │  Sends PFT + command text (encrypted, IPFS)
    ▼
pft-chatbot-mcp (stdio subprocess)
    │  scan_messages() → new inbound tx
    │  get_message(tx_hash) → decrypted { sender, amount_pft, message }
    ▼
scanner.ts
    │  Validate payment (amount_pft >= command price)
    │  Parse command + args
    ▼
commands.ts → handler
    │
    ├─ /holders  → analyzer.getTopHolders(mint)
    │              analyzer.getHudBatch(addresses)
    │              formatHolderTable() → string (partial, — for notFound)
    │              for each notFound wallet:
    │                queueDashboardAnalysis(addr, 'flash') → jobId
    │                store PendingJob { jobId, sender, txHash, type: 'auto-profile' }
    │              [deferred-jobs.ts delivers each profile as follow-up, no extra charge]
    │
    ├─ /profile  → analyzer.getWalletHud(address)
    │              if HUD found: formatWalletProfile() → string
    │              if 404:
    │                queueDashboardAnalysis(address, 'working') → jobId
    │                store PendingJob { jobId, sender, txHash, type: 'auto-profile' }
    │                reply ACK: "Queuing analysis now — results incoming, no extra charge"
    │              [deferred-jobs.ts delivers profile as follow-up]
    │
    ├─ /analyze  → analyzer.queueDashboardAnalysis(address, scope)
    │              store PendingJob { jobId, sender, txHash }
    │              reply immediately with ACK string
    │              [deferred-jobs.ts polls every 15s]
    │              getJobResult(jobId) → completed
    │              formatAnalysisResult() → markdown attachment + short string
    │
    └─ /compare  → analyzer.queueSimilarityAnalysis(addresses[])
                   store PendingJob { jobId, sender, txHash }
                   reply immediately with ACK string
                   [deferred-jobs.ts polls every 15s]
                   getJobResult(jobId) → completed
                   formatComparison() → string
    │
    ▼
pft-chatbot-mcp
    │  send_message({ recipient, message, reply_to_tx, attachments? })
    ▼
User receives on-chain reply
```

---

## Command Pricing

| Command    | Min PFT | Drops             |
|------------|---------|-------------------|
| `/holders` | 1000    | `1000000000`      |
| `/profile` | 50    | `500000000`       |
| `/analyze` | 200    | `3000000000`      |
| `/compare` | 1000    | `3000000000`      |
| Floor      | 10     | Dust — ignore     |

---

## 1. `/holders <mint>`

### API Calls

#### Step 1 — Top Holders
```
GET /token-info/{mint}/top-holders
Header: x-api-key: <ANALYZER_API_KEY>
```

**Response schema:**
```typescript
{
  mint: string;
  holders: Array<{
    tokenAccount: string;
    ownerAccount?: string;       // actual wallet; may be undefined if resolution failed
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
    rank: number;
    knownType?: string;          // BURN | LP | RAYDIUM | ORCA | JUPITER | PROTOCOL | EXCHANGE | SYSTEM
    knownLabel?: string;         // "🔥 Burn Address" | "LIQ POOL 💧" | "🔒 Lock Vault" | etc.
  }>;
  supply?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}
```

#### Step 2 — Batch HUD (real wallets only)
Filter holders: keep only those where `knownType` is absent and `ownerAccount` is defined.

```
POST /wallets/hud/batch
Header: x-api-key: <ANALYZER_API_KEY>
Body: { "walletAddresses": string[] }   // max 200
```

**Response schema:**
```typescript
{
  huds: Record<string, WalletHud>;   // keyed by wallet address
  notFound: string[];                // wallets with no analysis data
  calculatedAt: string;
}
```

Where `WalletHud`:
```typescript
{
  walletAddress: string;
  trimmedMeanPnl: number;            // realized PNL in SOL, outlier-adjusted
  medianPnlPerToken: number;
  behaviorCategory?: string;         // "MOMENTUM_TRADER" | "DAY_TRADER" | "SCALPER" | etc.
  behaviorCode: string;              // S | R | M | I | D | W | P | H | F | A | T | B | L | ?
  medianHoldTimeHours?: number;
  avgTradesPerDay: number;
  winRate: number;                   // 0–1 decimal (0.68 = 68%)
  isBot: boolean;                    // true if >60 unique tokens/day
  isWhale: boolean;                  // true if portfolio >200 SOL or >$20K USD
  uniqueTokensPerDay: number;
  currentHoldingsSol: number;
  currentHoldingsUsd?: number;
  dataQualityTier: string;           // GOLD | SILVER | BRONZE | INSUFFICIENT
  calculatedAt: string;
}
```

### Transformation Logic → On-Chain Reply

```
TOKEN: <name> (<symbol>)          // from token-info if available, else truncated mint
Supply: analyzed X of Y holders

#   Wallet         Supply   PnL          Style        Hold      Flags
1   7GAu..HqK8    87.3%    —            Holder        —
2   DNfu..eBHm     2.0%    +1.19K SOL   Day Trader    22h       🐋
3   AJof..18KN     0.9%    +850 SOL     Momentum      17min
4   9xQe..VFin     0.4%    +320 SOL     Scalper       2min      🤖

System: 🔥 Burn 42.0% | 💧 LP (Raydium) 15.2% | 🔒 Lock 8.3%
Trader types: Day Trader 1 | Momentum 1 | Scalper 1 | Holder 1

* 3 wallets queued for analysis — profiles incoming (no extra charge)
```

**Column logic:**
- `Wallet` → `ownerAccount.slice(0,4)..ownerAccount.slice(-4)`
- `Supply` → `(uiAmount / supply.uiAmount * 100).toFixed(1)%` or raw if no supply
- `PnL` → `trimmedMeanPnl` from HUD; format: `+1.19K SOL` / `-850 SOL` / `—` if notFound
- `Style` → `behaviorCategory` mapped through display labels (see below)
- `Hold` → `medianHoldTimeHours`: `<1h → Xmin`, `<24h → X.Xh`, `>=24h → X.Xd`; `—` if missing
- `Flags` → `🤖` if isBot, `🐋` if isWhale, `⭐` if winRate > 0.65 and tier GOLD/SILVER
- System accounts → summary line, not in main table
- Cap at ~10 real wallets in table; summarize remainder
- Total output target: under 2000 chars

**Behavior category display mapping:**
```
SNIPER → Sniper        SCALPER → Scalper       MOMENTUM / MOMENTUM_TRADER → Momentum
INTRADAY → Intraday    DAY_TRADER → Day Trader  SWING / SWING_TRADER → Swing
POSITION / POSITION_TRADER → Position           HODLER / PURE_HOLDER → Holder
ACCUMULATOR → Accumulator                        DISTRIBUTOR → Distributor
BALANCED_TRADER → Balanced                       LOW_ACTIVITY → Low Activity
FAST_TRADER → Fast Trader                        ULTRA_FLIPPER → Ultra Flipper
FLIPPER → Flipper
```

---

## 2. `/profile <address>`

### API Call
```
GET /wallets/{address}/hud
Header: x-api-key: <ANALYZER_API_KEY>
```

Returns `WalletHud` (same schema as above). Returns **404** if wallet not analyzed.

### Transformation Logic → On-Chain Reply

**HUD found:**
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

Use /analyze <address> for deep analysis with full breakdown.
```

**Win Rate**: multiply `winRate` (0–1) × 100, display as integer %.
**Style**: `behaviorCategory` label + `(behaviorCode)` in parentheses.
**Holdings**: `currentHoldingsSol` SOL + `($currentHoldingsUsd)` if available.

**404 — wallet not analyzed:**
Bot auto-queues a `working` analysis job. Immediate reply:
```
WALLET: DNfu..eBHm
Status: Not yet analyzed — queuing full analysis now.

I'll send the profile when ready (no extra charge).
```
Deferred-jobs loop delivers the full profile card as a follow-up reply on the same thread when the job completes.

---

## 3. `/analyze <address> [scope]`

Scope options: `flash` | `working` (default) | `deep`

### API Call
```
POST /analyses/wallets/dashboard-analysis
Header: x-api-key: <ANALYZER_API_KEY>
Body: { "walletAddress": string, "analysisScope": "flash" | "working" | "deep" }
```

**Response schema:**
```typescript
{
  jobId: string | null;            // null if skipped
  requestId: string;
  status: 'queued' | 'running' | 'skipped';
  analysisScope: string;
  estimatedProcessingTime: string; // "2 minute(s)" | "8 minute(s)"
  skipped?: boolean;
  skipReason?: string;             // "known-LP" | "fresh-within-30m" | etc.
  alreadyRunning?: boolean;
}
```

### Immediate ACK Reply
```
Analysis queued for DNfu..eBHm (working scope).
Estimated: 8 minute(s). I'll send results when ready.
Job ID: abc123
```

### Deferred — Poll for Result
```
GET /jobs/{jobId}/result
Header: x-api-key: <ANALYZER_API_KEY>
```

**Response schema:**
```typescript
{
  jobId: string;
  status: 'completed' | 'failed' | 'active' | 'waiting';
  result?: any;    // shape depends on job type
  error?: string;  // only if failed
}
```

Poll every `JOB_POLL_INTERVAL_MS` (15s). Timeout after `JOB_TIMEOUT_MS` (600000ms / 10min).

### Follow-Up Reply (on completion)

**Short chat message:**
```
Analysis complete: DNfu..eBHm

PnL: +1.19K SOL | Win Rate: 68% | Style: Day Trader
Volume: 45.2K SOL total | 342 trades | 87 tokens
Risk: Medium (avg 0.8 SOL/trade, max 12.4 SOL)

Full report attached.
```

Full report uploaded to IPFS via `upload_content({ content: markdownReport, content_type: 'text/markdown' })` and sent as attachment `{ cid, content_type: 'text/markdown', filename: 'analysis.md' }`.

---

## 4. `/compare <addr1> <addr2> [addr3...]`

Accepts 2–30 Solana addresses.

### API Call
```
POST /analyses/similarity/queue
Header: x-api-key: <ANALYZER_API_KEY>
Body: { "walletAddresses": string[] }
```

**Response schema:**
```typescript
{
  jobId: string;
  requestId: string;
  status: 'queued';
  walletCount: number;
  estimatedProcessingTime: string;
}
```

### Immediate ACK Reply
```
Similarity analysis queued for 3 wallets.
Estimated: 5 minute(s). I'll send results when ready.
```

### Deferred — Poll + Reply (same `GET /jobs/{jobId}/result` as above)

**Follow-up reply:**
```
SIMILARITY ANALYSIS: 3 wallets

Pair                          Similarity
DNfu..eBHm ↔ AJof..18KN       72%   (High — likely same strategy)
DNfu..eBHm ↔ 9xQe..VFin       23%   (Low — independent)
AJof..18KN ↔ 9xQe..VFin       18%   (Low — independent)

Verdict: DNfu..eBHm and AJof..18KN show similar trading patterns.
         Possible same operator or copy-trading.
```

---

## Error Handling & Fallbacks

### Payment Errors
| Case | Condition | Bot Action |
|------|-----------|------------|
| Dust | `amount_pft < MIN_PAYMENT_PFT` (100) | Ignore silently |
| Underpayment | `amount_pft < COMMAND_PRICES[command]` | Reply with pricing list |
| Unknown command | No matching command prefix | Reply with help text listing all commands + prices |
| Invalid address | Fails base58 regex `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/` | Reply: "Invalid Solana address." |
| Missing address | Command parsed, no valid args | Reply with command usage example |

### API Response Errors
| Case | API Signal | Bot Action |
|------|------------|------------|
| Wallet not analyzed | HUD returns 404 | Auto-queue `working` analysis job; reply ACK; deliver profile via deferred-jobs when complete |
| Wallet in `notFound` (batch) | `notFound[]` contains address | Show row with `—`; auto-queue `flash` job per wallet; deliver each profile via deferred-jobs |
| Known system wallet | `knownType` present on holder | Move to system summary line, exclude from main table |
| Analysis skipped — LP/burn | `skipped: true`, `skipReason: "known-LP"` | Reply: "This is a known LP/burn address, analysis skipped." |
| Analysis skipped — fresh | `skipped: true`, `skipReason: "fresh-within-Xm"` | Reply: "Fresh analysis exists from X minutes ago." + show cached HUD |
| Already running | `alreadyRunning: true` | Reply: "Analysis already running." + add existing `jobId` to deferred poll |
| Job failed | `status: 'failed'`, `error` present | Send error message to user, suggest retry |
| Job timeout | `queuedAt` + `JOB_TIMEOUT_MS` exceeded | Send: "Analysis timed out. Try /analyze <address> flash for a faster result." |
| Rate limit | API returns 429 | Queue retry with backoff; do not surface to user |
| API down | Network error / 5xx | Log error, reply: "Service temporarily unavailable. Please try again shortly." |

### PFT Chain Errors
| Case | Action |
|------|--------|
| MCP subprocess crash | Log error, attempt reconnect; after 3 failures exit process (pm2 restarts) |
| Duplicate message | Cursor + tx_hash Set dedup prevents double-processing |
| Bot low on PFT | Log warning only; bot spends minimum drops per reply |

---

## Helper Functions (Formatter Utilities)

```typescript
// Hold time
function formatHoldTime(hours?: number): string {
  if (!hours) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// PNL
function formatPnl(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M SOL`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}

// Wallet address display
function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

// Win rate (HUD winRate is 0–1; WalletSummary tokenWinRate is 0–100)
function displayWinRate(winRate: number, isDecimal = true): string {
  return `${Math.round(isDecimal ? winRate * 100 : winRate)}%`;
}
```

---

## Environment Variables (Quick Reference)

```
BOT_SEED                 PFTL wallet seed (never commit)
ANALYZER_API_URL         http://localhost:3001/api/v1
ANALYZER_API_KEY         wal_XXXXXXXXXX
SCAN_INTERVAL_MS         5000
MIN_PAYMENT_PFT          100
JOB_POLL_INTERVAL_MS     15000
JOB_TIMEOUT_MS           600000
CURSOR_FILE              ./data/cursor.json
PENDING_JOBS_FILE        ./data/pending-jobs.json
PRICE_HOLDERS            1000
PRICE_PROFILE            500
PRICE_ANALYZE            3000
PRICE_COMPARE            3000
```
