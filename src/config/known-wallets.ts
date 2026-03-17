/**
 * Known Wallet Registry — Local Overrides
 *
 * This is a small, curated set of wallet addresses that either:
 * - Helius Identity API doesn't cover (burn addresses, niche vaults)
 * - Need custom labels that differ from what Helius provides
 *
 * The bulk of wallet identification (5,100+ accounts, 1,900+ programs)
 * is handled dynamically by HeliusIdentityResolver at runtime.
 * Only add entries here when Helius doesn't recognize them.
 */

export type KnownWalletType =
  | 'BURN'
  | 'LP'
  | 'PROTOCOL'
  | 'EXCHANGE'
  | 'SYSTEM';

export interface KnownWalletEntry {
  type: KnownWalletType;
  label: string;       // Full display label (e.g., "🔥 Burn Address")
  shortLabel: string;  // Compact label for tables (e.g., "Burn")
}

/**
 * Static registry of known wallet addresses
 *
 * Keys are wallet addresses, values describe the wallet type and display labels.
 * Add new entries here as they're discovered.
 */
export const KNOWN_WALLETS: Record<string, KnownWalletEntry> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // BURN ADDRESSES (Helius doesn't tag these)
  // ═══════════════════════════════════════════════════════════════════════════
  '1nc1nerator11111111111111111111111111111111': {
    type: 'BURN',
    label: 'Burn Address',
    shortLabel: 'Burn',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL OVERRIDES
  // Only for wallets Helius doesn't recognize or where we need a custom label.
  // The vast majority of exchanges, protocols, and programs are now resolved
  // dynamically via HeliusIdentityResolver (5,100+ accounts, 1,900+ programs).
  // ═══════════════════════════════════════════════════════════════════════════
  'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM': {
    type: 'PROTOCOL',
    label: 'BAGS VAULT',
    shortLabel: 'Bags',
  },
};

/**
 * Lookup a wallet address in the registry
 * @returns KnownWalletEntry if found, null otherwise
 */
export function getKnownWallet(address: string): KnownWalletEntry | null {
  return KNOWN_WALLETS[address] ?? null;
}

/**
 * Check if an address is a known wallet (fast O(1) lookup)
 */
export function isKnownWallet(address: string): boolean {
  return address in KNOWN_WALLETS;
}

/**
 * Get all addresses of a specific type
 */
export function getAddressesByType(type: KnownWalletType): string[] {
  return Object.entries(KNOWN_WALLETS)
    .filter(([, entry]) => entry.type === type)
    .map(([address]) => address);
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE-LEVEL EXCLUSION SETS
// Each service defines which wallet types to exclude from its operations
// ═══════════════════════════════════════════════════════════════════════════

/** Wallet types to exclude from aggregate statistics (medians, averages, etc.) */
export const EXCLUDE_FROM_STATS: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'PROTOCOL',
  'SYSTEM',
]);

/** Wallet types to exclude from similarity pairwise comparison */
export const EXCLUDE_FROM_SIMILARITY: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'SYSTEM',
  'PROTOCOL',
  'LP',
]);

/** Wallet types to skip PnL calculation entirely */
export const SKIP_PNL_CALCULATION: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'PROTOCOL',
  'EXCHANGE',
  'SYSTEM',
]);

/** Wallet types to skip behavior analysis */
export const SKIP_BEHAVIOR_ANALYSIS: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'PROTOCOL',
  'EXCHANGE',
  'SYSTEM',
]);

/**
 * Helper to check if a wallet should be excluded from a given operation
 */
export function shouldExcludeFromOperation(
  address: string,
  exclusionSet: ReadonlySet<KnownWalletType>,
): boolean {
  const entry = getKnownWallet(address);
  if (!entry) return false;
  return exclusionSet.has(entry.type);
}
