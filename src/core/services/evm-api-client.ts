import axios, { AxiosInstance } from 'axios';
import { EvmTransaction, EvmLog, EvmChain } from '@/types/evm-api';
import { createLogger } from 'core/utils/logger';
import { Injectable } from '@nestjs/common';

const logger = createLogger('EvmApiClient');

// RPC endpoints per chain (configure via env)
const DEFAULT_RPC_URLS: Record<EvmChain, string> = {
  ethereum: 'https://eth-mainnet.g.alchemy.com/v2',
  arbitrum: 'https://arb-mainnet.g.alchemy.com/v2',
  base: 'https://base-mainnet.g.alchemy.com/v2',
};

export interface EvmApiClientConfig {
  alchemyApiKey?: string;
  moralisApiKey?: string;
  // Override RPC URLs per chain
  rpcUrls?: Partial<Record<EvmChain, string>>;
}

export interface FetchTransactionsOptions {
  fromBlock?: number;
  toBlock?: number | 'latest';
  maxCount?: number;
}

// Alchemy getAssetTransfers response shapes
interface AlchemyTransferItem {
  blockNum: string;
  uniqueId: string;
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  erc721TokenId: string | null;
  erc1155Metadata: null;
  tokenId: string | null;
  asset: string | null;
  category: string;
  rawContract: {
    value: string | null;
    address: string | null;
    decimal: string | null;
  };
  metadata?: {
    blockTimestamp?: string;
  };
}

interface AlchemyResponse<T> {
  jsonrpc: string;
  id: number;
  result: T;
}

@Injectable()
export class EvmApiClient {
  private readonly clients: Map<EvmChain, AxiosInstance> = new Map();
  private readonly apiKey: string;

  constructor(config: EvmApiClientConfig) {
    this.apiKey = config.alchemyApiKey ?? '';

    const chains: EvmChain[] = ['ethereum', 'arbitrum', 'base'];
    for (const chain of chains) {
      const baseUrl = config.rpcUrls?.[chain] ?? DEFAULT_RPC_URLS[chain];
      const url = this.apiKey ? `${baseUrl}/${this.apiKey}` : baseUrl;

      this.clients.set(chain, axios.create({
        baseURL: url,
        timeout: 30_000,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  }

  private getClient(chain: EvmChain): AxiosInstance {
    const client = this.clients.get(chain);
    if (!client) throw new Error(`No client configured for chain: ${chain}`);
    return client;
  }

  private async rpcCall<T>(chain: EvmChain, method: string, params: unknown[]): Promise<T> {
    const client = this.getClient(chain);
    const response = await client.post<AlchemyResponse<T>>('', {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });
    return response.data.result;
  }

  /**
   * Get all token transfers for a wallet using Alchemy's alchemy_getAssetTransfers.
   * Returns all ERC-20 transfers involving the wallet.
   */
  async getTransfersForAddress(
    walletAddress: string,
    chain: EvmChain,
    options: FetchTransactionsOptions = {},
  ): Promise<AlchemyTransferItem[]> {
    const maxCount = options.maxCount ?? 1000;
    const allTransfers: AlchemyTransferItem[] = [];
    let pageKey: string | undefined;

    do {
      const params: Record<string, unknown> = {
        fromBlock: options.fromBlock ? `0x${options.fromBlock.toString(16)}` : '0x0',
        toBlock: options.toBlock === 'latest' || options.toBlock == null
          ? 'latest'
          : `0x${options.toBlock.toString(16)}`,
        category: ['erc20'],
        withMetadata: true,
        maxCount: `0x${Math.min(maxCount, 1000).toString(16)}`,
      };

      if (pageKey) params.pageKey = pageKey;

      // Fetch transfers where wallet is the receiver
      const [toResult, fromResult] = await Promise.all([
        this.rpcCall<{ transfers: AlchemyTransferItem[]; pageKey?: string }>(
          chain, 'alchemy_getAssetTransfers', [{ ...params, toAddress: walletAddress }],
        ),
        this.rpcCall<{ transfers: AlchemyTransferItem[]; pageKey?: string }>(
          chain, 'alchemy_getAssetTransfers', [{ ...params, fromAddress: walletAddress }],
        ),
      ]);

      const transfers = [...(toResult?.transfers ?? []), ...(fromResult?.transfers ?? [])];
      // Deduplicate by uniqueId
      const seen = new Set(allTransfers.map(t => t.uniqueId));
      for (const t of transfers) {
        if (!seen.has(t.uniqueId)) {
          allTransfers.push(t);
          seen.add(t.uniqueId);
        }
      }

      pageKey = toResult?.pageKey ?? fromResult?.pageKey;
    } while (pageKey && allTransfers.length < maxCount);

    return allTransfers;
  }

  /**
   * Get full transaction with logs for a given hash.
   */
  async getTransactionWithLogs(txHash: string, chain: EvmChain): Promise<EvmTransaction | null> {
    try {
      const [txData, receipt] = await Promise.all([
        this.rpcCall<Record<string, string> | null>(chain, 'eth_getTransactionByHash', [txHash]),
        this.rpcCall<Record<string, unknown> | null>(chain, 'eth_getTransactionReceipt', [txHash]),
      ]);

      if (!txData || !receipt) return null;

      const block = await this.rpcCall<{ timestamp: string }>(
        chain, 'eth_getBlockByHash', [txData['blockHash'], false],
      );

      const logs = ((receipt['logs'] as unknown[]) ?? []).map((log: unknown) => {
        const l = log as Record<string, unknown>;
        return {
          address: (l['address'] as string).toLowerCase(),
          topics: l['topics'] as string[],
          data: l['data'] as string,
          logIndex: parseInt(l['logIndex'] as string, 16),
          transactionHash: l['transactionHash'] as string,
          blockNumber: parseInt(l['blockNumber'] as string, 16),
        } satisfies EvmLog;
      });

      return {
        hash: txHash.toLowerCase(),
        blockNumber: parseInt(txData['blockNumber'], 16),
        timestamp: parseInt(block?.timestamp ?? '0', 16),
        from: (txData['from'] as string).toLowerCase(),
        to: txData['to'] ? (txData['to'] as string).toLowerCase() : '',
        nativeValue: BigInt(txData['value'] ?? '0x0'),
        gasUsed: BigInt((receipt['gasUsed'] as string) ?? '0x0'),
        gasPrice: BigInt(txData['gasPrice'] ?? txData['maxFeePerGas'] ?? '0x0'),
        success: receipt['status'] === '0x1',
        logs,
        chain,
      };
    } catch (err) {
      logger.warn(`Failed to fetch tx ${txHash} on ${chain}: ${err}`);
      return null;
    }
  }

  /**
   * Batch-fetch transactions with logs for a list of hashes.
   * Processes in parallel with concurrency limit.
   */
  async getTransactionsWithLogs(
    txHashes: string[],
    chain: EvmChain,
    concurrency = 5,
  ): Promise<EvmTransaction[]> {
    const results: EvmTransaction[] = [];
    const chunks: string[][] = [];

    for (let i = 0; i < txHashes.length; i += concurrency) {
      chunks.push(txHashes.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const txs = await Promise.all(chunk.map(h => this.getTransactionWithLogs(h, chain)));
      results.push(...txs.filter((t): t is EvmTransaction => t !== null));
    }

    return results;
  }

  /**
   * Get unique transaction hashes from asset transfers.
   */
  extractTxHashes(transfers: AlchemyTransferItem[]): string[] {
    return [...new Set(transfers.map(t => t.hash.toLowerCase()))];
  }
}
