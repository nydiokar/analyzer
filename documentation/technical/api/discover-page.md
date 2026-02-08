# Discover Page & API (lightweight behavior-first picks)

Scope: small, cached discover surface using existing aggregates only. No raw tx scans or new jobs.

## Backend endpoint
- `GET /api/v1/discover/wallets`
- Query params (all optional, cached fields only):
  - `sort`: interesting (default) | most_active | best_pnl | longest_holders | recently_updated
  - `style`: behaviorProfile.tradingStyle (flipper | swing | position | holder | scalper | sniper)
  - `holdBias`: medianHoldTime buckets (short <12h | medium 12–72h | long >72h)
  - `minTradeCount`, `minUniqueTokens`
  - `minFreshnessHours`: filters on `pnlSummary.updatedAt` OR `behaviorProfile.updatedAt`
  - `page`, `pageSize` (10–40), `timeframe` (accepted, only `all` used)
- Data source: Prisma findMany over `Wallet` with includes for `pnlSummary -> advancedStats` and `behaviorProfile`; indexed columns only.
- Ordering (interesting): flipperScore ↓, medianHoldTime ↓, tradingStyle asc, uniqueTokensTraded ↓, totalTradeCount ↓, realizedPnl ↓, updatedAt ↓, address asc (tie-breaker).
- Reason mapping (explainable labels): FLIPPER, HOLDER, EXPLORER, RECENT, PNL, INTERESTING; uses behavior signals first, PnL only as fallback.

## Frontend behavior (dashboard `/discover`)
- LocalStorage cache (5m TTL) for fast first paint; skeletons for cold load; refresh button shows spinner.
- Filters/controls: sort select, style select, hold-bias select, min trades, min unique tokens, freshness.
- Preset chips (no new API):
  - Hyper flipper: style=flipper, holdBias=short, minTradeCount=20, minUniqueTokens=5, minFreshnessHours=72.
  - Balanced fast: style=swing, holdBias=medium, minTradeCount=30, minUniqueTokens=8.
  - Patient holder: style=holder, holdBias=long, minTradeCount=10, minUniqueTokens=3, minFreshnessHours=168.
- Cards: reason badge, staleness, short address + copy, style label; metrics with tooltips (PnL, win rate, unique tokens, avg/median hold, trades, last active).
- Navigation: “View” links to `/wallets/{address}`; pagination 24/page.

## Notes / Constraints
- Uses only cached summaries; no background jobs triggered.
- Time buckets (from config): ULTRA_FAST/VERY_FAST <1m, FAST 1–5m, MOMENTUM 5–30m, MODERATE 30–60m, INTRADAY 1–4h, DAY_TRADER 4–8h, DAY 8–24h, SWING 1–7d, POSITION >7d. FlipperScore leverages the fast buckets; hold bias uses medianHoldTime.
- Server cache: `Cache-Control: public, max-age=120`.
