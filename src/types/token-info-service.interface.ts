import { TokenInfo, Prisma } from "@prisma/client";

export interface ITokenInfoService {
  triggerTokenInfoEnrichment(tokenAddresses: string[], userId: string): Promise<void>;
  findMany(tokenAddresses: string[]): Promise<TokenInfo[]>;
  upsertMany(data: Prisma.TokenInfoCreateInput[]): Promise<void>;
} 