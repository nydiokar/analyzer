import 'dotenv/config';
import axios from 'axios';

/**
 * Compare outputs across Helius endpoints for a given address:
 * - RPC getSignaturesForAddress (discovery)
 * - RPC getTransactionsForAddress (transactionDetails: 'signatures' and 'full')
 * - Enhanced /v0/transactions (enrichment)
 *
 * Usage:
 *   npx ts-node scripts/compare_helius_endpoints.ts <ADDRESS> [--limit 100] [--network mainnet|devnet]
 *
 * Env:
 *   HELIUS_API_KEY=... (required)
 */

type RpcSignatureInfo = {
  signature: string;
  slot: number;
  err: unknown | null;
  memo: string | null;
  blockTime?: number | null;
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
};

// "signatures" detail mode entry for getTransactionsForAddress
type TxForAddressSignatureEntry = {
  signature: string;
  slot: number;
  err: unknown | null;
  memo: string | null;
  blockTime?: number | null;
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
};

// getTransactionsForAddress result envelope
type TxForAddressResult<T> = {
  data: T[];
  paginationToken?: string | null;
};

// Minimal shape for RPC full tx (jsonParsed) comparison purposes
type RpcFullTransaction = {
  slot: number;
  blockTime?: number | null;
  meta: Record<string, unknown> | null;
  transaction: Record<string, unknown>;
};

// Minimal shape for Helius Enhanced transaction
type EnhancedTransaction = {
  signature: string;
  timestamp?: number;
  slot?: number;
  nativeTransfers?: unknown[];
  tokenTransfers?: unknown[];
  accountData?: unknown[];
  events?: Record<string, unknown>;
};

function parseArgs(argv: string[]): { address: string; limit: number; network: 'mainnet' | 'devnet' } {
  const address = argv[2];
  if (!address) {
    console.error('Usage: npx ts-node scripts/compare_helius_endpoints.ts <ADDRESS> [--limit 100] [--network mainnet|devnet]');
    process.exit(1);
  }
  let limit = 100;
  let network: 'mainnet' | 'devnet' = 'mainnet';
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) {
      limit = Math.max(1, Math.min(1000, Number(argv[i + 1])));
      i++;
    } else if (argv[i] === '--network' && argv[i + 1]) {
      const n = argv[i + 1] as 'mainnet' | 'devnet';
      network = n === 'devnet' ? 'devnet' : 'mainnet';
      i++;
    }
  }
  return { address, limit, network };
}

function getRpcUrl(network: 'mainnet' | 'devnet', apiKey: string): string {
  const base = network === 'devnet' ? 'https://devnet.helius-rpc.com/' : 'https://mainnet.helius-rpc.com/';
  return `${base}?api-key=${apiKey}`;
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const { data } = await axios.post(rpcUrl, {
    jsonrpc: '2.0',
    id: `cmp-${method}-${Date.now()}`,
    method,
    params,
  }, { timeout: 30000 });
  if (data.error) {
    throw new Error(`RPC error for ${method}: ${JSON.stringify(data.error)}`);
  }
  return data.result as T;
}

async function getSignaturesForAddress(rpcUrl: string, address: string, limit: number): Promise<RpcSignatureInfo[]> {
  const capped = Math.min(1000, Math.max(1, limit));
  return rpcCall<RpcSignatureInfo[]>(rpcUrl, 'getSignaturesForAddress', [address, { limit: capped }]);
}

async function getTransactionsForAddressSignatures(rpcUrl: string, address: string, limit: number): Promise<TxForAddressResult<TxForAddressSignatureEntry>> {
  const capped = Math.min(1000, Math.max(1, limit));
  return rpcCall<TxForAddressResult<TxForAddressSignatureEntry>>(rpcUrl, 'getTransactionsForAddress', [
    address,
    {
      transactionDetails: 'signatures',
      sortOrder: 'desc',
      limit: capped,
    },
  ]);
}

async function getTransactionsForAddressFull(rpcUrl: string, address: string, limit: number): Promise<TxForAddressResult<RpcFullTransaction>> {
  const capped = Math.min(100, Math.max(1, limit));
  return rpcCall<TxForAddressResult<RpcFullTransaction>>(rpcUrl, 'getTransactionsForAddress', [
    address,
    {
      transactionDetails: 'full',
      encoding: 'jsonParsed',
      sortOrder: 'desc',
      limit: capped,
      maxSupportedTransactionVersion: 0,
    },
  ]);
}

async function getEnhancedTransactions(apiKey: string, signatures: string[]): Promise<EnhancedTransaction[]> {
  if (signatures.length === 0) return [];
  const { data } = await axios.post(
    `https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`,
    { transactions: signatures },
    { timeout: 60000 }
  );
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected Enhanced response shape: ${typeof data}`);
  }
  return data as EnhancedTransaction[];
}

function compareSignatureSets(a: string[], b: string[]): { missingInA: string[]; missingInB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  const missingInA: string[] = [];
  const missingInB: string[] = [];
  for (const s of setB) if (!setA.has(s)) missingInA.push(s);
  for (const s of setA) if (!setB.has(s)) missingInB.push(s);
  return { missingInA, missingInB };
}

function summarizeEnhancedPresence(enhanced: EnhancedTransaction[], rpcFull: RpcFullTransaction[]): { enhancedOnlyCount: number; rpcHasEnhancedFieldsCount: number } {
  // Heuristic: fields that only Enhanced provides today
  let enhancedOnlyCount = 0;
  let rpcHasEnhancedFieldsCount = 0;
  const rpcHas = (tx: RpcFullTransaction): boolean => {
    // Standard RPC full should NOT have these Enhanced fields
    return 'tokenTransfers' in (tx as unknown as Record<string, unknown>) ||
           'nativeTransfers' in (tx as unknown as Record<string, unknown>) ||
           'events' in (tx as unknown as Record<string, unknown>) ||
           'accountData' in (tx as unknown as Record<string, unknown>);
  };
  for (const e of enhanced) {
    const hasEnhanced = Boolean(e.tokenTransfers || e.nativeTransfers || e.events || e.accountData);
    if (hasEnhanced) enhancedOnlyCount++;
  }
  for (const r of rpcFull) {
    if (rpcHas(r)) rpcHasEnhancedFieldsCount++;
  }
  return { enhancedOnlyCount, rpcHasEnhancedFieldsCount };
}

(async () => {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error('HELIUS_API_KEY env var is required');
    process.exit(1);
  }
  const { address, limit, network } = parseArgs(process.argv);
  const rpcUrl = getRpcUrl(network, apiKey);

  // Phase 1: compare signature discovery
  const [legacySigInfos, v2SigPage] = await Promise.all([
    getSignaturesForAddress(rpcUrl, address, limit),
    getTransactionsForAddressSignatures(rpcUrl, address, limit),
  ]);
  const legacySigs = legacySigInfos.map(s => s.signature);
  const v2Sigs = v2SigPage.data.map(s => s.signature);
  const sigDiff = compareSignatureSets(legacySigs, v2Sigs);

  console.log('Discovery comparison');
  console.log(JSON.stringify({
    input: { address, limit, network },
    legacyCount: legacySigs.length,
    v2SignaturesCount: v2Sigs.length,
    paginationTokenPresent: Boolean(v2SigPage.paginationToken),
    missingInLegacy: sigDiff.missingInA.length,
    missingInV2: sigDiff.missingInB.length,
    sampleMissingInLegacy: sigDiff.missingInA.slice(0, 5),
    sampleMissingInV2: sigDiff.missingInB.slice(0, 5),
  }, null, 2));

  // Phase 2: compare detail level vs Enhanced for overlapping signatures
  const rpcFullPage = await getTransactionsForAddressFull(rpcUrl, address, Math.min(limit, 50));
  const rpcFullBySig = new Map<string, RpcFullTransaction>();
  const rpcFullSigs: string[] = [];

  for (const entry of rpcFullPage.data) {
    // Extract signature from transaction->signatures[0]
    const tx = entry as unknown as { transaction?: { signatures?: string[] } };
    const sig = tx?.transaction?.signatures?.[0];
    if (sig) {
      rpcFullBySig.set(sig, entry);
      rpcFullSigs.push(sig);
    }
  }

  const overlap = rpcFullSigs.slice(0, 50);
  const enhancedTxs = await getEnhancedTransactions(apiKey, overlap);
  const enhancedBySig = new Map<string, EnhancedTransaction>();
  for (const etx of enhancedTxs) {
    if (etx.signature) enhancedBySig.set(etx.signature, etx);
  }

  // Summaries
  const rpcFullAligned: RpcFullTransaction[] = [];
  const enhancedAligned: EnhancedTransaction[] = [];
  for (const sig of overlap) {
    const r = rpcFullBySig.get(sig);
    const e = enhancedBySig.get(sig);
    if (r && e) {
      rpcFullAligned.push(r);
      enhancedAligned.push(e);
    }
  }

  const presence = summarizeEnhancedPresence(enhancedAligned, rpcFullAligned);

  console.log('Detail level comparison');
  console.log(JSON.stringify({
    rpcFullCount: rpcFullPage.data.length,
    enhancedCount: enhancedTxs.length,
    overlapCount: rpcFullAligned.length,
    enhancedWithEnrichedFields: presence.enhancedOnlyCount,
    rpcFullHasEnhancedFields: presence.rpcHasEnhancedFieldsCount,
    conclusion:
      presence.rpcHasEnhancedFieldsCount === 0
        ? 'RPC full lacks Enhanced fields (tokenTransfers/nativeTransfers/events). Phase 2 cannot be replaced by RPC full.'
        : 'RPC full unexpectedly contains Enhanced-like fields. Verify Helius changes.'
  }, null, 2));
})().catch((err) => {
  console.error('compare_helius_endpoints failed:', err?.message || err);
  process.exit(1);
});
