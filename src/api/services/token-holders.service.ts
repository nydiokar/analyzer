import { Injectable, Logger } from '@nestjs/common';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import type { GetTokenLargestAccountsResult, TokenLargestAccount, GetMultipleAccountsResult, RpcAccountInfo } from '../../types/helius-api';
import { KNOWN_SYSTEM_WALLETS } from '../../config/constants';

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
    // Map of ownerAccount -> RpcAccountInfo for program/system detection
    const ownerAccountInfo: Record<string, RpcAccountInfo | undefined> = {};
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

    // Best-effort pass: fetch account info for owner accounts to identify AMM/system PDAs
    try {
      const uniqueOwners = Array.from(new Set(owners.filter(Boolean) as string[]));
      if (uniqueOwners.length > 0) {
        const ownersInfo: GetMultipleAccountsResult = await this.heliusClient.getMultipleAccounts(
          uniqueOwners,
          commitment,
          'base64'
        );
        ownersInfo.value.forEach((info, idx) => {
          const key = uniqueOwners[idx];
          ownerAccountInfo[key] = info as unknown as RpcAccountInfo;
        });
      }
    } catch (e) {
      this.logger.warn('Failed to fetch owner account infos for system filtering. Proceeding without filter.');
    }

    const holdersWithRankRaw = rpcResult.value.map((acc: TokenLargestAccount, idx: number) => ({
      tokenAccount: acc.address,
      ownerAccount: owners[idx],
      amount: acc.amount,
      decimals: acc.decimals,
      uiAmount: acc.uiAmount,
      uiAmountString: acc.uiAmountString,
      rank: idx + 1,
    }));

    // Filter out owner accounts that are clearly program-owned (AMM PDAs) or known system wallets
    const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
    const knownSystemSet: Set<string> = new Set<string>(KNOWN_SYSTEM_WALLETS as readonly string[]);
    const holdersWithRank = holdersWithRankRaw.filter((h) => {
      const owner = h.ownerAccount;
      if (!owner) return true; // If no owner resolved, keep; frontend can toggle ownersOnly
      if (knownSystemSet.has(owner)) return false;
      const info = ownerAccountInfo[owner];
      if (!info) return true; // If we couldn't fetch, be conservative but still drop obvious system wallets above

      const isProgramOwned = info.owner && info.owner !== SYSTEM_PROGRAM_ID;
      const hasNonEmptyData = Array.isArray((info as any).data) && typeof (info as any).data[0] === 'string'
        ? (info as any).data[0].length > 0
        : false;
      const isExecutable = Boolean((info as any).executable);

      // Wallets should be system-owned, non-executable, and have empty data
      if (isProgramOwned || hasNonEmptyData || isExecutable) {
        return false;
      }

      return true;
    });

    return {
      mint,
      context: rpcResult.context,
      holders: holdersWithRank,
    };
  }
}

