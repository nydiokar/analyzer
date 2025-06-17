/**
 * Centralized well-known token metadata utility
 * Consolidates token information used across the application
 */

export interface WellKnownTokenMetadata {
  name: string;
  symbol: string;
  decimals?: number;
  isStablecoin?: boolean;
}

// Comprehensive mapping of well-known token addresses to their metadata
export const WELL_KNOWN_TOKENS: Record<string, WellKnownTokenMetadata> = {
  // SOL and SOL derivatives
  'So11111111111111111111111111111111111111112': { 
    name: 'Wrapped SOL', 
    symbol: 'SOL', 
    decimals: 9 
  },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { 
    name: 'Marinade staked SOL', 
    symbol: 'mSOL', 
    decimals: 9 
  },
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': { 
    name: 'Lido Staked SOL', 
    symbol: 'stSOL', 
    decimals: 9 
  },

  // Stablecoins
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { 
    name: 'USD Coin', 
    symbol: 'USDC', 
    decimals: 6, 
    isStablecoin: true 
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { 
    name: 'Tether USD', 
    symbol: 'USDT', 
    decimals: 6, 
    isStablecoin: true 
  },

  // Major DeFi tokens
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { 
    name: 'Raydium', 
    symbol: 'RAY', 
    decimals: 6 
  },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { 
    name: 'Jupiter', 
    symbol: 'JUP', 
    decimals: 6 
  },
  'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt': { 
    name: 'Serum', 
    symbol: 'SRM', 
    decimals: 6 
  },
  'MNGOqteHZHzPPrfS6ssow9Bp1bF1Mnt2LhqKDe5NNy5': { 
    name: 'Mango', 
    symbol: 'MNGO', 
    decimals: 6 
  },

  // Other tokens
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { 
    name: 'Bonk', 
    symbol: 'BONK', 
    decimals: 5 
  },
  'rndrizKT3MK1iimdxRdWabcF7Zb7nx9Vi3CY6A5J9NK': { 
    name: 'Render Token', 
    symbol: 'RNDR', 
    decimals: 8 
  },
  'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT': { 
    name: 'Step Finance', 
    symbol: 'STEP', 
    decimals: 9 
  },
  '8PMHT4swUMtBzgHnh5U564N5sjPSiUz2cjEQzFnnP1Fo': { 
    name: 'Rope Token', 
    symbol: 'ROPE', 
    decimals: 9 
  },
  '8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh': { 
    name: 'Cope', 
    symbol: 'COPE', 
    decimals: 6 
  },
  'EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp': { 
    name: 'Fida', 
    symbol: 'FIDA', 
    decimals: 6 
  },
  'kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6': { 
    name: 'Kin', 
    symbol: 'KIN', 
    decimals: 5 
  },
};

/**
 * Get metadata for a well-known token by its address
 */
export function getWellKnownTokenMetadata(tokenAddress: string): WellKnownTokenMetadata | null {
  return WELL_KNOWN_TOKENS[tokenAddress] || null;
}

/**
 * Check if a token is a well-known token
 */
export function isWellKnownToken(tokenAddress: string): boolean {
  return tokenAddress in WELL_KNOWN_TOKENS;
}

/**
 * Get display name for a token (symbol if well-known, shortened address otherwise)
 */
export function getTokenDisplayName(tokenAddress: string): string {
  const metadata = getWellKnownTokenMetadata(tokenAddress);
  return metadata?.symbol || `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
}

/**
 * Get full name for a token (name if well-known, shortened address otherwise)
 */
export function getTokenFullName(tokenAddress: string): string {
  const metadata = getWellKnownTokenMetadata(tokenAddress);
  return metadata?.name || `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
}

/**
 * Check if a token is a stablecoin
 */
export function isStablecoin(tokenAddress: string): boolean {
  const metadata = getWellKnownTokenMetadata(tokenAddress);
  return metadata?.isStablecoin === true;
}

/**
 * Get all well-known stablecoin addresses
 */
export function getStablecoinAddresses(): string[] {
  return Object.keys(WELL_KNOWN_TOKENS).filter(address => 
    WELL_KNOWN_TOKENS[address].isStablecoin
  );
}

/**
 * Get all well-known token addresses
 */
export function getAllWellKnownTokenAddresses(): string[] {
  return Object.keys(WELL_KNOWN_TOKENS);
} 