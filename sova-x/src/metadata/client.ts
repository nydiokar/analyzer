import type { TokenMetadata } from '../types/holder-profiles';

export interface TokenMetadataClient {
  getTokenMetadata(mint: string): Promise<TokenMetadata>;
}

export class StubTokenMetadataClient implements TokenMetadataClient {
  async getTokenMetadata(mint: string): Promise<TokenMetadata> {
    return {
      mint,
      symbol: null,
      name: null,
      imageUrl: null,
    };
  }
}

type DexscreenerResponse = {
  pairs?: Array<{
    fdv?: number | null;
    marketCap?: number | null;
    info?: {
      imageUrl?: string | null;
    };
    baseToken?: {
      address?: string;
      symbol?: string | null;
      name?: string | null;
    };
  }>;
};

export class DexscreenerTokenMetadataClient implements TokenMetadataClient {
  async getTokenMetadata(mint: string): Promise<TokenMetadata> {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`);
      if (!response.ok) {
        return this.fallback(mint);
      }

      const payload = (await response.json()) as DexscreenerResponse;
      const pairs = payload.pairs ?? [];
      const exactMatches = pairs.filter((pair) => pair.baseToken?.address === mint);
      const candidate = chooseBestPair(exactMatches.length > 0 ? exactMatches : pairs);

      if (!candidate) {
        return this.fallback(mint);
      }

      return {
        mint,
        symbol: candidate.baseToken?.symbol ?? null,
        name: candidate.baseToken?.name ?? null,
        imageUrl: candidate.info?.imageUrl ?? null,
      };
    } catch {
      return this.fallback(mint);
    }
  }

  private fallback(mint: string): TokenMetadata {
    return {
      mint,
      symbol: null,
      name: null,
      imageUrl: null,
    };
  }
}

function chooseBestPair(
  pairs: Array<{
    fdv?: number | null;
    marketCap?: number | null;
    info?: { imageUrl?: string | null };
    baseToken?: { address?: string; symbol?: string | null; name?: string | null };
  }>,
) {
  if (pairs.length === 0) {
    return null;
  }

  return [...pairs].sort((a, b) => {
    const aScore = Math.max(a.marketCap ?? 0, a.fdv ?? 0);
    const bScore = Math.max(b.marketCap ?? 0, b.fdv ?? 0);
    return bScore - aScore;
  })[0];
}
