/**
 * Token Metadata Aggregator
 *
 * Merges token metadata from multiple sources with correct priority:
 * - Display fields (name, symbol, image): ONCHAIN FIRST (authoritative)
 * - Trading data (price, volume, marketCap): DEXSCREENER ONLY
 * - Social links: DEXSCREENER FIRST (more up-to-date), fallback to onchain
 */

export interface TokenInfo {
  tokenAddress: string;

  // DexScreener fields
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;

  // DexScreener market data
  priceUsd?: string | null;
  volume24h?: number | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
  dexscreenerUpdatedAt?: Date | null;

  // Onchain metadata (PRIMARY for display)
  onchainName?: string | null;
  onchainSymbol?: string | null;
  onchainDescription?: string | null;
  onchainImageUrl?: string | null;
  onchainCreator?: string | null;
  onchainTwitterUrl?: string | null;
  onchainWebsiteUrl?: string | null;
  onchainTelegramUrl?: string | null;
  onchainDiscordUrl?: string | null;
  onchainBasicFetchedAt?: Date | null;

  metadataSource?: string | null;
}

export interface DisplayMetadata {
  // Basic metadata - prefer onchain, fallback to dexscreener
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string | null;

  // Trading data - DexScreener only
  priceUsd?: string | null;
  volume24h?: number | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;

  // Social links - prefer DexScreener (more up-to-date), fallback to onchain
  twitter: string | null;
  website: string | null;
  telegram: string | null;
  discord: string | null;

  // Metadata source for debugging
  metadataSource?: string | null;
  creator?: string | null;
}

function truncateMint(mint: string): string {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

/**
 * Merge DexScreener and onchain metadata for display
 * Priority: ONCHAIN FIRST for display fields (name, symbol, image)
 */
export function getDisplayMetadata(token: TokenInfo): DisplayMetadata {
  return {
    // Basic metadata - prefer onchain (authoritative), fallback to dexscreener
    name: token.onchainName || token.name || 'Unknown Token',
    symbol: token.onchainSymbol || token.symbol || truncateMint(token.tokenAddress),
    imageUrl: token.onchainImageUrl || token.imageUrl || null,
    description: token.onchainDescription || null, // Onchain only

    // Trading data - DexScreener only
    priceUsd: token.priceUsd,
    volume24h: token.volume24h,
    marketCapUsd: token.marketCapUsd,
    liquidityUsd: token.liquidityUsd,

    // Social links - prefer DexScreener (more up-to-date), fallback to onchain
    twitter: token.twitterUrl || token.onchainTwitterUrl || null,
    website: token.websiteUrl || token.onchainWebsiteUrl || null,
    telegram: token.telegramUrl || token.onchainTelegramUrl || null,
    discord: token.onchainDiscordUrl || null, // Onchain only

    // Metadata source for debugging
    metadataSource: token.metadataSource,
    creator: token.onchainCreator || null, // Onchain only
  };
}

/**
 * Batch process multiple tokens with display metadata
 */
export function getDisplayMetadataBatch(tokens: TokenInfo[]): Map<string, DisplayMetadata> {
  const result = new Map<string, DisplayMetadata>();

  for (const token of tokens) {
    result.set(token.tokenAddress, getDisplayMetadata(token));
  }

  return result;
}
