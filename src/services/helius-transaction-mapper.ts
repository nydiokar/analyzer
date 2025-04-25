import { createLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { stringify } from 'csv-stringify/sync';
import {
  HeliusTransaction,
  IntermediateSwapRecord,
  AccountData,
} from '../types/helius-api';

// Logger instance for this module
const logger = createLogger('HeliusTransactionMapper');


/**
 * Extracts token decimals from accountData for a given mint.
 * @param mint The token mint address
 * @param accountData Array of account data from HeliusTransaction
 * @returns The number of decimals, or 0 if not found.
 */
function getTokenDecimals(mint: string, accountData: AccountData[] | undefined): number {
  if (!accountData) return 0;
  for (const account of accountData) {
    for (const tokenChange of account.tokenBalanceChanges || []) {
      if (tokenChange.mint.toLowerCase() === mint.toLowerCase()) {
        // Ensure decimals is a number, default to 0 if undefined or invalid
        return tokenChange.rawTokenAmount?.decimals ?? 0;
      }
    }
  }
  logger.warn(`Decimals not found for mint: ${mint}. Defaulting to 0.`);
  return 0; // Default to 0 if not found
}

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

  logger.info(`Mapping ${transactions.length} Helius transactions to intermediate format...`);

  const lowerCaseWalletAddress = walletAddress.toLowerCase();

  for (const tx of transactions) {
    if (processedSignatures.has(tx.signature)) continue;
    
    let transactionMapped = false; // Flag to track if any record was created for this tx
    try {
      // 1. Process Token Transfers (SPL)
      if (tx.tokenTransfers?.length) {
        logger.debug(`Processing ${tx.tokenTransfers.length} token transfers for tx: ${tx.signature}`);
        for (const transfer of tx.tokenTransfers) {
          const fromAddress = transfer.fromUserAccount?.toLowerCase() ?? 'unknown';
          const toAddress = transfer.toUserAccount?.toLowerCase() ?? 'unknown';
          let direction: 'in' | 'out' | null = null;
          
          if (toAddress === lowerCaseWalletAddress) direction = 'in';
          else if (fromAddress === lowerCaseWalletAddress) direction = 'out';

          if (direction) {
            const decimals = getTokenDecimals(transfer.mint, tx.accountData);
            const amount = typeof transfer.tokenAmount === 'number' ? transfer.tokenAmount : parseFloat(transfer.tokenAmount || '0');

            if (!isNaN(amount) && amount !== 0) { // Ensure non-zero amount
                intermediateRecords.push({
                  signature: tx.signature,
                  timestamp: tx.timestamp,
                  mint: transfer.mint,
                  amount: amount, // Use direct amount
                  decimals: decimals, // Store for context
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

/**
 * Saves the intermediate swap records to a CSV file.
 * @param records Array of IntermediateSwapRecord
 * @param walletAddress The wallet address being analyzed
 * @returns The path to the saved CSV file
 */
export function saveIntermediateRecordsToCsv(records: IntermediateSwapRecord[], walletAddress: string): string {
  if (records.length === 0) {
    logger.info('No intermediate records to save to CSV.');
    return ''; // Return empty string or handle as needed
  }

  const headers = [
    'signature',
    'timestamp',
    'mint',
    'amount',
    'decimals',
    'direction'
  ];

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filePath = path.join(dataDir, `intermediate_swaps_${walletAddress}_${timestamp}.csv`);

  try {
    // Use csv-stringify to handle potential complexities (quotes, commas)
    // Ensure amount is outputted reliably (stringify might convert large numbers to scientific notation otherwise)
    const csvData = records.map(r => ({
        ...r,
        amount: r.amount.toString() // Convert amount to string for reliable CSV output
    }));
    const output = stringify(csvData, { header: true, columns: headers });

    fs.writeFileSync(filePath, output);
    logger.info(`Successfully saved ${records.length} intermediate records to ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error('Failed to save intermediate records to CSV', { error, filePath });
    throw new Error(`Failed to save intermediate CSV: ${error instanceof Error ? error.message : String(error)}`);
  }
} 