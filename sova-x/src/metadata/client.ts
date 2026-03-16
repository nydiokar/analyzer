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
