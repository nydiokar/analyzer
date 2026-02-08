import { TokenInfo, Prisma } from "@prisma/client";

export interface TokenEnrichmentPlan {
  tokenAddresses: string[];
  existingTokens: TokenInfo[];
  needsEnrichment: string[];
  needsOnchainData: string[];
  needsPriceData: string[];
  newTokens: string[];
  staleTokens: string[];
}

export interface ITokenInfoService {
  getTokenEnrichmentPlan(tokenAddresses: string[]): Promise<TokenEnrichmentPlan>;
  triggerTokenInfoEnrichment(tokenAddresses: string[], userId: string, plan?: TokenEnrichmentPlan): Promise<void>;
  findMany(tokenAddresses: string[]): Promise<TokenInfo[]>;
  upsertMany(data: Prisma.TokenInfoCreateInput[]): Promise<void>;
} 
