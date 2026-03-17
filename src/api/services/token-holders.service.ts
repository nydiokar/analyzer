import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { HeliusIdentityResolver } from '../../core/services/helius-identity-resolver';
import type { GetTokenLargestAccountsResult, TokenLargestAccount, GetMultipleAccountsResult, RpcAccountInfo } from '../../types/helius-api';
import { getKnownWallet, type KnownWalletType } from '../../config/known-wallets';
import { getErrorMessage } from 'core/utils/error-utils';

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
  supply?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

@Injectable()
export class TokenHoldersService {
  private readonly logger = new Logger(TokenHoldersService.name);

  constructor(
    private readonly heliusClient: HeliusApiClient,
    private readonly identityResolver: HeliusIdentityResolver,
  ) {}

  async getTopHolders(mint: string, commitment?: string): Promise<TopHoldersResponse> {
    let rpcResult: GetTokenLargestAccountsResult;
    try {
      rpcResult = await this.heliusClient.getTokenLargestAccounts(mint, commitment);
    } catch (error) {
      if ((error as Error)?.name === 'InvalidRpcInputError') {
        throw new NotFoundException(`Token mint not found: ${mint}`);
      }
      throw error;
    }

    // Fetch token supply for percentage calculations
    let supply: { amount: string; decimals: number; uiAmount: number | null; uiAmountString: string } | undefined;
    try {
      const supplyResult = await this.heliusClient.getTokenSupply(mint, commitment);
      supply = supplyResult.value;
    } catch (error) {
      if ((error as Error)?.name === 'InvalidRpcInputError') {
        supply = undefined;
      } else {
      this.logger.warn(`Failed to fetch token supply for ${mint}, percentages will not be available: ${getErrorMessage(error)}`);
      }
    }

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

    // Phase 1: Label from local registry
    const unlabeledOwners: string[] = [];
    for (let idx = 0; idx < rpcResult.value.length; idx++) {
      const acc = rpcResult.value[idx];
      const owner = owners[idx];

      const holder: HolderWithLabel = {
        tokenAccount: acc.address,
        ownerAccount: owner,
        amount: acc.amount,
        decimals: acc.decimals,
        uiAmount: acc.uiAmount,
        uiAmountString: acc.uiAmountString,
        rank: rank++,
      };

      if (owner) {
        const knownEntry = getKnownWallet(owner);
        if (knownEntry) {
          holder.knownType = knownEntry.type;
          holder.knownLabel = knownEntry.label;
        } else {
          unlabeledOwners.push(owner);
        }
      }

      holdersWithLabels.push(holder);
    }

    // Phase 2: Batch-resolve unlabeled owners via Helius Identity API
    let heliusIdentities = new Map<string, import('../../config/known-wallets').KnownWalletEntry>();
    if (unlabeledOwners.length > 0) {
      try {
        heliusIdentities = await this.identityResolver.resolveBatch(unlabeledOwners);
      } catch (e) {
        this.logger.debug(`Helius identity batch lookup failed: ${getErrorMessage(e)}`);
      }
    }

    // Phase 3: Apply Helius identities + on-chain heuristic fallback
    for (const holder of holdersWithLabels) {
      if (holder.knownType || !holder.ownerAccount) continue; // already labeled or no owner

      const heliusEntry = heliusIdentities.get(holder.ownerAccount);
      if (heliusEntry) {
        holder.knownType = heliusEntry.type;
        holder.knownLabel = heliusEntry.label;
        continue;
      }

      // On-chain heuristic fallback for program-owned accounts
      const info = ownerAccountInfo[holder.ownerAccount];
      if (info) {
        const programOwner = info.owner;
        const isProgramOwned = programOwner && programOwner !== SYSTEM_PROGRAM_ID;
        const hasNonEmptyData = Array.isArray((info as any).data) && typeof (info as any).data[0] === 'string'
          ? (info as any).data[0].length > 0
          : false;
        const isExecutable = Boolean((info as any).executable);

        if (programOwner === STREAMFLOW_PROGRAM_ID) {
          holder.knownType = 'PROTOCOL';
          holder.knownLabel = 'Lock Vault';
        } else if (isProgramOwned || hasNonEmptyData || isExecutable) {
          holder.knownType = 'LP';
          holder.knownLabel = 'LIQ POOL';
        }
      }
    }

    return {
      mint,
      context: rpcResult.context,
      holders: holdersWithLabels,
      supply,
    };
  }
}

