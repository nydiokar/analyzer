import { EvmLog, EvmTxClassification, ParsedTransferLog } from '@/types/evm-api';
import { isDexProgram } from '@config/evm-dex-programs';
import { parseTransferLogs } from './evm-event-parser';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmTransactionClassifier');

// Known swap-related event topic0 signatures
const SWAP_TOPICS = new Set([
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822', // UniswapV2 Swap
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67', // UniswapV3 Swap
  '0x8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140', // Curve TokenExchange
  '0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207',  // Balancer Swap
  '0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31', // 0x RfqOrderFilled
  '0x6869791f0a34781b29882982cc39e882d573a282d6f97f3e2590e8aa31ef0000', // 1inch Swapped
]);

// WETH Withdrawal topic — means ETH was sent to someone after unwrapping
const WETH_WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';

export interface ClassificationResult {
  classification: EvmTxClassification;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  transfers: ParsedTransferLog[];
}

export function classifyEvmTransaction(
  txTo: string,
  logs: EvmLog[],
  walletAddress: string,
  chain: string,
): ClassificationResult {
  const transfers = parseTransferLogs(logs);
  const walletLower = walletAddress.toLowerCase();
  const toLower = txTo?.toLowerCase() ?? '';

  // 1. High confidence: tx.to is a known DEX router
  if (toLower && isDexProgram(toLower, chain)) {
    return { classification: 'SWAP', confidence: 'high', reason: `DEX router: ${toLower}`, transfers };
  }

  // 2. High confidence: a known swap event topic appears in logs
  //    (UniswapV2 Swap, UniswapV3 Swap, Curve TokenExchange, etc.)
  for (const log of logs) {
    if (SWAP_TOPICS.has(log.topics[0]?.toLowerCase())) {
      return {
        classification: 'SWAP',
        confidence: 'high',
        reason: `Swap event detected: topic ${log.topics[0].slice(0, 10)}... at ${log.address}`,
        transfers,
      };
    }
  }

  // 3. High confidence: DEX router appears as a log emitter
  const logAddresses = new Set(logs.map(l => l.address.toLowerCase()));
  for (const addr of logAddresses) {
    if (isDexProgram(addr, chain)) {
      return {
        classification: 'SWAP',
        confidence: 'high',
        reason: `DEX router ${addr} emitted events`,
        transfers,
      };
    }
  }

  // 4. Medium confidence: wallet sent tokens out + WETH Withdrawal present
  //    (token sold → WETH unwrapped → ETH sent to wallet via aggregator)
  const walletSentTokens = transfers.some(t => t.from === walletLower);
  const hasWethWithdrawal = logs.some(l => l.topics[0]?.toLowerCase() === WETH_WITHDRAWAL_TOPIC);
  if (walletSentTokens && hasWethWithdrawal) {
    return {
      classification: 'SWAP',
      confidence: 'medium',
      reason: 'Wallet sent tokens + WETH Withdrawal event (aggregator swap)',
      transfers,
    };
  }

  // 5. Medium confidence: wallet sent and received different tokens directly
  const walletTokensIn = new Set(transfers.filter(t => t.to === walletLower).map(t => t.tokenAddress));
  const walletTokensOut = new Set(transfers.filter(t => t.from === walletLower).map(t => t.tokenAddress));
  if (walletTokensIn.size >= 1 && walletTokensOut.size >= 1) {
    return {
      classification: 'SWAP',
      confidence: 'medium',
      reason: `Multi-leg: ${walletTokensOut.size} token(s) out, ${walletTokensIn.size} token(s) in`,
      transfers,
    };
  }

  // 6. Transfer: single token movement involving wallet
  const walletTransfers = transfers.filter(t => t.from === walletLower || t.to === walletLower);
  if (walletTransfers.length >= 1) {
    return {
      classification: 'TRANSFER',
      confidence: walletTransfers.length === 1 ? 'medium' : 'low',
      reason: `${walletTransfers.length} transfer log(s) involving wallet, no swap signals`,
      transfers,
    };
  }

  // 7. No ERC-20 logs at all — native ETH transfer or unrelated tx
  return {
    classification: 'TRANSFER',
    confidence: 'low',
    reason: 'No ERC-20 logs or swap events detected',
    transfers,
  };
}
