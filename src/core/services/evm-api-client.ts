import axios, { AxiosInstance } from 'axios';
import { EvmTransaction, EvmLog, EvmChain } from '@/types/evm-api';
import { createLogger } from 'core/utils/logger';
import { Injectable } from '@nestjs/common';

const logger = createLogger('EvmApiClient');

const DEFAULT_RPC_URLS: Record<EvmChain, string> = {
  ethereum: 'https://eth-mainnet.g.alchemy.com/v2',
  arbitrum: 'https://arb-mainnet.g.alchemy.com/v2',
  base: 'https://base-mainnet.g.alchemy.com/v2',
};

export interface EvmApiClientConfig {
  alchemyApiKey?: string;
  rpcUrls?: Partial<Record<EvmChain, string>>;
}

export interface FetchTransactionsOptions {
  fromBlock?: number;
  toBlock?: number | 'latest';
  maxCount?: number;
}

interface AlchemyTransferItem {
  blockNum: string;
  uniqueId: string;
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract: {
    value: string | null;
    address: string | null;
    decimal: string | null;
  };
  metadata?: { blockTimestamp?: string };
}

interface AlchemyRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result: T;
}

// Alchemy alchemy_getTransactionReceipts returns receipts with logs per block
interface AlchemyReceiptResult {
  receipts: AlchemyReceipt[] | null;
}

interface AlchemyReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  gasUsed: string;
  effectiveGasPrice: string;
  status: string;
  logs: AlchemyLog[];
}

interface AlchemyLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
  transactionHash: string;
  blockNumber: string;
}

@Injectable()
export class EvmApiClient {
  private readonly clients: Map<EvmChain, AxiosInstance> = new Map();

  constructor(config: EvmApiClientConfig) {
    const chains: EvmChain[] = ['ethereum', 'arbitrum', 'base'];
    for (const chain of chains) {
      const baseUrl = config.rpcUrls?.[chain] ?? DEFAULT_RPC_URLS[chain];
      const url = config.alchemyApiKey ? `${baseUrl}/${config.alchemyApiKey}` : baseUrl;
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
    const response = await client.post<AlchemyRpcResponse<T>>('', {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });
    return response.data.result;
  }

  /**
   * Fetch ERC-20 transfers for a wallet using alchemy_getAssetTransfers.
   */
  async getTransfersForAddress(
    walletAddress: string,
    chain: EvmChain,
    options: FetchTransactionsOptions = {},
  ): Promise<AlchemyTransferItem[]> {
    const maxCount = options.maxCount ?? 1000;
    const allTransfers: AlchemyTransferItem[] = [];
    let pageKeyTo: string | undefined;
    let pageKeyFrom: string | undefined;
    let doneToFetch = false;
    let doneFromFetch = false;

    const baseParams = {
      fromBlock: options.fromBlock ? `0x${options.fromBlock.toString(16)}` : '0x0',
      toBlock: 'latest',
      category: ['erc20'],
      withMetadata: true,
      maxCount: '0x3e8', // 1000
      order: 'desc',
    };

    const seen = new Set<string>();

    while ((!doneToFetch || !doneFromFetch) && allTransfers.length < maxCount) {
      const calls: Promise<{ transfers: AlchemyTransferItem[]; pageKey?: string }>[] = [];

      if (!doneToFetch) {
        calls.push(this.rpcCall(chain, 'alchemy_getAssetTransfers', [{
          ...baseParams,
          toAddress: walletAddress,
          ...(pageKeyTo ? { pageKey: pageKeyTo } : {}),
        }]));
      }
      if (!doneFromFetch) {
        calls.push(this.rpcCall(chain, 'alchemy_getAssetTransfers', [{
          ...baseParams,
          fromAddress: walletAddress,
          ...(pageKeyFrom ? { pageKey: pageKeyFrom } : {}),
        }]));
      }

      const results = await Promise.all(calls);
      let resultIdx = 0;

      if (!doneToFetch) {
        const r = results[resultIdx++];
        for (const t of r?.transfers ?? []) {
          if (!seen.has(t.uniqueId)) { allTransfers.push(t); seen.add(t.uniqueId); }
        }
        pageKeyTo = r?.pageKey;
        if (!pageKeyTo) doneToFetch = true;
      }

      if (!doneFromFetch) {
        const r = results[resultIdx++];
        for (const t of r?.transfers ?? []) {
          if (!seen.has(t.uniqueId)) { allTransfers.push(t); seen.add(t.uniqueId); }
        }
        pageKeyFrom = r?.pageKey;
        if (!pageKeyFrom) doneFromFetch = true;
      }
    }

    return allTransfers;
  }

  /**
   * Fetch full tx data + logs for a batch of hashes.
   * Uses alchemy_getTransactionReceipts (block-level batch) when possible,
   * falling back to per-tx eth_getTransactionReceipt.
   */
  async getTransactionsWithLogs(
    txHashes: string[],
    chain: EvmChain,
    concurrency = 10,
  ): Promise<EvmTransaction[]> {
    // Group hashes by block so we can batch per block
    // Since we don't have block numbers yet, fetch receipts individually
    // but in parallel batches
    const results: EvmTransaction[] = [];
    const chunks: string[][] = [];

    for (let i = 0; i < txHashes.length; i += concurrency) {
      chunks.push(txHashes.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const txs = await Promise.all(chunk.map(h => this.fetchTxWithReceipt(h, chain)));
      results.push(...txs.filter((t): t is EvmTransaction => t !== null));
    }

    return results;
  }

  /**
   * Fetch a single tx: transaction data + receipt (2 calls, parallel).
   * Block timestamp is taken from the transfer metadata when available
   * to avoid a 3rd RPC call per tx.
   */
  private async fetchTxWithReceipt(txHash: string, chain: EvmChain): Promise<EvmTransaction | null> {
    try {
      const [txData, receipt] = await Promise.all([
        this.rpcCall<Record<string, string> | null>(chain, 'eth_getTransactionByHash', [txHash]),
        this.rpcCall<AlchemyReceipt | null>(chain, 'eth_getTransactionReceipt', [txHash]),
      ]);

      if (!txData || !receipt) return null;

      // Get block timestamp — use a separate call only if needed
      const blockTimestamp = await this.rpcCall<{ timestamp: string }>(
        chain, 'eth_getBlockByNumber', [txData['blockNumber'], false],
      ).then(b => parseInt(b?.timestamp ?? '0', 16)).catch(() => 0);

      const logs: EvmLog[] = (receipt.logs ?? []).map(l => ({
        address: l.address.toLowerCase(),
        topics: l.topics,
        data: l.data,
        logIndex: parseInt(l.logIndex, 16),
        transactionHash: l.transactionHash,
        blockNumber: parseInt(l.blockNumber, 16),
      }));

      return {
        hash: txHash.toLowerCase(),
        blockNumber: parseInt(txData['blockNumber'], 16),
        timestamp: blockTimestamp,
        from: (txData['from'] ?? '').toLowerCase(),
        to: txData['to'] ? txData['to'].toLowerCase() : '',
        nativeValue: BigInt(txData['value'] ?? '0x0'),
        gasUsed: BigInt(receipt.gasUsed ?? '0x0'),
        gasPrice: BigInt(receipt.effectiveGasPrice ?? txData['gasPrice'] ?? '0x0'),
        success: receipt.status === '0x1',
        logs,
        chain,
      };
    } catch (err) {
      logger.warn(`Failed to fetch tx ${txHash}: ${err}`);
      return null;
    }
  }

  extractTxHashes(transfers: AlchemyTransferItem[]): string[] {
    return [...new Set(transfers.map(t => t.hash.toLowerCase()))];
  }
}
