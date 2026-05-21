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

// Alchemy alchemy_getAssetTransfers item — already contains transfer metadata
export interface AlchemyTransferItem {
  blockNum: string;
  uniqueId: string;
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract: {
    value: string | null;  // hex-encoded raw amount
    address: string | null; // token contract address
    decimal: string | null; // hex-encoded decimals
  };
  metadata?: { blockTimestamp?: string };
}

interface AlchemyRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result: T;
}

interface AlchemyReceipt {
  transactionHash: string;
  from: string;
  to: string | null;
  gasUsed: string;
  effectiveGasPrice: string;
  status: string;
  blockNumber: string;
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

// Delay helper for rate limiting
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  private async rpcCall<T>(chain: EvmChain, method: string, params: unknown[], retries = 3): Promise<T> {
    const client = this.getClient(chain);
    let attempt = 0;
    while (true) {
      try {
        const response = await client.post<AlchemyRpcResponse<T>>('', {
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        });
        return response.data.result;
      } catch (err: any) {
        if (err?.response?.status === 429 && attempt < retries) {
          const wait = 1000 * 2 ** attempt; // 1s, 2s, 4s
          logger.warn(`Rate limited, waiting ${wait}ms before retry ${attempt + 1}/${retries}`);
          await sleep(wait);
          attempt++;
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Fetch ERC-20 transfers for a wallet using alchemy_getAssetTransfers.
   * The response already contains token address, amount, from, to — sufficient
   * for building SwapAnalysisInput without additional per-tx RPC calls.
   */
  async getTransfersForAddress(
    walletAddress: string,
    chain: EvmChain,
    options: FetchTransactionsOptions = {},
  ): Promise<AlchemyTransferItem[]> {
    const maxCount = options.maxCount ?? 100;
    const allTransfers: AlchemyTransferItem[] = [];
    const seen = new Set<string>();

    const baseParams = {
      fromBlock: '0x0',
      toBlock: 'latest',
      category: ['erc20'],
      withMetadata: true,
      maxCount: `0x${Math.min(maxCount, 1000).toString(16)}`,
      order: 'desc',
    };

    // Fetch incoming and outgoing in parallel
    const [toResult, fromResult] = await Promise.all([
      this.rpcCall<{ transfers: AlchemyTransferItem[]; pageKey?: string }>(
        chain, 'alchemy_getAssetTransfers', [{ ...baseParams, toAddress: walletAddress }],
      ),
      this.rpcCall<{ transfers: AlchemyTransferItem[]; pageKey?: string }>(
        chain, 'alchemy_getAssetTransfers', [{ ...baseParams, fromAddress: walletAddress }],
      ),
    ]);

    for (const t of [...(toResult?.transfers ?? []), ...(fromResult?.transfers ?? [])]) {
      if (!seen.has(t.uniqueId)) {
        allTransfers.push(t);
        seen.add(t.uniqueId);
      }
    }

    return allTransfers;
  }

  /**
   * Fetch transaction receipts (with logs) for a list of tx hashes.
   * Uses sequential requests with a small delay to respect free-tier rate limits.
   * Only needed for DEX event parsing (value extraction) — not for basic classification.
   */
  /**
   * Fetch transaction receipts (with full logs) for a set of hashes.
   * Sequential with `delayMs` between calls to respect free-tier rate limits.
   * Returns a map keyed by lowercase tx hash.
   */
  async getReceiptsForHashes(
    txHashes: string[],
    chain: EvmChain,
    delayMs = 200,
  ): Promise<Map<string, AlchemyReceipt>> {
    const results = new Map<string, AlchemyReceipt>();

    for (const hash of txHashes) {
      try {
        const receipt = await this.rpcCall<AlchemyReceipt | null>(
          chain, 'eth_getTransactionReceipt', [hash],
        );
        if (receipt) results.set(hash.toLowerCase(), receipt);
        if (delayMs > 0) await sleep(delayMs);
      } catch (err) {
        logger.warn(`Failed to fetch receipt for ${hash}: ${err}`);
      }
    }

    return results;
  }

  /**
   * Build EvmTransaction objects from Alchemy transfer items + optional receipts.
   *
   * The canonical approach for EVM transaction parsing:
   * 1. alchemy_getAssetTransfers gives us all ERC-20 movements (token, amount, direction)
   * 2. Group by tx hash — all transfers in the same tx = one logical operation
   * 3. If a tx has transfers of 2+ distinct tokens involving the wallet → SWAP
   * 4. Fetch receipt only for swaps (to get DEX event logs for value extraction)
   *
   * This minimises RPC calls: O(unique_swaps) receipts instead of O(all_txs).
   */
  buildTransactionsFromTransfers(
    transfers: AlchemyTransferItem[],
    walletAddress: string,
    chain: EvmChain = 'ethereum',
  ): EvmTransaction[] {
    const walletLower = walletAddress.toLowerCase();

    // Group transfers by tx hash
    const byHash = new Map<string, AlchemyTransferItem[]>();
    for (const t of transfers) {
      const hash = t.hash.toLowerCase();
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash)!.push(t);
    }

    const transactions: EvmTransaction[] = [];

    for (const [hash, txTransfers] of byHash) {
      const first = txTransfers[0];
      const timestamp = first.metadata?.blockTimestamp
        ? Math.floor(new Date(first.metadata.blockTimestamp).getTime() / 1000)
        : 0;

      // Synthesise ERC-20 Transfer logs from the asset transfer items
      // topic0 = ERC-20 Transfer signature
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const logs: EvmLog[] = txTransfers
        .filter(t => t.rawContract.address) // only ERC-20 transfers with contract address
        .map((t, i) => {
          const fromPad = `0x${(t.from ?? '').replace('0x', '').padStart(64, '0')}`;
          const toPad = `0x${(t.to ?? '').replace('0x', '').padStart(64, '0')}`;
          // rawContract.value is hex-encoded raw token amount
          const rawAmount = t.rawContract.value ?? '0x0';
          return {
            address: (t.rawContract.address ?? '').toLowerCase(),
            topics: [TRANSFER_TOPIC, fromPad, toPad],
            data: rawAmount.startsWith('0x') ? rawAmount : `0x${rawAmount}`,
            logIndex: i,
            transactionHash: hash,
            blockNumber: parseInt(first.blockNum, 16),
          } satisfies EvmLog;
        });

      transactions.push({
        hash,
        blockNumber: parseInt(first.blockNum, 16),
        timestamp,
        from: (first.from ?? '').toLowerCase(),
        to: '',   // not available from asset transfers; filled in by receipt if fetched
        nativeValue: 0n,
        gasUsed: 0n,
        gasPrice: 0n,
        success: true, // alchemy_getAssetTransfers only returns successful txs
        logs,
        chain,
      });
    }

    return transactions;
  }

  /**
   * Enrich transactions with receipt data (logs from DEX events, gas info).
   * Only call this for transactions you need full log data on.
   */
  async enrichWithReceipts(
    transactions: EvmTransaction[],
    chain: EvmChain,
    delayMs = 250,
  ): Promise<EvmTransaction[]> {
    const hashes = transactions.map(t => t.hash);
    const receipts = await this.getReceiptsForHashes(hashes, chain, delayMs);

    return transactions.map(tx => {
      const receipt = receipts.get(tx.hash);
      if (!receipt) return tx;

      const logs: EvmLog[] = receipt.logs.map(l => ({
        address: l.address.toLowerCase(),
        topics: l.topics,
        data: l.data,
        logIndex: parseInt(l.logIndex, 16),
        transactionHash: l.transactionHash,
        blockNumber: parseInt(l.blockNumber, 16),
      }));

      return {
        ...tx,
        to: receipt.to?.toLowerCase() ?? '',
        gasUsed: BigInt(receipt.gasUsed ?? '0x0'),
        gasPrice: BigInt(receipt.effectiveGasPrice ?? '0x0'),
        success: receipt.status === '0x1',
        logs, // full logs replace synthesised ones
      };
    });
  }

  /** Return a deduplicated list of lowercase tx hashes from a transfer list. */
  extractTxHashes(transfers: AlchemyTransferItem[]): string[] {
    return [...new Set(transfers.map(t => t.hash.toLowerCase()))];
  }

  /**
   * Build a token→decimals map from Alchemy transfer items.
   * Alchemy returns rawContract.decimal (hex) for every ERC-20 transfer — this
   * covers the vast majority of tokens with zero extra RPC calls.
   * Returns a map of lowercase token address → decimals.
   */
  extractDecimalsFromTransfers(transfers: AlchemyTransferItem[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const t of transfers) {
      const addr = t.rawContract.address?.toLowerCase();
      if (!addr || map.has(addr)) continue;
      const dec = t.rawContract.decimal;
      if (dec && dec !== '0x' && dec !== '0x0') {
        try {
          map.set(addr, Number(BigInt(dec.startsWith('0x') ? dec : `0x${dec}`)));
        } catch { /* skip malformed */ }
      }
    }
    return map;
  }

  /**
   * Fetch ERC-20 token decimals via eth_call to the contract's decimals() view function.
   * Results are cached in-memory for the lifetime of this client instance.
   * Use this only for tokens whose decimals aren't already known (e.g. not in Alchemy
   * transfer metadata and not in the static TOKEN_DECIMALS_CACHE).
   */
  private readonly _decimalsCache = new Map<string, number>(); // "chain:address" → decimals

  async fetchTokenDecimals(tokenAddress: string, chain: EvmChain): Promise<number> {
    const key = `${chain}:${tokenAddress.toLowerCase()}`;
    if (this._decimalsCache.has(key)) return this._decimalsCache.get(key)!;

    try {
      // decimals() selector: keccak256("decimals()") = 0x313ce567
      const result = await this.rpcCall<string>(chain, 'eth_call', [
        { to: tokenAddress, data: '0x313ce567' },
        'latest',
      ]);
      if (result && result !== '0x') {
        const decimals = Number(BigInt(result));
        this._decimalsCache.set(key, decimals);
        return decimals;
      }
    } catch (err) {
      logger.warn(`Failed to fetch decimals for ${tokenAddress} on ${chain}: ${err}`);
    }

    // Fallback to 18 if call fails or returns empty
    this._decimalsCache.set(key, 18);
    return 18;
  }

  /**
   * Resolve decimals for all tokens in a transfer list.
   * First pass: use rawContract.decimal from Alchemy (free, already in response).
   * Second pass: eth_call decimals() for any tokens Alchemy didn't annotate.
   * Returns a complete map of lowercase token address → decimals.
   */
  async resolveTokenDecimals(
    transfers: AlchemyTransferItem[],
    chain: EvmChain,
    knownDecimals: Record<string, number> = {},
  ): Promise<Map<string, number>> {
    const map = this.extractDecimalsFromTransfers(transfers);

    // Seed with caller-supplied known values (static cache from mapper)
    for (const [addr, dec] of Object.entries(knownDecimals)) {
      map.set(addr.toLowerCase(), dec);
    }

    // For tokens still missing, fall back to eth_call
    const uniqueAddresses = [...new Set(
      transfers
        .map(t => t.rawContract.address?.toLowerCase())
        .filter((a): a is string => !!a),
    )];

    const missing = uniqueAddresses.filter(a => !map.has(a));
    if (missing.length > 0) {
      logger.info(`Fetching decimals via eth_call for ${missing.length} unknown tokens on ${chain}`);
      await Promise.all(missing.map(async addr => {
        const dec = await this.fetchTokenDecimals(addr, chain);
        map.set(addr, dec);
      }));
    }

    return map;
  }

  // Legacy method kept for debug script compatibility
  async getTransactionsWithLogs(
    txHashes: string[],
    chain: EvmChain,
    concurrency = 3,
  ): Promise<EvmTransaction[]> {
    const results: EvmTransaction[] = [];
    for (let i = 0; i < txHashes.length; i += concurrency) {
      const chunk = txHashes.slice(i, i + concurrency);
      for (const hash of chunk) {
        try {
          const receipt = await this.rpcCall<AlchemyReceipt | null>(
            chain, 'eth_getTransactionReceipt', [hash],
          );
          if (!receipt) continue;
          const logs: EvmLog[] = receipt.logs.map(l => ({
            address: l.address.toLowerCase(),
            topics: l.topics,
            data: l.data,
            logIndex: parseInt(l.logIndex, 16),
            transactionHash: l.transactionHash,
            blockNumber: parseInt(l.blockNumber, 16),
          }));
          results.push({
            hash: hash.toLowerCase(),
            blockNumber: parseInt(receipt.blockNumber, 16),
            timestamp: 0,
            from: receipt.from.toLowerCase(),
            to: receipt.to?.toLowerCase() ?? '',
            nativeValue: 0n,
            gasUsed: BigInt(receipt.gasUsed ?? '0x0'),
            gasPrice: BigInt(receipt.effectiveGasPrice ?? '0x0'),
            success: receipt.status === '0x1',
            logs,
            chain,
          });
          await sleep(300); // conservative delay for free tier
        } catch (err) {
          logger.warn(`Failed to fetch tx ${hash}: ${err}`);
        }
      }
    }
    return results;
  }
}
