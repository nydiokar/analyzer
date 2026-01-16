Known Wallet Types - Implementation Outline

  1. Registry (src/config/known-wallets.ts)

  export type KnownWalletType = 'BURN' | 'LP' | 'RAYDIUM' | 'ORCA' | 'JUPITER' | 'PROTOCOL' | 'EXCHANGE' | 'SYSTEM';

  export interface KnownWalletEntry {
    type: KnownWalletType;
    label: string;        // "🔥 Burn Address"
    shortLabel: string;   // "Burn"
  }

  export const KNOWN_WALLETS: Record<string, KnownWalletEntry> = {
    '1nc1nerator11111111111111111111111111111111': {
      type: 'BURN',
      label: '🔥 Burn Address',
      shortLabel: 'Burn',
    },
    // Migrate KNOWN_SYSTEM_WALLETS here with proper types
  };

  export function getKnownWallet(address: string): KnownWalletEntry | null {
    return KNOWN_WALLETS[address] ?? null;
  }

  2. Schema (prisma/schema.prisma)

  model Wallet {
    ...
    classification               String?
  + knownType                    String?   // From registry or dynamic detection
  + knownLabel                   String?   // Display label
    ...
  + @@index([knownType])
  }

  3. SystemWalletDetectionService

  - Import getKnownWallet() from registry
  - Enhance SystemWalletDetectionResult to include knownType, knownLabel
  - In detectSystemWallet(): check registry first, return type info
  - Keep shouldBlock for truly invalid wallets (>70k tokens)

  4. Service-Level Exclusion Constants

  Each service defines what types it excludes:

  // holder-profiles - exclude from aggregate stats (median, etc.)
  const EXCLUDE_FROM_STATS = ['BURN', 'LP', 'RAYDIUM', 'SYSTEM'];

  // similarity - exclude from pairwise comparison
  const EXCLUDE_FROM_SIMILARITY = ['BURN', 'SYSTEM'];

  // pnl-analysis - skip PnL calculation
  const SKIP_PNL = ['BURN', 'LP', 'RAYDIUM', 'ORCA'];

  // token-holders - include ALL (no exclusions, just label)

  5. TokenHoldersService

  - Remove filtering logic
  - Attach knownType + knownLabel to each holder
  - Return all holders with continuous ranking

  6. Processors

  - Early check: get knownType for all wallets (fast lookup)
  - Split into: walletsToAnalyze vs walletsToShowOnly
  - Run expensive ops only on walletsToAnalyze
  - Return both sets in results (show-only wallets have label + analysisSkipped: true)

  7. Frontend WalletBadge

  - Accept knownType, knownLabel props
  - Render label badge when present
  - Optionally dim/hide irrelevant metrics for known system wallets

  ---
  Data Flow Summary

  KNOWN_WALLETS registry (static)
          ↓
  SystemWalletDetectionService (serves it, caches in memory/redis)
          ↓
  Processors/Services (check type, decide what to skip)
          ↓
  API responses include knownType + knownLabel
          ↓
  WalletBadge displays label

  What Gets Skipped vs Shown
  ┌─────────┬───────────────┬───────────────┬──────────────────┬────────────┐
  │  Type   │ Show in Lists │ Calculate PnL │ Include in Stats │ Similarity │
  ├─────────┼───────────────┼───────────────┼──────────────────┼────────────┤
  │ BURN    │ ✓ with label  │ ✗             │ ✗                │ ✗          │
  ├─────────┼───────────────┼───────────────┼──────────────────┼────────────┤
  │ LP      │ ✓ with label  │ ✗             │ ✗                │ ✗          │
  ├─────────┼───────────────┼───────────────┼──────────────────┼────────────┤
  │ RAYDIUM │ ✓ with label  │ ✗             │ ✗                │ ✗          │
  ├─────────┼───────────────┼───────────────┼──────────────────┼────────────┤
  │ JUPITER │ ✓ with label  │ ✗             │ ✗                │ ✗          │
  ├─────────┼───────────────┼───────────────┼──────────────────┼────────────┤
  │ SYSTEM  │ ✓ with label  │ ✗             │ ✗                │ ✗          │
  ├─────────┼───────────────┼───────────────┼──────────────────┼────────────┤
  │ NORMAL  │ ✓             │ ✓             │ ✓                │ ✓          │
  └─────────┴───────────────┴───────────────┴──────────────────┴────────────┘
  ---
  Ready to start when you are.

---
## Cleanup Plan (2026-01-16)

### Problem
Three overlapping classification systems causing redundancy:
1. `shouldBlock` flags (legacy patch)
2. `classification` field (general categorization)
3. `knownType` + SKIP_* sets (registry-based, best approach)

### Goal
Unify on registry + dynamic tagging. Same treatment whether wallet is in registry OR detected dynamically (70k+ tokens).

### Changes

**KILL:**
- `WALLET_CLASSIFICATIONS.INVALID` → use SYSTEM
- `WALLET_CLASSIFICATIONS.JUPITER` → redundant with knownType
- `SystemWalletDetectionResult.shouldBlock`
- `SystemWalletDetectionResult.isSystemWallet`
- `SystemWalletDetectionResult.isLargeWallet`
- `SYSTEM_WALLET_DETECTION_CONFIG.BLOCK_SYSTEM_WALLETS`

**DYNAMIC TAGGING:**
- 70k+ tokens → `classification='SYSTEM'`, `knownType='SYSTEM'`, `knownLabel='⚙️ System Account'`
- 15k-70k tokens → `classification='LARGE'` only (NO knownType, still analyzed)

**UNIFIED RULE:**
- Any wallet with `knownType` → Skip sync, skip analysis, show with label
- LARGE wallets → Tag for monitoring, analyze normally
- Bot detection → Leave untouched (not integrated with knownType)

**FILES TOUCHED:**
1. `src/config/constants.ts` - Remove INVALID, JUPITER, BLOCK_SYSTEM_WALLETS
2. `src/api/services/system-wallet-detection.service.ts` - Remove shouldBlock flags, add dynamic knownType tagging
3. `src/core/services/helius-sync-service.ts` - Check knownType instead of classification='INVALID'
4. `src/queues/processors/analysis-operations.processor.ts` - Verify knownType usage
5. `src/queues/processors/similarity-operations.processor.ts` - Verify EXCLUDE_FROM_SIMILARITY usage