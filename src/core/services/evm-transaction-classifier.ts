import { EvmLog, EvmTxClassification, ParsedTransferLog } from '@/types/evm-api';
import { isDexProgram } from '@config/evm-dex-programs';
import { parseTransferLogs } from './evm-event-parser';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmTransactionClassifier');

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

  // High confidence: transaction sent directly to a known DEX router
  if (toLower && isDexProgram(toLower, chain)) {
    return {
      classification: 'SWAP',
      confidence: 'high',
      reason: `DEX router detected: ${toLower}`,
      transfers,
    };
  }

  // Medium confidence: wallet received multiple distinct tokens (multi-leg swap pattern)
  const walletTokensIn = new Set(
    transfers.filter(t => t.to === walletLower).map(t => t.tokenAddress),
  );
  const walletTokensOut = new Set(
    transfers.filter(t => t.from === walletLower).map(t => t.tokenAddress),
  );

  const distinctTokenCount = new Set([...walletTokensIn, ...walletTokensOut]).size;

  if (walletTokensIn.size >= 1 && walletTokensOut.size >= 1 && distinctTokenCount >= 2) {
    return {
      classification: 'SWAP',
      confidence: 'medium',
      reason: `Multi-leg transfer: ${walletTokensOut.size} token(s) out, ${walletTokensIn.size} token(s) in`,
      transfers,
    };
  }

  // Any DEX router appears anywhere in logs (as an intermediary)
  const logAddresses = new Set(logs.map(l => l.address.toLowerCase()));
  for (const addr of logAddresses) {
    if (isDexProgram(addr, chain)) {
      return {
        classification: 'SWAP',
        confidence: 'medium',
        reason: `DEX router ${addr} appeared in event logs`,
        transfers,
      };
    }
  }

  // Simple single-token transfer involving wallet
  const walletTransfers = transfers.filter(
    t => t.from === walletLower || t.to === walletLower,
  );

  if (walletTransfers.length === 1) {
    return {
      classification: 'TRANSFER',
      confidence: 'medium',
      reason: 'Single ERC-20 transfer involving wallet',
      transfers,
    };
  }

  if (walletTransfers.length === 0 && transfers.length === 0) {
    // Pure native ETH transfer — not a token swap
    return {
      classification: 'TRANSFER',
      confidence: 'low',
      reason: 'No ERC-20 logs; likely native ETH transfer',
      transfers,
    };
  }

  return {
    classification: 'UNKNOWN',
    confidence: 'low',
    reason: `Ambiguous: ${transfers.length} total transfer logs`,
    transfers,
  };
}
