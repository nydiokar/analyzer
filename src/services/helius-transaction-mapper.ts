import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client'; // Import Prisma namespace for input types
import {
  HeliusTransaction,
  TokenTransfer,
  SwapEvent,
  NativeTransfer
} from '../types/helius-api';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // WSOL Mint address
const LAMPORTS_PER_SOL = 1e9;

// Define the output type matching Prisma's expectations
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

// Helper to convert lamports to SOL
function lamportsToSol(lamports: number | string | undefined | null): number {
    if (lamports === undefined || lamports === null) return 0;
    const num = typeof lamports === 'string' ? parseFloat(lamports) : lamports;
    return isNaN(num) ? 0 : num / LAMPORTS_PER_SOL;
}

// Helper to safely parse amount from various structures within SwapEvent
function safeParseAmount(holder: any): number {
  if (!holder) return 0;

  /* 1️⃣ canonical rawTokenAmount path */
  if (holder.rawTokenAmount?.tokenAmount !== undefined) {
    const { tokenAmount, decimals } = holder.rawTokenAmount;
    // Ensure tokenAmount is treated as a string before parsing
    const raw = parseFloat(String(tokenAmount));
    return isNaN(raw) ? 0 : Math.abs(raw) / Math.pow(10, decimals ?? 0);
  }

  /* 2️⃣ tokenAmount already human readable (number or string) */
  if (holder.tokenAmount !== undefined) {
    const raw =
      typeof holder.tokenAmount === 'number'
        ? holder.tokenAmount
        : parseFloat(String(holder.tokenAmount)); // Ensure string before parsing
    return isNaN(raw) ? 0 : Math.abs(raw);
  }

  /* 3️⃣ fallback for Exotic shapes { amount, decimals } */
  if (holder.amount !== undefined) {
    const raw =
      typeof holder.amount === 'number' ? holder.amount : parseFloat(String(holder.amount)); // Ensure string before parsing
    if (isNaN(raw)) return 0;
    const decimals = typeof holder.decimals === 'number' ? holder.decimals : 0;
    return Math.abs(raw) / Math.pow(10, decimals);
  }

  return 0;
}

/**
 * [ENHANCED] Processes Helius transactions to extract all SPL swaps, including SPL->SPL trades.
 * Analyzes both events.swap and comprehensive tokenTransfers to ensure all movements are captured.
 * FIXED to properly handle WSOL as an intermediary token in SPL↔SPL swaps.
 * ENHANCED to populate interactionType and use nativeBalanceChange as fallback for associatedSolValue.
 * REFINED associatedSolValue logic order:
 *   P0: Fee check
 *   P0.5: Check events.swap.nativeInput/nativeOutput
 *   P1: Check WSOL value from innerSwaps (inputs and outputs)
 *   P2: Check direct user WSOL transfers
 *   P3: Check max WSOL transfer between intermediary accounts (from raw transfers)
 *   P4: Fallback to nativeBalanceChange (for SWAP/CREATE)
 *   P5: Default to 0
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
  const lowerWalletAddress = walletAddress.toLowerCase(); // Use consistent lower case

  // Count successful and failed transactions for logging
  let successfulTransactions = 0;
  let failedTransactions = 0;

  for (const tx of transactions) {
    // Skip failed transactions
    if (tx.transactionError) {
      failedTransactions++;
      continue;
    }

    successfulTransactions++;

    try {
      // Track tokens processed to avoid duplicates within the same tx
      const processedTokensInTx = new Set<string>();

      // -- STEP 0: Determine Interaction Type --
      let interactionType: string = 'UNKNOWN'; // Default
      if (tx.type && typeof tx.type === 'string') {
          interactionType = tx.type.toUpperCase(); // Use Helius type directly
      } else if (tx.events?.swap) {
          interactionType = 'SWAP';
      }

      // -- STEP 1: Collect ALL SPL and WSOL transfers involving this wallet --
      const tokensSent = new Map<string, { amount: number, transfers: TokenTransfer[] }>();
      const tokensReceived = new Map<string, { amount: number, transfers: TokenTransfer[] }>();

      for (const transfer of tx.tokenTransfers || []) {
        // Outgoing tokens (user sent)
        if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress) {
          const amount = safeParseAmount(transfer);
          if (amount > 0) {
            const current = tokensSent.get(transfer.mint) || { amount: 0, transfers: [] };
            current.amount += amount;
            current.transfers.push(transfer);
            tokensSent.set(transfer.mint, current);
          }
        }

        // Incoming tokens (user received)
        if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress) {
          const amount = safeParseAmount(transfer);
          if (amount > 0) {
            const current = tokensReceived.get(transfer.mint) || { amount: 0, transfers: [] };
            current.amount += amount;
            current.transfers.push(transfer);
            tokensReceived.set(transfer.mint, current);
          }
        }
      }

      // -- STEP 2: Extract Key Data for SOL Value Calculation --

      // P4 Fallback Data
      const userAccountData = tx.accountData?.find(ad => ad.account.toLowerCase() === lowerWalletAddress);
      const userNativeSolChange = userAccountData ? lamportsToSol(userAccountData.nativeBalanceChange) : 0;

      // P2 Data
      const userWsolSent = tokensSent.has(SOL_MINT) ? tokensSent.get(SOL_MINT)!.amount : 0;
      const userWsolReceived = tokensReceived.has(SOL_MINT) ? tokensReceived.get(SOL_MINT)!.amount : 0;

      // P0.5 Data
      const swapEvent = tx.events?.swap as SwapEvent | undefined;
      const nativeSwapInputSol = lamportsToSol(swapEvent?.nativeInput?.amount);
      const nativeSwapOutputSol = lamportsToSol(swapEvent?.nativeOutput?.amount);

      // P1 Data
      let innerSwapWsolValue = 0;
      if (interactionType === 'SWAP' && swapEvent?.innerSwaps) {
          for (const innerSwap of swapEvent.innerSwaps) {
              // Sum absolute WSOL value from inputs and outputs
              for (const input of innerSwap.tokenInputs || []) {
                  if (input.mint === SOL_MINT) {
                      innerSwapWsolValue += safeParseAmount(input);
                  }
              }
              for (const output of innerSwap.tokenOutputs || []) {
                   if (output.mint === SOL_MINT) {
                       innerSwapWsolValue += safeParseAmount(output);
                   }
              }
          }
          if (innerSwapWsolValue > 0) {
               logger.debug(`[P1 Prep] Calculated innerSwapWsolValue for ${tx.signature}: ${innerSwapWsolValue}`);
          } else {
               logger.debug(`[P1 Prep] No WSOL found in innerSwaps for ${tx.signature}`);
          }
      }

       // P3 Data - Max WSOL Transfer between Intermediaries
       let maxIntermediaryWsolTransfer = 0;
       for (const transfer of tx.tokenTransfers || []) {
           if (transfer.mint === SOL_MINT &&
               transfer.fromUserAccount?.toLowerCase() !== lowerWalletAddress &&
               transfer.toUserAccount?.toLowerCase() !== lowerWalletAddress)
           {
               const amount = safeParseAmount(transfer);
               if (amount > maxIntermediaryWsolTransfer) {
                   maxIntermediaryWsolTransfer = amount;
               }
           }
       }
        if (maxIntermediaryWsolTransfer > 0) {
           logger.debug(`[P3 Prep] Found maxIntermediaryWsolTransfer for ${tx.signature}: ${maxIntermediaryWsolTransfer}`);
        }

      // -- STEP 3: Get regular SPL tokens (excluding WSOL) that were transferred --
      const regularSplSent = new Map<string, { amount: number, transfers: TokenTransfer[] }>();
      const regularSplReceived = new Map<string, { amount: number, transfers: TokenTransfer[] }>();

      for (const [mint, data] of tokensSent.entries()) {
        if (mint !== SOL_MINT) {
          regularSplSent.set(mint, data);
        }
      }

      for (const [mint, data] of tokensReceived.entries()) {
        if (mint !== SOL_MINT) {
          regularSplReceived.set(mint, data);
        }
      }

      // STEP 4: Not needed as a separate step

      // -- STEP 5: Create the records with prioritized associated SOL values --

      // Detect potential fee transfers
      const potentialFeeTransfers = new Set<string>();
      for (const [mint, sentData] of regularSplSent.entries()) {
        if (regularSplReceived.has(mint)) {
          const receivedData = regularSplReceived.get(mint)!;
          if (sentData.amount < receivedData.amount * 0.05) {
            for (const transfer of sentData.transfers) {
              potentialFeeTransfers.add(`${tx.signature}:${mint}:${transfer.fromTokenAccount}:${transfer.toTokenAccount}`);
            }
          }
        }
      }

      // Handle tokens sent by the user ("out" direction)
      for (const [mint, data] of regularSplSent.entries()) {
        for (const transfer of data.transfers) {
          const transferKey = `${tx.signature}:${mint}:${transfer.fromTokenAccount}:${transfer.toTokenAccount}`;
          const uniqueRecordKey = `${tx.signature}:${mint}:out:${transfer.fromTokenAccount}`;

          if (!processedTokensInTx.has(uniqueRecordKey)) {
            let proceeds = 0;
            let priorityUsed = 'P5'; // Default to lowest priority
            const amount = safeParseAmount(transfer);
            const isFeeTransfer = potentialFeeTransfers.has(transferKey);

            // --- Calculate Proceeds (SOL Value for Outgoing SPL) ---
            if (isFeeTransfer) {
              proceeds = 0; // P0
              priorityUsed = 'P0';
            } else if (interactionType === 'SWAP' && nativeSwapOutputSol > 0) {
                proceeds = nativeSwapOutputSol; // P0.5
                priorityUsed = 'P0.5';
            } else if (interactionType === 'SWAP' && innerSwapWsolValue > 0) {
                proceeds = innerSwapWsolValue; // P1
                priorityUsed = 'P1';
            } else if (interactionType === 'SWAP' && userWsolReceived > 0) {
                proceeds = userWsolReceived; // P2
                priorityUsed = 'P2';
            } else if (interactionType === 'SWAP' && maxIntermediaryWsolTransfer > 0) {
                proceeds = maxIntermediaryWsolTransfer; // P3
                priorityUsed = 'P3';
            }
            else if ((interactionType === 'SWAP' || interactionType === 'CREATE') && userNativeSolChange > 0) {
                proceeds = Math.abs(userNativeSolChange); // P4
                priorityUsed = 'P4';
            }
            // --- End Proceeds Calculation ---

            logger.debug(`Tx ${tx.signature}, Out ${mint}: Value=${proceeds} determined by ${priorityUsed}`);

            if (amount > 0) {
              analysisInputs.push({
                walletAddress: lowerWalletAddress,
                signature: tx.signature,
                timestamp: tx.timestamp,
                mint: mint,
                amount: amount,
                direction: 'out',
                associatedSolValue: proceeds,
                interactionType: interactionType,
              });
              processedTokensInTx.add(uniqueRecordKey);
            }
          }
        }
      }

      // Handle tokens received by the user ("in" direction)
      for (const [mint, data] of regularSplReceived.entries()) {
        for (const transfer of data.transfers) {
          const uniqueRecordKey = `${tx.signature}:${mint}:in:${transfer.toTokenAccount}`;

          if (!processedTokensInTx.has(uniqueRecordKey)) {
            let cost = 0;
            let priorityUsed = 'P5'; // Default to lowest priority
            const amount = safeParseAmount(transfer);
            const transferKey = `${tx.signature}:${mint}:${transfer.fromTokenAccount}:${transfer.toTokenAccount}`;
            const isFeeTransfer = potentialFeeTransfers.has(transferKey);

            // --- Calculate Cost (SOL Value for Incoming SPL) ---
            if (isFeeTransfer) {
                 cost = 0; // P0
                 priorityUsed = 'P0';
            } else if (interactionType === 'SWAP' && nativeSwapInputSol > 0) {
                cost = nativeSwapInputSol; // P0.5
                priorityUsed = 'P0.5';
            } else if (interactionType === 'SWAP' && innerSwapWsolValue > 0) {
                cost = innerSwapWsolValue; // P1
                priorityUsed = 'P1';
            } else if (interactionType === 'SWAP' && userWsolSent > 0) {
                cost = userWsolSent; // P2
                priorityUsed = 'P2';
            } else if (interactionType === 'SWAP' && maxIntermediaryWsolTransfer > 0) {
                cost = maxIntermediaryWsolTransfer; // P3
                priorityUsed = 'P3';
            }
            else if ((interactionType === 'SWAP' || interactionType === 'CREATE') && userNativeSolChange < 0) {
                cost = Math.abs(userNativeSolChange); // P4
                priorityUsed = 'P4';
            } else {
                // Default stays P5 / cost = 0
            }
            // --- End Cost Calculation ---

             logger.debug(`Tx ${tx.signature}, In ${mint}: Value=${cost} determined by ${priorityUsed}`);

            if (amount > 0) {
              analysisInputs.push({
                walletAddress: lowerWalletAddress,
                signature: tx.signature,
                timestamp: tx.timestamp,
                mint: mint,
                amount: amount,
                direction: 'in',
                associatedSolValue: cost,
                interactionType: interactionType,
              });
              processedTokensInTx.add(uniqueRecordKey);
            }
          }
        }
      }

    } catch (err) {
      logger.error(`Swap parse error for ${tx.signature}`, {
        error: err instanceof Error ? err.message : String(err),
        sig: tx.signature,
      });
    }
  }

  // Log final stats if needed

  return analysisInputs;
}
// Note: This version relies on the original Prisma schema structure for SwapAnalysisInput
// including `direction`, `associatedSolValue`, and the optional `interactionType`. 