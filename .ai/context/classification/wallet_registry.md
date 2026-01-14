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