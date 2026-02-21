# PFT Oracle Bot — Implementation Plan (v3)

**Purpose**: A Solana wallet intelligence bot on the Post Fiat network. Users send commands with PFT payment, the bot calls the analyzer API, transforms JSON responses into formatted text, and replies on-chain.

**Key insight**: The PFT chatbot MCP handles all chain I/O (encryption, IPFS, scanning, sending). The analyzer API handles all data. The bot is ~300 lines of glue code between them.

---

## 1. Architecture

```
Your Server
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  pft-oracle-bot (Node.js, pm2)                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                                                    │  │
│  │  Scan Loop (every 5s)                              │  │
│  │    │                                               │  │
│  │    ├─ scan_messages() ──┐                          │  │
│  │    ├─ get_message()     │ via @modelcontextprotocol│  │
│  │    ├─ send_message()    │ SDK → pft-chatbot-mcp    │  │
│  │    └─ upload_content()  │ (stdio subprocess)       │  │
│  │                         │                          │  │
│  │  Command Router                                    │  │
│  │    │                                               │  │
│  │    ├─ /holders <mint>                              │  │
│  │    ├─ /profile <address>                           │  │
│  │    ├─ /analyze <address>                           │  │
│  │    └─ /compare <addr1> <addr2>                     │  │
│  │                                                    │  │
│  │  Analyzer Client (axios)                           │  │
│  │    │                                               │  │
│  │    ├─ GET  /token-info/{mint}/top-holders          │  │
│  │    ├─ POST /wallets/hud/batch                      │  │
│  │    ├─ GET  /wallets/{addr}/summary                 │  │
│  │    ├─ GET  /wallets/{addr}/pnl-overview            │  │
│  │    ├─ GET  /wallets/{addr}/behavior-analysis       │  │
│  │    ├─ POST /analyses/dashboard-analysis            │  │
│  │    ├─ POST /analyses/similarity/queue              │  │
│  │    └─ GET  /jobs/{id}/result                       │  │
│  │                                                    │  │
│  │  Formatters (pure functions, JSON → text)          │  │
│  │    │                                               │  │
│  │    ├─ formatHolderTable()                          │  │
│  │    ├─ formatWalletProfile()                        │  │
│  │    ├─ formatAnalysisResult()                       │  │
│  │    └─ formatComparison()                           │  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│                          │ HTTP localhost:3001            │
│                          ▼                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Analyzer Backend (NestJS, already running)        │  │
│  │  PostgreSQL + Redis + BullMQ + Helius              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**No LLM in the loop.** No ai-chat submodule. No ReAct engine. Commands are parsed deterministically. API responses are formatted by pure functions.

LLM narration is a future upgrade — one optional API call to turn JSON into prose. Not architectural.

---

## 2. What the Bot Does (Phase 1 — MVP)

### Command: `/holders <mint>`

The hook. Someone sees a token, wants to know who's holding it and whether they're smart money.

**Flow:**
1. `GET /token-info/{mint}/top-holders` → 20 holders with rank, amount, knownType
2. Filter out LIQ POOL, BURN, LOCK addresses (using `knownType` field)
3. Extract owner wallet addresses (real wallets only)
4. `POST /wallets/hud/batch` with those addresses → behavior, PnL, winRate, isBot, isWhale
5. Merge holder data + HUD data
6. Format into text table
7. Reply via `send_message`

**What the user sees:**
```
TOKEN: Teach Threshold (THRESHOLD)
Supply: analyzed 8 of 20 holders

#  Wallet       Supply  PnL        Style        Hold Time  Flags
1  7GAu..HqK8   87.3%  —          Holder       —
2  EkhP..odbs    5.1%  —          Holder       —
3  DNfu..eBHm    2.0%  1.19K SOL  Day Trader   22h med    🐋
4  AJof..18KN    0.9%  850 SOL    Momentum     17min med
5  9xQe..VFin    0.4%  320 SOL    Scalper      2min med   🤖

Distribution: Holder 2 | Day Trader 1 | Momentum 1 | Scalper 1
Verdict: Moderately stable. Mix of short and medium-term holders.
         Some conviction building.
```

**For wallets not yet analyzed (in `notFound`):**
The user already paid. Auto-queue a `flash` analysis job for each notFound wallet via `POST /analyses/wallets/dashboard-analysis` with `analysisScope: "flash"`. Store each jobId in the deferred-jobs state machine. Reply immediately with the partial table (showing `—` for unanalyzed rows) and a note that results are incoming:
```
* 3 wallets queued for analysis — I'll send profiles when ready (no extra charge).
```
When each job completes, send a follow-up reply on the same thread with the wallet's profile card.

### Command: `/profile <address>`

**Flow:**
1. `GET /wallets/{address}/hud` → quick behavioral snapshot
2. If 404: auto-queue a `working` analysis job via `POST /analyses/wallets/dashboard-analysis`. Store jobId in the deferred-jobs state machine. Reply immediately:
   ```
   Wallet not yet analyzed. Queuing full analysis now — I'll send results when ready (no extra charge).
   ```
   When the job completes, the deferred-jobs loop sends the full profile card as a follow-up reply on the same thread.
3. If HUD found: format HUD data into profile card and reply.

**What the user sees:**
```
WALLET: DNfu..eBHm

PnL:        1.19K SOL (trimmed mean per token)
Win Rate:   68%
Style:      Day Trader (D)
Hold Time:  22h median
Activity:   12.5 trades/day | 12 tokens/day
Holdings:   245 SOL ($28.2K)
Flags:      🐋 Whale
Quality:    GOLD (50+ trades, 7+ days)

Data range: Oct 2025 — Feb 2026
```

### Command: `/analyze <address>` (Phase 2)

Queues a full analysis job. Returns immediately with an acknowledgment.

**Flow:**
1. `POST /analyses/dashboard-analysis` with `{ walletAddress, analysisScope: "working" }`
2. Reply: "Analysis queued for {address}. This takes 2-15 minutes. I'll send results when ready."
3. Bot stores `{ jobId, sender, threadId }` in pending jobs
4. Separate poll loop checks `GET /jobs/{jobId}/result` every 15s
5. When complete, format result and `send_message` as follow-up

### Command: `/compare <addr1> <addr2> ...` (Phase 3)

Same deferred pattern as `/analyze` but uses `POST /analyses/similarity/queue`.

---

## 3. File Structure

```
pft-bot/
├── package.json
├── tsconfig.json
├── .env
├── src/
│   ├── index.ts              # Entry: init MCP client, init analyzer, start scan loop
│   ├── pft-client.ts         # Typed wrapper around pft-chatbot-mcp via MCP SDK
│   ├── scanner.ts            # Scan loop, cursor persistence, dedup, payment validation
│   ├── commands.ts           # Parse commands, route to handlers
│   ├── analyzer.ts           # HTTP client for analyzer API endpoints
│   ├── formatters/
│   │   ├── holders.ts        # Format top holders + HUD into text table
│   │   ├── profile.ts        # Format wallet HUD into profile card
│   │   ├── analysis.ts       # Format full analysis result
│   │   └── comparison.ts     # Format similarity result
│   ├── deferred-jobs.ts      # Poll pending background jobs, send follow-up replies
│   └── config.ts             # Env vars, pricing thresholds, constants
└── data/
    └── (cursor.json, pending-jobs.json created at runtime)
```

~10 files. No submodule. No external conversation engine.

---

## 4. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "@postfiatorg/pft-chatbot-mcp": "^0.3.0",
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

That's it. 4 runtime dependencies.

---

## 5. Environment Variables

```env
# PFT Identity
BOT_SEED=sEdXXXXXXXX                       # PFTL wallet seed (NEVER commit)

# Analyzer API
ANALYZER_API_URL=http://localhost:3001/api/v1
ANALYZER_API_KEY=wal_XXXXXXXXXX             # Internal bot API key

# Bot Behavior
SCAN_INTERVAL_MS=5000
MIN_PAYMENT_PFT=500                         # Minimum PFT per command

# Job Polling
JOB_POLL_INTERVAL_MS=15000
JOB_TIMEOUT_MS=600000                       # 10 min max wait

# Persistence
CURSOR_FILE=./data/cursor.json
PENDING_JOBS_FILE=./data/pending-jobs.json

# PFT Command Pricing (in whole PFT)
PRICE_HOLDERS=1000
PRICE_PROFILE=500
PRICE_ANALYZE=3000
PRICE_COMPARE=3000
```

No LLM keys needed for MVP.

---

## 6. Bot Registration

```typescript
await pftClient.callTool('register_bot', {
  name: 'Sova Intel',
  description: 'Solana wallet intelligence. Send a token mint to see who holds it and whether they are smart money, bots, or bag holders.',
  capabilities: ['text-generation'],
  icon_emoji: '🦉',
  commands: [
    {
      command: '/holders',
      description: 'Top holders of a token with behavioral profiles',
      example: '/holders So11111111111111111111111111111111111111112',
      min_cost_drops: '1000000000'  // 1000 PFT
    },
    {
      command: '/profile',
      description: 'Quick behavioral profile of a wallet',
      example: '/profile DNfu...eBHm',
      min_cost_drops: '500000000'   // 500 PFT
    },
    {
      command: '/analyze',
      description: 'Run full deep analysis on a wallet (2-15 min)',
      example: '/analyze DNfu...eBHm',
      min_cost_drops: '3000000000'  // 3000 PFT
    },
    {
      command: '/compare',
      description: 'Compare trading behavior between wallets',
      example: '/compare addr1 addr2',
      min_cost_drops: '3000000000'  // 3000 PFT
    }
  ]
});
```

---

## 7. Presentation Strategy

### Text formatting in PFT messages

PFT messages are plain text delivered via encrypted IPFS payloads. The Task Node UI renders them in a chat-like interface. We use monospace-friendly formatting:

- Fixed-width columns for tables (align with spaces)
- Unicode box drawing for structure where helpful
- Emoji sparingly for flags (🐋 whale, 🤖 bot, 🔥 high win rate)
- Keep messages under ~2000 chars for readability in chat UI

### For larger results: markdown attachments

For full analysis results and comparisons, upload a markdown document to IPFS via `upload_content`, then attach it to the reply. The user gets a short summary in chat + a link to the full report.

```typescript
// Upload detailed report
const report = await pftClient.callTool('upload_content', {
  content: markdownReport,
  content_type: 'text/markdown'
});

// Send summary + attachment
await pftClient.callTool('send_message', {
  recipient: sender,
  message: shortSummary,
  attachments: [{ cid: report.cid, content_type: 'text/markdown', filename: 'analysis.md' }],
  reply_to_tx: txHash
});
```

### Handling unanalyzed wallets

When `/holders` or `/profile` encounters wallets with no HUD data, the bot **auto-queues analysis jobs at no extra charge** using the existing deferred-jobs state machine.

- Show the partial table immediately with `—` for unanalyzed rows
- Auto-queue a `flash` analysis job for each notFound wallet
- Reply note: "X wallets queued for analysis — profiles incoming (no extra charge)"
- Deferred-jobs loop polls, then sends each profile as a follow-up reply on the same thread

The user paid once and gets complete results delivered automatically. No back-and-forth, no burning credits on a command that returns nothing.

---

## 8. Implementation Order

### Phase 1: Scaffold + PFT Client (get messages flowing)

1. Create `pft-bot/` with package.json, tsconfig.json, .env
2. Write `pft-client.ts` — spawn pft-chatbot-mcp via MCP SDK Client, expose typed methods
3. Write `scanner.ts` — scan loop with cursor persistence and dedup
4. Write `config.ts` — env loading
5. Write minimal `index.ts` — boot, register bot, start scanning
6. **TEST**: See messages arriving in the scan loop, reply with echo

### Phase 2: Analyzer Client + Holders Command (the product)

1. Write `analyzer.ts` — axios wrapper for the endpoints we need
2. Write `formatters/holders.ts` — merge top-holders + batch HUD → text table
3. Write `commands.ts` — parse `/holders`, route to handler
4. Wire it together: scan → parse → call API → format → reply
5. **TEST**: Send `/holders <known-mint>` via PFT → get holder table back
6. Create bot API key in analyzer database

### Phase 3: Profile Command

1. Write `formatters/profile.ts` — format single wallet HUD into profile card
2. Add `/profile` to command router
3. **TEST**: Send `/profile <known-address>` → get profile back

### Phase 4: Deferred Jobs (analyze + compare)

1. Write `deferred-jobs.ts` — store pending jobs, poll loop, send results
2. Write `formatters/analysis.ts` and `formatters/comparison.ts`
3. Add `/analyze` and `/compare` to command router
4. Add markdown attachment upload for large results
5. **TEST**: Send `/analyze <address>` → get acknowledgment → get result later

### Phase 5: Hardening

1. Payment validation (check amount_pft >= command price)
2. Refund logic for invalid commands (send back PFT minus 1 fee)
3. Error handling (API down, invalid addresses, timeout)
4. Crash recovery (cursor + pending jobs persistence)
5. Rate limiting (max concurrent API calls)
6. Balance monitoring

---

## 9. What NOT To Build

- No LLM integration (MVP is pure formatting)
- No ai-chat submodule
- No ReAct engine or conversation state
- No MCP server wrapping the analyzer API
- No database tables in the bot
- No frontend changes
- No changes to analyzer backend (except bot API key creation)
- No conversation memory (each command is stateless)

---

## 10. Future Upgrades (Post-MVP, not planned now)

- **LLM narration**: Optional single API call to narrate JSON → prose. Costs ~$0.001/call. Premium mode.
- **Free-form questions**: Add LLM with tool calling for users who don't use commands. Requires OpenAI/Anthropic SDK with function definitions.
- **Conversation memory**: Track per-sender history for multi-turn. Simple Map with TTL.
- **Throttler bypass**: If bot hits analyzer rate limits, add custom guard in NestJS (~20 lines).
- **Auto-analysis**: Implemented as core behavior — not a future upgrade.
