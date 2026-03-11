# Telegram Bot Intel — Spec

**Branch:** `feat/telegram-bot-intel`  **Created:** 2026-03-09  **Status:** Scaffolding

---

## What

A Telegraf-based Telegram bot that exposes three Intel API commands to allowlisted users:

| Command | Endpoint | Cost | Returns |
|:--------|:---------|:----:|:--------|
| `/hud <addr>` | `GET /api/v1/intel/wallet/:addr/hud` | 1cr | Compact behavioral HUD |
| `/profile <addr>` | `GET /api/v1/intel/wallet/:addr` | 5cr | Full wallet profile (PnL + behavior + summary) |
| `/holders <mint>` | `POST /api/v1/intel/token/:mint/holders` | 20cr | Top holder profiles (async) |

This is the **first retail revenue surface** for Sova Intel — real Telegram users paying real credits via a single system API key.

---

## Why This Architecture

### Separate process, not NestJS module

The existing `src/core/bot/` is a legacy Helius/raw-chain bot — it instantiates NestJS services directly (CorrelationAnalyzer, HeliusSyncService, BehaviorService) and runs as a standalone Node process. **Zero reuse is possible** because the new bot's job is orthogonal: it calls the HTTP Intel API, not internal services.

Running as a separate process (independent PM2 entry) is correct because:
- The bot has its own lifecycle (Telegram long-polling) and failure mode
- It needs none of the NestJS DI container
- It can be restarted, deployed, or scaled independently of the API

### Single system API key — one billing identity, per-user attribution on bot side

The bot authenticates to the Intel API with one `system-telegram-bot` API key. All credit charges go against that key's balance. The bot itself enforces access control (allowlist) and records per-user attribution locally (DB `TelegramBotLog` table).

**User differentiation IS possible** — and is implemented — via:
1. `ALLOWED_TELEGRAM_USER_IDS` env var: static allowlist. Only these users can invoke commands.
2. `TelegramBotLog` table: every command invocation logs `telegramUserId`, `username`, `command`, `address`, `creditCost`, `timestamp`. This gives per-user usage analytics without any per-user credit account.
3. Per-user rate limiting (deferred to post-MVP): can be added using Redis TTL keys on the bot side.

If in future we want per-user credit accounts (each user has their own Sova API key), that's a natural extension — the `TelegramBotLog` already has the `telegramUserId` to link against.

### No polling — synchronous hold works for /hud and /profile

The Intel API already implements **synchronous hold** (PAY-8): `GET /hud` and `GET /intel/wallet/:addr` hold the HTTP connection open up to 30s, run flash analysis in the background, and return 200 + data in a single request. The bot just awaits the HTTP call — it naturally blocks until data arrives or timeout.

On the bot side: send a `⏳ Analyzing...` message immediately (user feedback), then await the API call, then **edit that same message** with the result. Clean, single message per command, no polling noise.

`/holders` (POST) is genuinely async — the API returns 202 immediately and the job runs for minutes. Here we DO poll, but invisibly: the bot sends `⏳ Profiling top holders...`, polls `GET /api/v1/jobs/:jobId` every 3s (up to 2 min), then edits the message with the result or a timeout notice. The user sees one message evolve. No spam.

Why not even send the `⏳` message? Telegram shows no visual feedback for pending bot responses — users will think the bot is broken within 2s. The `⏳` message + edit pattern is the correct UX for operations >1s.

---

## File Structure

```
src/bot/intel/
  index.ts              ← entry point: env validation, bot.start()
  bot.ts                ← Telegraf setup, auth middleware, command registration
  commands/
    hud.ts              ← /hud handler
    profile.ts          ← /profile handler
    holders.ts          ← /holders handler (async, polls job)
  formatters/
    hud.formatter.ts    ← pipe-string → labeled fields + emoji behavior tags
    profile.formatter.ts← bold stats, PnL, behavior tags
    holders.formatter.ts← ranked holder list with PnL + behavior labels
  intel-client.ts       ← axios wrapper for all Intel API calls (API key injected)
  config.ts             ← typed env: BOT_TOKEN, INTEL_API_KEY, INTEL_BASE_URL, ALLOWED_USER_IDS
```

Runs via: `npx ts-node -r tsconfig-paths/register src/bot/intel/index.ts`

**PM2 entry** (`ecosystem.config.js`) — separate process, not grouped with the API server:
```js
{
  name: 'sova-tg-bot',
  script: 'src/bot/intel/index.ts',
  interpreter: 'node',
  interpreter_args: '-r ts-node/register -r tsconfig-paths/register',
  env_file: '.env',
  autorestart: true,
  watch: false,
}
```
`pm2 start ecosystem.config.js --only sova-tg-bot`

---

## API Key Seeding

The `system-telegram-bot` user + API key is seeded via a dedicated seed script (not mixed into prisma/seed.ts):

```
prisma/seed-telegram-bot.ts
```

Creates a `User` record with `description: 'system-telegram-bot'` and a raw API key (`sova_tgbot_<random>`). The raw key is printed once to stdout — copy it to `.env` as `INTEL_API_KEY`. The DB stores a bcrypt hash. This is the same pattern as manual API key creation in the dashboard.

Initial credit top-up is done manually via the dashboard or a one-liner script.

---

## Attribution Table

New Prisma model `TelegramBotLog`:

```prisma
model TelegramBotLog {
  id             String   @id @default(cuid())
  telegramUserId String
  username       String?
  command        String   // 'hud' | 'holders' | 'profile'
  address        String   // wallet addr or mint
  creditCost     Int
  success        Boolean
  errorCode      String?
  createdAt      DateTime @default(now())

  @@index([telegramUserId])
  @@index([command])
  @@index([createdAt])
}
```

Written fire-and-forget after each command resolves (success or error). No await — never blocks response.

---

## Error Handling

| API response | Bot message |
|:-------------|:-----------|
| 402 Insufficient credits | `❌ Bot credit balance depleted. Contact admin.` |
| 400 Invalid address | `❌ Invalid Solana address. Check your input.` |
| 422 Known system wallet | `⚠️ This address is a known system/program account — not eligible for analysis.` |
| 404 No data | `❌ No data found. Try /profile first to trigger analysis.` |
| Timeout (30s) | `⏱ Analysis is taking longer than usual. Try again in a minute.` |
| 500 / network error | `❌ Service error. Try again shortly.` |

---

## Reuse from pft-bot_v2

`pft-bot_v2/` is a working production bot that calls the same Analyzer API. It was fully read and audited on 2026-03-09. The sections below are self-contained — no need to re-read pft-bot source files; everything you need is reproduced here.

---

### What to copy verbatim (zero changes needed)

#### 1. Address validation regex — use everywhere
```ts
// pft-bot_v2/src/commands.ts line 6
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
```

#### 2. Config helpers — `src/bot/intel/config.ts`
```ts
// pft-bot_v2/src/config.ts — copy this pattern exactly
import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}
```
Then define the config object with: `BOT_TOKEN` (required), `INTEL_API_KEY` (required), `INTEL_BASE_URL` (optional, default `http://localhost:3001/api/v1`), `ALLOWED_TELEGRAM_USER_IDS` (required — comma-separated), `ADMIN_TELEGRAM_ID` (optional).

#### 3. PM2 graceful shutdown + ready signal — `src/bot/intel/index.ts`
```ts
// pft-bot_v2/src/index.ts lines 62–75 — copy exactly
const shutdown = (): void => {
  console.log('\n[BOOT] Shutting down...');
  bot.stop('SIGINT');   // Telegraf graceful stop
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[BOOT] Sova Telegram Bot running.');

// Notify pm2 we're ready (only fires when pm2 wait_ready: true)
if (process.send) process.send('ready');
```

#### 4. PM2 process config — add to `ecosystem.config.js` in repo root
```js
// pft-bot_v2/ecosystem.config.cjs — copy these settings
{
  name: 'sova-tg-bot',
  script: 'src/bot/intel/index.ts',
  interpreter: 'node',
  interpreter_args: '-r ts-node/register -r tsconfig-paths/register',
  cwd: __dirname,
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  wait_ready: true,          // waits for process.send('ready')
  listen_timeout: 10000,
  min_uptime: '60s',
  max_restarts: 10,
  exp_backoff_restart_delay: 100,
  max_memory_restart: '512M',
  out_file: './logs/sova-tg-bot-out.log',
  error_file: './logs/sova-tg-bot-err.log',
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  env: { NODE_ENV: 'production' },
}
```

---

### What to copy and adapt (Telegram HTML instead of plain text)

#### 5. Behavior label maps — copy into `src/bot/intel/formatters/holders.formatter.ts`

These are production-tested and cover all behavior codes the API returns:

```ts
// pft-bot_v2/src/formatters/holders.ts
const BEHAVIOR_LABELS: Record<string, string> = {
  'SNIPER': 'Sniper', 'SCALPER': 'Scalper',
  'MOMENTUM': 'Momentum', 'MOMENTUM_TRADER': 'Momentum',
  'INTRADAY': 'Intraday', 'DAY_TRADER': 'Day Trader',
  'SWING': 'Swing', 'SWING_TRADER': 'Swing',
  'POSITION': 'Position', 'POSITION_TRADER': 'Position',
  'HODLER': 'Holder', 'PURE_HOLDER': 'Holder',
  'ACCUMULATOR': 'Accumulator', 'DISTRIBUTOR': 'Distributor',
  'BALANCED_TRADER': 'Balanced', 'LOW_ACTIVITY': 'Low Activity',
  'FAST_TRADER': 'Fast Trader', 'ULTRA_FLIPPER': 'Ultra Flipper',
  'FLIPPER': 'Flipper',
};

const BEHAVIOR_EMOJIS: Record<string, string> = {
  'Sniper': '🎯', 'Scalper': '⚡', 'Momentum': '🚀',
  'Intraday': '📈', 'Day Trader': '⏱️', 'Swing': '🌊',
  'Position': '🏛️', 'Holder': '💎', 'Accumulator': '🧲',
  'Distributor': '📤', 'Balanced': '⚖️', 'Low Activity': '🛌',
  'Fast Trader': '💨', 'Ultra Flipper': '🌀', 'Flipper': '🔁',
};
```

#### 6. Shared formatter helpers — copy into a shared `formatters/utils.ts`

These are used by both profile and holders formatters. Copy verbatim:

```ts
// pft-bot_v2/src/formatters/profile.ts + holders.ts

function formatSol(sol: number): string {
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M SOL`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(2)}K SOL`;
  return `${sign}${abs.toFixed(2)} SOL`;
}

function formatHoldTime(hours?: number | null): string {
  if (!hours) return '—';
  if (hours < 1)  return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatBehavior(category?: string | null, code?: string | null): string {
  if (category && BEHAVIOR_LABELS[category]) return BEHAVIOR_LABELS[category];
  if (category) return category.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  if (code) return `(${code})`;
  return '—';
}

function withBehaviorEmoji(style: string): string {
  const emoji = BEHAVIOR_EMOJIS[style];
  return emoji ? `${emoji} ${style}` : style;
}

function formatDataQuality(tier: string, cycles: number): string {
  const tierMap: Record<string, string> = { 'GOLD': '🥇', 'SILVER': '🥈', 'BRONZE': '🥉' };
  const emoji = tierMap[tier] ?? '';
  const cycleStr = cycles > 0 ? `${cycles}c` : '';
  return [emoji, cycleStr].filter(Boolean).join(' ') || tier || '—';
}
```

#### 7. Profile formatter — adapt for Telegram HTML

The pft-bot version outputs plain text (monospace). For Telegram, wrap key values in `<b>` tags. The logic is identical — just change the line-building:

```ts
// Adaptation of pft-bot_v2/src/formatters/profile.ts for Telegram HTML parse_mode
// Key difference: use <b>value</b> instead of plain value, and <code>addr</code> for addresses

export function formatHud(addr: string, hud: WalletHud): string {
  const short = `${addr.slice(0, 4)}..${addr.slice(-4)}`;
  const lines: string[] = [];
  lines.push(`<code>${short}</code>`);
  lines.push('');
  lines.push(`PnL (trimmed):  <b>${formatSol(hud.trimmedMeanPnl)}</b> per token`);
  lines.push(`Win Rate:       <b>${Math.round(hud.winRate * 100)}%</b>`);
  lines.push(`Avg Tx Size:    <b>${formatSol(hud.avgTxValueSol)}</b> SOL`);
  lines.push('');
  lines.push(`Style:     <b>${withBehaviorEmoji(formatBehavior(hud.behaviorCategory, hud.behaviorCode))}</b>`);
  lines.push(`Hold Time: <b>${formatHoldTime(hud.medianHoldTimeHours)}</b> median`);
  lines.push(`Activity:  <b>${hud.avgTradesPerDay.toFixed(1)}</b> trades/day`);
  lines.push('');
  const holdingsStr = hud.currentHoldingsUsd
    ? `<b>${hud.currentHoldingsSol.toFixed(1)} SOL</b> ($${formatUsd(hud.currentHoldingsUsd)})`
    : `<b>${hud.currentHoldingsSol.toFixed(1)} SOL</b>`;
  lines.push(`Holdings: ${holdingsStr}`);
  const flags: string[] = [];
  if (hud.isWhale) flags.push('🐋 Whale');
  if (hud.isBot)   flags.push('🤖 Bot');
  if (flags.length) lines.push(`Flags: ${flags.join('  ')}`);
  lines.push(`Quality: <b>${hud.dataQualityTier}</b>`);
  return lines.join('\n');
}
```

The `/profile` formatter extends this with PnL period data and behavior detail from the richer `GET /intel/wallet/:addr` response shape (see intel-client types).

#### 8. Holders formatter — adapt for Telegram HTML

The pft-bot `formatHolderProfilesResult()` is 80 lines of proven logic. Adaptation needed:
- Wrap holder addresses in `<code>addr</code>`
- Wrap PnL/style values in `<b>`
- Telegram message limit is 4096 chars — if result exceeds it, truncate at 8 holders and append "...and N more"

The logic structure (system profiles, real profiles loop, distribution summary, metadata footer) is identical — copy from `pft-bot_v2/src/formatters/holders.ts` lines 182–268.

---

### API type definitions — copy into `intel-client.ts`

These interfaces were extracted from the live API responses and are accurate. Copy all of them from `pft-bot_v2/src/analyzer.ts`:

- `WalletHud` — response shape of `GET /intel/wallet/:addr/hud`
- `HolderProfile` — single profile in `HolderProfilesResult`
- `HolderProfilesResult` — job result payload stored in Redis, returned by `GET /jobs/:jobId/result`
- `JobResult` — `{ jobId, status, result?, error? }` from `GET /jobs/:jobId/result`

The Intel API (`/api/v1/intel/...`) returns the same shapes as the internal API (`/api/v1/wallets/...` and `/api/v1/analyses/...`) — they are the same backend services. pft-bot types are authoritative.

**One difference:** `GET /intel/wallet/:addr` (5cr profile) returns a richer envelope:
```ts
interface IntelProfileResponse {
  status: 'ok';
  walletAddress: string;
  summary: { lastAnalyzedAt, realizedPnl, profitableTradesCount, totalTradesCount, currentSolBalance, knownType, knownLabel };
  hud: WalletHud | null;
  behavior: { tradingStyle, speedCategory, avgHoldTimeHours, medianHoldTimeHours, buySellRatio, exitPattern } | null;
  pnl: { allTime: PnlOverview['allTimeData'] | null, period: ... } | null;
}
```
This is built by `IntelController.buildIntelResponse()` — read `src/api/controllers/intel.controller.ts` lines 137–174 for the exact shape.

---

### What NOT to copy from pft-bot

| Pattern | Why not |
|:--------|:--------|
| `DeferredJobs` + `pending-jobs.json` | File-based job persistence for a polling scan loop. Not needed — Telegraf handles async in-process via `editMessageText`. |
| `Scanner` + `scanner.ts` | pft-bot receives commands via XRPL ledger scan. Telegraf receives them via Telegram long-poll internally. |
| `tsc` build + `dist/` | pft-bot compiles to JS for production. This bot runs via ts-node (same as all other analyzer scripts). |
| `axios` 30s timeout on all calls | pft-bot uses 30s for everything. We need **35s** for GET intel endpoints (above the API's 30s synchronous hold) and **5s** for job poll calls. Set per-method, not globally on the axios instance. |

## Out of Scope (MVP)

- Per-user credit accounts (one API key per Telegram user) — future
- Dashboard for bot usage analytics — future
- `/similarity` command — future
- Per-user rate limiting on the bot side — future (backend already has basic protection)
- Webhook mode (running on HTTPS endpoint) — future; long-polling is fine for MVP
