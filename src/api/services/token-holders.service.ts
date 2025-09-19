import { Injectable, Logger } from '@nestjs/common';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import type { GetTokenLargestAccountsResult, TokenLargestAccount, GetMultipleAccountsResult } from '../../types/helius-api';

export interface TopHoldersResponse {
  mint: string;
  context: { slot: number; apiVersion?: string };
  holders: Array<{
    tokenAccount: string;
    ownerAccount?: string;
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
    rank: number;
  }>;
}

@Injectable()
export class TokenHoldersService {
  private readonly logger = new Logger(TokenHoldersService.name);

  constructor(private readonly heliusClient: HeliusApiClient) {}

  async getTopHolders(mint: string, commitment?: string): Promise<TopHoldersResponse> {
    const rpcResult: GetTokenLargestAccountsResult = await this.heliusClient.getTokenLargestAccounts(mint, commitment);

    const tokenAccountPubkeys = rpcResult.value.map((v) => v.address);

    // Resolve owner wallets for each token account via getMultipleAccounts (jsonParsed)
    let owners: (string | undefined)[] = new Array(tokenAccountPubkeys.length).fill(undefined);
    try {
      if (tokenAccountPubkeys.length > 0) {
        const multi: GetMultipleAccountsResult = await this.heliusClient.getMultipleAccounts(
          tokenAccountPubkeys,
          commitment,
          'jsonParsed'
        );
        owners = multi.value.map((acc: any) => acc?.data?.parsed?.info?.owner as string | undefined);
      }
    } catch (e) {
      this.logger.warn('Failed to resolve token account owners; returning token accounts only');
    }

    const holdersWithRank = rpcResult.value.map((acc: TokenLargestAccount, idx: number) => ({
      tokenAccount: acc.address,
      ownerAccount: owners[idx],
      amount: acc.amount,
      decimals: acc.decimals,
      uiAmount: acc.uiAmount,
      uiAmountString: acc.uiAmountString,
      rank: idx + 1,
    }));

    return {
      mint,
      context: rpcResult.context,
      holders: holdersWithRank,
    };
  }
}


