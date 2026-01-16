import { Injectable, Logger } from '@nestjs/common';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import type { GetTokenLargestAccountsResult, TokenLargestAccount, GetMultipleAccountsResult, RpcAccountInfo } from '../../types/helius-api';
import { getKnownWallet, type KnownWalletType } from '../../config/known-wallets';

// Known program IDs for special detection
const STREAMFLOW_PROGRAM_ID = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';

export interface HolderWithLabel {
  tokenAccount: string;
  ownerAccount?: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
  rank: number;
  knownType?: KnownWalletType;
  knownLabel?: string;
}

export interface TopHoldersResponse {
  mint: string;
  context: { slot: number; apiVersion?: string };
  holders: HolderWithLabel[];
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

    // Build holders with labels instead of filtering
    // Labels allow the UI to show/hide or style known wallets appropriately
    const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
    const holdersWithLabels: HolderWithLabel[] = [];
    let rank = 1;

    for (let idx = 0; idx < rpcResult.value.length; idx++) {
      const acc = rpcResult.value[idx];
      const owner = owners[idx];

      // Build the holder entry with basic info
      const holder: HolderWithLabel = {
        tokenAccount: acc.address,
        ownerAccount: owner,
        amount: acc.amount,
        decimals: acc.decimals,
        uiAmount: acc.uiAmount,
        uiAmountString: acc.uiAmountString,
        rank: rank++,
      };

      // Attach known wallet label if this owner is in the registry
      if (owner) {
        const knownEntry = getKnownWallet(owner);
        if (knownEntry) {
          holder.knownType = knownEntry.type;
          holder.knownLabel = knownEntry.label;
        } else {
          // Check if this is a program-owned account (AMM PDA, lock vault, etc.)
          const info = ownerAccountInfo[owner];
          if (info) {
            const programOwner = info.owner;
            const isProgramOwned = programOwner && programOwner !== SYSTEM_PROGRAM_ID;
            const hasNonEmptyData = Array.isArray((info as any).data) && typeof (info as any).data[0] === 'string'
              ? (info as any).data[0].length > 0
              : false;
            const isExecutable = Boolean((info as any).executable);

            // Check for specific programs first (Streamflow lock vaults, etc.)
            if (programOwner === STREAMFLOW_PROGRAM_ID) {
              holder.knownType = 'PROTOCOL';
              holder.knownLabel = '🔒 Lock Vault';
            }
            // Generic program-owned accounts → treat as LP/Protocol
            else if (isProgramOwned || hasNonEmptyData || isExecutable) {
              holder.knownType = 'LP';
              holder.knownLabel = 'LIQ POOL 💧';
            }
          }
        }
      }

      holdersWithLabels.push(holder);
    }

    return {
      mint,
      context: rpcResult.context,
      holders: holdersWithLabels,
    };
  }
}

