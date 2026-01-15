/**
 * Known Wallet Registry
 *
 * Central registry for known wallet types (burn addresses, LPs, DEX vaults, etc.)
 * Used to:
 * - Label wallets in holder lists and UI
 * - Skip expensive analysis operations on non-trader wallets
 * - Keep consistent classification across services
 */

export type KnownWalletType =
  | 'BURN'
  | 'LP'
  | 'RAYDIUM'
  | 'ORCA'
  | 'JUPITER'
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
  // BURN ADDRESSES
  // ═══════════════════════════════════════════════════════════════════════════
  '1nc1nerator11111111111111111111111111111111': {
    type: 'BURN',
    label: '🔥 Burn Address',
    shortLabel: 'Burn',
  },
  'gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB': {
    type: 'JUPITER',
    label: '🪐 Jupiter: Gas Wallet',
    shortLabel: 'Jupiter',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // JUPITER AGGREGATOR ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  '2MFoS3MPtvyQ4Wh4M9pdfPjz6UhVoNbFbGJAskCPCj3h': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '3CgvbiM3op4vjrrjH2zcrQUwsqh5veNVRjFCB9N6sRoD': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '3LoAYHuSd7Gh8d7RTFnhvYtiTiefdZ5ByamU42vkzd76': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '4xDsmeTWPNjgSVSS1VTfzFq3iHZhp77ffPkAmkZkdu71': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '69yhtoJR4JYPPABZcSNkzuqbaFbwHsCkja1sP1Q2aVT5': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '6U91aKa8pmMxkJwBCfPTmUEfZi6dHe7DcFq2ALvB2tbB': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '7iWnBRRhBCiNXXPhqiGzvvBkKrvFSWqqmxRyu9VyYBxE': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '9nnLbotNTcUhvbrsA6Mdkx45Sm82G35zo28AqUvjExn8': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'CapuXNQoDviLvU1PxFiizLgPNQCxrsag1uMeyk6zLVps': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'DSN3j1ykL3obAVNv7ZX49VsFCPe4LqzxHnmtLiPwY6xg': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'GGztQqQ6pCPaJQnNpXBgELr5cs3WwDakRbh1iEMzjgSJ': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'GP8StUXNYSZjPikyRsvkTbvRV1GBxMErb59cpeCJnDf1': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'HFqp6ErWHY6Uzhj8rFyjYuDya2mXUpYEk8VW75K9PSiY': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'HU23r7UoZbqTUuh3vA7emAGztFtqwTeVips789vqxxBw': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'Jx2c1k5iYrtk52KeBPSykEutbUMfS4Sjv9kmZm33LKn': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },
  '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp': {
    type: 'JUPITER',
    label: '🪐 Jupiter Referral Vault',
    shortLabel: 'Jupiter',
  },
  'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC': {
    type: 'JUPITER',
    label: '🪐 Jupiter Referral Vault',
    shortLabel: 'Jupiter',
  },
  'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM': {
    type: 'JUPITER',
    label: '🪐 Jupiter Aggregator Authority',
    shortLabel: 'Jupiter',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RAYDIUM ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL': {
    type: 'RAYDIUM',
    label: '💧 Raydium Vault',
    shortLabel: 'Raydium',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM / LARGE TOKEN ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  '34FKjAdVcTax2DHqV2XnbXa9J3zmyKcFuFKWbcmgxjgm': {
    type: 'SYSTEM',
    label: '⚙️ System Account',
    shortLabel: 'System',
  },
  'ZG98FUCjb8mJ824Gbs6RsgVmr1FhXb2oNiJHa2dwmPd': {
    type: 'SYSTEM',
    label: '⚙️ System Account',
    shortLabel: 'System',
  },
  '8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf': {
    type: 'SYSTEM',
    label: '⚙️ System Account',
    shortLabel: 'System',
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
  'RAYDIUM',
  'ORCA',
  'SYSTEM',
]);

/** Wallet types to exclude from similarity pairwise comparison */
export const EXCLUDE_FROM_SIMILARITY: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'SYSTEM',
  'JUPITER',
  'RAYDIUM',
  'ORCA',
  'LP',
]);

/** Wallet types to skip PnL calculation entirely */
export const SKIP_PNL_CALCULATION: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'RAYDIUM',
  'ORCA',
  'JUPITER',
  'SYSTEM',
]);

/** Wallet types to skip behavior analysis */
export const SKIP_BEHAVIOR_ANALYSIS: ReadonlySet<KnownWalletType> = new Set([
  'BURN',
  'LP',
  'RAYDIUM',
  'ORCA',
  'JUPITER',
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
