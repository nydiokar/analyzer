import { createLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { stringify } from 'csv-stringify/sync';
import {
  HeliusTransaction,
  IntermediateSwapRecord,
} from '../types/helius-api';

// Logger instance for this module
const logger = createLogger('HeliusTransactionMapper');

/**
 * Maps Helius transactions to the IntermediateSwapRecord format,
 * including both SPL token transfers and native SOL transfers.
 * @param walletAddress The wallet address being analyzed
 * @param transactions Helius API transactions 
 * @returns Array of intermediate swap records
 */
export function mapHeliusTransactionsToIntermediateRecords(
  walletAddress: string,
  transactions: HeliusTransaction[],
): IntermediateSwapRecord[] {
  const intermediateRecords: IntermediateSwapRecord[] = [];
  const processedSignatures = new Set<string>(); // Avoid processing the same TX twice

  logger.debug(`Mapping ${transactions.length} Helius transactions to intermediate format...`);

  const lowerCaseWalletAddress = walletAddress.toLowerCase();

  for (const tx of transactions) {
    if (processedSignatures.has(tx.signature)) continue;
    
    let transactionMapped = false; // Flag to track if any record was created for this tx
    try {
      // 1. Process Token Transfers (SPL)
      if (tx.tokenTransfers?.length) {
        for (const transfer of tx.tokenTransfers) {
          const fromAddress = transfer.fromUserAccount?.toLowerCase() ?? 'unknown';
          const toAddress = transfer.toUserAccount?.toLowerCase() ?? 'unknown';
          let direction: 'in' | 'out' | null = null;
          
          if (toAddress === lowerCaseWalletAddress) direction = 'in';
          else if (fromAddress === lowerCaseWalletAddress) direction = 'out';

          if (direction) {
            // Use the already decimal-adjusted amount from Helius
            const amount = typeof transfer.tokenAmount === 'number' ? transfer.tokenAmount : parseFloat(transfer.tokenAmount || '0');

            if (!isNaN(amount) && amount !== 0) { // Ensure non-zero amount
                intermediateRecords.push({
                  signature: tx.signature,
                  timestamp: tx.timestamp,
                  mint: transfer.mint,
                  amount: amount, // Use direct amount
                  direction: direction,
                });
                transactionMapped = true;
            } else if (isNaN(amount)) {
                logger.warn(`Could not parse tokenAmount for mint ${transfer.mint} in tx ${tx.signature}. Skipping SPL transfer.`);
            }
          }
        }
      } // End tokenTransfers processing

      if (transactionMapped) {
           processedSignatures.add(tx.signature);
      }
      
    } catch (error) {
      logger.error('Error mapping transaction to intermediate record', { 
        error: error instanceof Error ? error.message : String(error),
        signature: tx.signature
      });
    }
  }

  logger.info(`Mapped to ${intermediateRecords.length} intermediate records based on tokenTransfers.`);
  return intermediateRecords;
} 