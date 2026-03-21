# Technical Content Writer — Memory

## Verified SDK Ground Truth (@sova-intel/sdk@0.1.1)

**Client class:** `SovaIntelClient` (NOT `SovaIntel`)
**Constructor:** `new SovaIntelClient({ baseUrl, auth: { kind: "apikey", apiKey } })`
**Methods:** `getWalletHud(addr)`, `getWalletProfile(addr)`, `getWalletTokens(addr, params?)`,
  `batchHud(wallets[])`, `pollHolderProfiles(mint, topN?)`, `queueHolderProfiles(mint, topN?)`,
  `pollSimilarity(wallets[])`, `queueSimilarity(wallets[])`

**HUD fields (real):** `behaviorCode`, `medianHoldTimeHours`, `trimmedMeanPnl`, `isBot`, `isWhale`, `dataQualityTier`
**HUD fields (fabricated — never use):** `speedCategory`, `winRate`, `totalPnlUsd`, `medianHoldTimeSeconds`, `exitPattern`

**Holders response:** array field is `profiles` (NOT `holders`); per-profile: `behaviorType` (NOT `behaviorCode`),
  `confidence` (NOT `dataQualityTier`), `completedCycleCount`, `walletPnlSol`; NO `distribution` object

**Similarity response:** array field is `pairwiseSimilarities` (NOT `pairs`); per-pair: `binarySharedTokenCount`
  (NOT `sharedTokenCount`), `binaryScore`, `capitalScore`; globalMetrics has `averageSimilarity` + `mostSimilarPairs`;
  NO `clusterCount` field

**Job status string:** `"complete"` (NOT `"completed"`)

## Style Decisions

- Guide target audience: Solana AI agent builders (NOT Telegram bot users)
- Code examples: TypeScript first, curl as fallback
- No financial advice framing — frame as intelligence/signal, not buy/sell recommendation
- Always include `dataQualityTier` / `confidence` tier interpretation — it's a product moat
- Guides should stay under 1500 words — trim intro/tables first, preserve decision functions

## Content Published

- `.claude/drafts/guides/agent-wallet-intelligence-guide.md` — W1D1 draft, SDK-corrected 2026-03-21, awaiting founder review
