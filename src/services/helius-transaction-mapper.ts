import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client'; // Import Prisma namespace for input types
import {
  HeliusTransaction,
  SwapEvent, // Use the structured SwapEvent again
  TokenTransfer, // Keep for potential type checks inside SwapEvent
} from '../types/helius-api';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // WSOL Mint address

// Define the output type matching Prisma's expectations (Back to original structure)
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

// Helper to safely parse amount from various structures within SwapEvent
function safeParseAmount(holder: any): number {
  if (!holder) return 0;

  /* 1️⃣ canonical rawTokenAmount path */
  if (holder.rawTokenAmount?.tokenAmount !== undefined) {
    const { tokenAmount, decimals } = holder.rawTokenAmount;
    const raw = parseFloat(tokenAmount);
    return isNaN(raw) ? 0 : Math.abs(raw) / Math.pow(10, decimals ?? 0);
  }

  /* 2️⃣ tokenAmount already human readable (number or string) */
  if (holder.tokenAmount !== undefined) {
    const raw =
      typeof holder.tokenAmount === 'number'
        ? holder.tokenAmount
        : parseFloat(holder.tokenAmount);
    return isNaN(raw) ? 0 : Math.abs(raw);
  }

  /* 3️⃣ fallback for Exotic shapes { amount, decimals } */
  if (holder.amount !== undefined) {
    const raw =
      typeof holder.amount === 'number' ? holder.amount : parseFloat(holder.amount);
    if (isNaN(raw)) return 0;
    const decimals = typeof holder.decimals === 'number' ? holder.decimals : 0;
    return Math.abs(raw) / Math.pow(10, decimals);
  }

  return 0;
}

// Helper to safely parse native SOL amount (lamports to SOL)
function safeParseNativeAmount(nativeObj: any): number {
  if (!nativeObj) return 0;
  const raw =
    typeof nativeObj.amount === 'number'
      ? nativeObj.amount
      : parseFloat(nativeObj.amount);
  return isNaN(raw) ? 0 : Math.abs(raw) / 1e9;
}

/**
 * [ENHANCED] Processes Helius transactions to extract all SPL swaps, including SPL->SPL trades.
 * Analyzes both events.swap and comprehensive tokenTransfers to ensure all movements are captured.
 * FIXED to properly handle WSOL as an intermediary token in SPL↔SPL swaps.
 * 
 * @param walletAddress The wallet address being analyzed.
 * @param transactions Array of full HeliusTransaction objects.
 * @returns Array of SwapAnalysisInputCreateData objects for database insertion.
 */
export function mapHeliusTransactionsToIntermediateRecords(
  walletAddress: string,
  transactions: HeliusTransaction[],
): SwapAnalysisInputCreateData[] {
  const analysisInputs: SwapAnalysisInputCreateData[] = [];
  const lower = walletAddress.toLowerCase();

  // Count successful and failed transactions for logging
  let successfulTransactions = 0;
  let failedTransactions = 0;

  logger.info(
    `Mapping ${transactions.length} txs for ${walletAddress} (enhanced SPL detection enabled)…`,
  );

  for (const tx of transactions) {
    // Skip failed transactions
    if (tx.transactionError) {
      failedTransactions++;
      logger.debug(`Skipping failed transaction ${tx.signature}: ${tx.transactionError.error}`);
      continue;
    }
    
    successfulTransactions++;
    
    try {
      // Track tokens processed to avoid duplicates within the same tx
      const processedTokensInTx = new Set<string>();
      
      // -- STEP 1: Collect ALL SPL and WSOL transfers involving this wallet --
      const tokensSent = new Map<string, number>(); // mint -> amount
      const tokensReceived = new Map<string, number>(); // mint -> amount
      
      // Collect token transfers where the user is directly involved
      for (const transfer of tx.tokenTransfers || []) {
        // Outgoing tokens (user sent)
        if (transfer.fromUserAccount?.toLowerCase() === lower) {
          const amount = safeParseAmount(transfer);
          if (amount > 0) {
            const current = tokensSent.get(transfer.mint) || 0;
            tokensSent.set(transfer.mint, current + amount);
          }
        }
        
        // Incoming tokens (user received)
        if (transfer.toUserAccount?.toLowerCase() === lower) {
          const amount = safeParseAmount(transfer);
          if (amount > 0) {
            const current = tokensReceived.get(transfer.mint) || 0;
            tokensReceived.set(transfer.mint, current + amount);
          }
        }
      }
      
      // -- STEP 2: Identify ALL WSOL transfers in this transaction --
      const allWsolTransfers: Array<{from: string, to: string, amount: number}> = [];
      let totalWsolTransferred = 0;
      
      // Find all WSOL transfers, regardless of whether they involve the user
      for (const transfer of tx.tokenTransfers || []) {
        if (transfer.mint === SOL_MINT) {
          const amount = safeParseAmount(transfer);
          if (amount > 0) {
            allWsolTransfers.push({
              from: transfer.fromUserAccount?.toLowerCase() || 'unknown',
              to: transfer.toUserAccount?.toLowerCase() || 'unknown',
              amount
            });
            totalWsolTransferred += amount;
          }
        }
      }
      
      // -- STEP 3: Get regular SPL tokens (excluding WSOL) that were transferred --
      const regularSplSent = new Map<string, number>();
      const regularSplReceived = new Map<string, number>();
      
      for (const [mint, amount] of tokensSent.entries()) {
        if (mint !== SOL_MINT) {
          regularSplSent.set(mint, amount);
        }
      }
      
      for (const [mint, amount] of tokensReceived.entries()) {
        if (mint !== SOL_MINT) {
          regularSplReceived.set(mint, amount);
        }
      }
      
      // -- STEP 4: Determine transaction type and associated SOL values --      
      // Let's identify if this is a direct swap (1 token sent, 1 token received)
      const isDirectSwap = regularSplSent.size === 1 && regularSplReceived.size === 1;
      
      // Calculate direct WSOL movements for the user's wallet
      const userWsolSent = tokensSent.get(SOL_MINT) || 0;
      const userWsolReceived = tokensReceived.get(SOL_MINT) || 0;
      
      // -- STEP 5: Create the records with proper associated SOL values --
      
      // Handle tokens sent by the user
      for (const [mint, amount] of regularSplSent.entries()) {
        const key = `${tx.signature}:${mint}:out`;
        if (!processedTokensInTx.has(key)) {
          // Determine proceeds (associated SOL value for outgoing SPL)
          let proceeds = 0;
          
          if (isDirectSwap) {
            // For direct SPL-to-SPL swaps, use the WSOL movements as the SOL value
            // for both tokens, ensuring they get the same value
            if (totalWsolTransferred > 0) {
              // This is the key change - use HALF of the WSOL transfers as SOL value
              // to avoid double-counting when analyzing token values
              proceeds = totalWsolTransferred / 2;
            } else if (userWsolReceived > 0) {
              // Fallback to direct WSOL received by user
              proceeds = userWsolReceived;
            }
          } else {
            // For single-sided operations, or complex multi-token operations
            if (userWsolReceived > 0) {
              // WSOL was directly sent to the user
              proceeds = userWsolReceived;
            } else if (totalWsolTransferred > 0) {
              // WSOL was involved indirectly, but not received by user
              proceeds = totalWsolTransferred / 2; // Fair share estimate
            }
          }
          
          // Create record for outgoing SPL token
          if (amount > 0) {
            analysisInputs.push({
              walletAddress,
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: amount,
              direction: 'out',
              associatedSolValue: proceeds,
            });
            processedTokensInTx.add(key);
          }
        }
      }
      
      // Handle tokens received by the user
      for (const [mint, amount] of regularSplReceived.entries()) {
        const key = `${tx.signature}:${mint}:in`;
        if (!processedTokensInTx.has(key)) {
          // Determine cost (associated SOL value for incoming SPL)
          let cost = 0;
          
          if (isDirectSwap) {
            // For direct SPL-to-SPL swaps, use the WSOL movements as the SOL value
            // for both tokens, ensuring they get the same value
            if (totalWsolTransferred > 0) {
              // This is the key change - use HALF of the WSOL transfers as SOL value
              // to avoid double-counting when analyzing token values
              cost = totalWsolTransferred / 2;
            } else if (userWsolSent > 0) {
              // Fallback to direct WSOL sent by user
              cost = userWsolSent;
            }
          } else {
            // For single-sided operations, or complex multi-token operations
            if (userWsolSent > 0) {
              // WSOL was directly sent by the user
              cost = userWsolSent;
            } else if (totalWsolTransferred > 0) {
              // WSOL was involved indirectly, but not sent by user
              cost = totalWsolTransferred / 2; // Fair share estimate
            }
          }
          
          // Create record for incoming SPL token
          if (amount > 0) {
            analysisInputs.push({
              walletAddress,
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: amount,
              direction: 'in',
              associatedSolValue: cost,
            });
            processedTokensInTx.add(key);
          }
        }
      }
      
      // -- DEBUG logging --
      if (isDirectSwap && totalWsolTransferred > 0 && 
          regularSplSent.size === 1 && regularSplReceived.size === 1) {
        const sentMint = [...regularSplSent.keys()][0];
        const receivedMint = [...regularSplReceived.keys()][0];
        logger.debug(`Direct SPL-to-SPL swap in ${tx.signature}: ` +
                    `${sentMint} → WSOL (${totalWsolTransferred}) → ${receivedMint}`);
      }
      
    } catch (err) {
      logger.error(`Swap parse error for ${tx.signature}`, {
        err,
        sig: tx.signature,
      });
    }
  }

  logger.info(
    `Created ${analysisInputs.length} SPL-legs (wallet=${walletAddress}).`,
  );
  
  // Log transaction statistics
  logger.info(
    `Transaction stats: ${successfulTransactions} successful, ${failedTransactions} failed (${transactions.length} total).`,
  );
  
  // Return only the input records from successful transactions
  return analysisInputs;
}
// Note: This version relies on the original Prisma schema structure for SwapAnalysisInput
// including `direction` and `associatedSolValue`. 