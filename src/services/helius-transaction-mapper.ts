import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { HeliusTransaction, TokenTransfer, NativeTransfer } from '../types/helius-api';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1e9;
const NATIVE_SOL_LAMPORT_THRESHOLD = 100000; // Equivalent to 0.0001 SOL (Dust filter)
const NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD = 20000; // Equivalent to 0.00002 SOL (Fee filter for outgoing)

// Define the output type matching Prisma's expectations
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

/**
 * Converts lamports to SOL, returning the absolute value.
 * Handles undefined, null, string, and number inputs.
 *
 * @param lamports The amount in lamports.
 * @returns The equivalent SOL amount (absolute value), or 0 if input is invalid.
 */
function lamportsToSol(lamports: number | string | undefined | null): number {
    if (lamports === undefined || lamports === null) return 0;
    // Ensure input is treated as a number, even if it's a string representation of a number
    const num = typeof lamports === 'string' ? parseFloat(lamports) : Number(lamports); 
    return isNaN(num) ? 0 : Math.abs(num) / LAMPORTS_PER_SOL; 
}

/**
 * Safely parses the token amount from the `rawTokenAmount` structure found in Helius `accountData.tokenBalanceChanges`.
 * Handles potential BigInts and scaling based on decimals.
 *
 * @param rawAmountData The object possibly containing `tokenAmount` and `decimals`. Expected structure: `{ tokenAmount: string | number, decimals: number }`.
 * @returns The scaled, signed token amount as a number, or 0 if parsing fails or data is missing.
 */
function parseRawTokenAmount(rawAmountData: any): number {
    if (!rawAmountData || rawAmountData.tokenAmount === undefined || rawAmountData.decimals === undefined) {
        return 0;
    }
    try {
        const { tokenAmount, decimals } = rawAmountData;
        const raw = BigInt(String(tokenAmount)); 
        const scaledAmount = Number(raw) / Math.pow(10, decimals); 
        return isNaN(scaledAmount) ? 0 : scaledAmount; // Return the signed amount
    } catch (e) {
        logger.warn('Error parsing rawTokenAmount', { data: rawAmountData, error: e });
        return 0;
    }
}

/**
 * Safely parses the token amount directly from the `tokenAmount` field within a `TokenTransfer` object.
 * Assumes this `tokenAmount` is already correctly scaled (human-readable).
 *
 * @param transfer The Helius `TokenTransfer` object or a similar structure containing `tokenAmount`.
 * @returns The token amount as a number, or 0 if parsing fails or data is missing.
 */
function safeParseAmount(transfer: TokenTransfer | any): number { 
  if (!transfer || transfer.tokenAmount === undefined || transfer.tokenAmount === null) {
    return 0;
  }
  try {
    const amount = typeof transfer.tokenAmount === 'number' 
        ? transfer.tokenAmount 
        : parseFloat(String(transfer.tokenAmount));
    return isNaN(amount) ? 0 : amount; // Return signed amount
  } catch (e) {
    logger.warn('Error in safeParseAmount (direct tokenAmount parsing)', { data: transfer, error: e });
    return 0;
  }
}

// *** HELPER FUNCTION - "Matching Value" Strategy ***
/**
 * Analyzes Helius swap event data, specifically innerSwaps, to find a consistent
 * intermediary WSOL or USDC value linking the user's primary input token to their
 * primary output token for the overall swap.
 *
 * @param tx The full HeliusTransaction object.
 * @param userAccounts A Set containing the user's main wallet address and associated token accounts.
 * @returns An object containing the matched solValue or usdcValue, and primary mints, or defaults if ambiguous/not found.
 */
function findIntermediaryValueFromEvent(
    tx: HeliusTransaction,
    userAccounts: Set<string>,
): { solValue: number; usdcValue: number; primaryOutMint: string | null; primaryInMint: string | null } {

    const defaultValue = { solValue: 0, usdcValue: 0, primaryOutMint: null, primaryInMint: null };

    // Ensure types and event structure exist before proceeding
    if (tx.type?.toUpperCase() !== 'SWAP' || !tx.events?.swap || !Array.isArray(tx.events.swap.innerSwaps)) {
        return defaultValue;
    }
    const swapEvent = tx.events.swap;

    // --- 1. Identify User's Primary In/Out Tokens (Heuristic from top-level transfers) ---
    let primaryOutMint: string | null = null;
    let primaryInMint: string | null = null;
    for (const transfer of tx.tokenTransfers || []) {
        const mint = transfer.mint;
        if (!mint || mint === SOL_MINT || mint === USDC_MINT) continue; 

        const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
        const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);

        if (fromUserTA && !toUserTA) primaryOutMint = mint; 
        if (toUserTA && !fromUserTA) primaryInMint = mint;  
    }
    
    // Return identified mints even if value isn't found yet
    const currentResult = { ...defaultValue, primaryOutMint, primaryInMint }; 

    if (!primaryOutMint || !primaryInMint) {
         logger.debug(`Event Matcher: Could not identify primary user IN/OUT non-WSOL/USDC mints from top-level transfers. Sig: ${tx.signature}`);
        return currentResult; 
    }
     logger.debug(`Event Matcher: Identified Primary OUT: ${primaryOutMint}, Primary IN: ${primaryInMint}. Sig: ${tx.signature}`);

    // --- 2. Scan innerSwaps for values associated with these primaries ---
    let total_wsol_from_sell = 0;
    let total_usdc_from_sell = 0;
    let total_wsol_to_buy = 0;
    let total_usdc_to_buy = 0;
    const significanceThreshold = 0.00001; 

    try {
        for (const innerSwap of swapEvent.innerSwaps || []) {
            const sellsPrimaryOut = (innerSwap.tokenInputs || []).some((inp: any) => inp.mint === primaryOutMint);
            if (sellsPrimaryOut) {
                for (const output of innerSwap.tokenOutputs || []) {
                    const amount = Math.abs(safeParseAmount(output));
                    if (output.mint === SOL_MINT && amount >= significanceThreshold) total_wsol_from_sell += amount;
                    if (output.mint === USDC_MINT && amount >= significanceThreshold) total_usdc_from_sell += amount;
                }
            }

            const buysPrimaryIn = (innerSwap.tokenOutputs || []).some((out: any) => out.mint === primaryInMint);
            if (buysPrimaryIn) {
                for (const input of innerSwap.tokenInputs || []) {
                     const amount = Math.abs(safeParseAmount(input));
                    if (input.mint === SOL_MINT && amount >= significanceThreshold) total_wsol_to_buy += amount;
                    if (input.mint === USDC_MINT && amount >= significanceThreshold) total_usdc_to_buy += amount;
                }
            }
        }
         logger.debug(`Event Matcher: Calculated Values - SOL Sell: ${total_wsol_from_sell.toFixed(9)}, SOL Buy: ${total_wsol_to_buy.toFixed(9)}, USDC Sell: ${total_usdc_from_sell.toFixed(9)}, USDC Buy: ${total_usdc_to_buy.toFixed(9)}. Sig: ${tx.signature}`);

        // --- 3. Consistency Check & Decision ---
        const tolerance = 0.01; // Allow 1% difference
        let solConsistent = false;
        let usdcConsistent = false;

        if (total_wsol_from_sell >= significanceThreshold && total_wsol_to_buy >= significanceThreshold) {
            solConsistent = Math.abs(total_wsol_from_sell - total_wsol_to_buy) <= tolerance * Math.max(total_wsol_from_sell, total_wsol_to_buy);
        }
        if (total_usdc_from_sell >= significanceThreshold && total_usdc_to_buy >= significanceThreshold) {
            usdcConsistent = Math.abs(total_usdc_from_sell - total_usdc_to_buy) <= tolerance * Math.max(total_usdc_from_sell, total_usdc_to_buy);
        }

        if (solConsistent && (!usdcConsistent || total_usdc_from_sell < significanceThreshold)) {
            logger.info(`Event Matcher: Found consistent SOL value: ${total_wsol_from_sell.toFixed(9)}. Sig: ${tx.signature}`);
            currentResult.solValue = total_wsol_from_sell; 
            return currentResult; 
        } else if (usdcConsistent && (!solConsistent || total_wsol_from_sell < significanceThreshold)) {
             logger.info(`Event Matcher: Found consistent USDC value: ${total_usdc_from_sell.toFixed(9)}. Sig: ${tx.signature}`);
            currentResult.usdcValue = total_usdc_from_sell; 
            return currentResult; 
        } else {
             if (solConsistent || usdcConsistent) { 
                 logger.warn(`Event Matcher: Ambiguous - Cannot choose between consistent SOL (${solConsistent}) and USDC (${usdcConsistent}). Sig: ${tx.signature}`);
             } else {
                 logger.debug(`Event Matcher: No single consistent intermediary value found. Sig: ${tx.signature}`);
             }
            return currentResult; // Return with values still 0
        }

    } catch (error) {
        logger.error(`Error during 'Matching Value' event processing. Sig: ${tx.signature}`, { error });
        return currentResult; // Return identified mints even if error occurs
    }
}
// *** END HELPER FUNCTION ***

/**
 * [VALUE-CENTRIC REFINED] Processes Helius transactions to extract transfer data relevant for swap analysis.
 * Creates granular `SwapAnalysisInput` records for each native SOL and SPL token transfer involving the target wallet.
 * Calculates net SOL/USDC changes and total WSOL/USDC movements within each transaction.
 * Associates non-WSOL/USDC transfers with these calculated SOL/USDC values based on a defined priority
 * (Total WSOL > Total USDC > Net Native SOL) to provide context for later P/L calculation.
 * Includes filtering for dust amounts and small outgoing native SOL transfers (likely fees).
 *
 * @param walletAddress The target wallet address (case-insensitive comparison internally, but stored with original case).
 * @param transactions Array of full HeliusTransaction objects obtained from the Helius API.
 * @returns Array of `SwapAnalysisInputCreateData` objects suitable for Prisma `createMany`.
 */
export function mapHeliusTransactionsToIntermediateRecords(
  walletAddress: string,
  transactions: HeliusTransaction[],
): SwapAnalysisInputCreateData[] {
  const analysisInputs: SwapAnalysisInputCreateData[] = [];
  const lowerWalletAddress = walletAddress.toLowerCase();

  for (const tx of transactions) {
    if (tx.transactionError) {
      logger.debug(`Skipping tx ${tx.signature} due to transaction error.`);
      continue; 
    }

    try {
      const processedRecordKeys = new Set<string>(); // Track unique records generated per TX to prevent duplicates

      // Identify all token accounts owned by the user within this transaction
      const userAccounts = new Set<string>([lowerWalletAddress]); 
      for (const ad of tx.accountData || []) {
          if (ad.tokenBalanceChanges) {
              for (const tbc of ad.tokenBalanceChanges) {
                  if (tbc.userAccount?.toLowerCase() === lowerWalletAddress && tbc.tokenAccount) {
                      userAccounts.add(tbc.tokenAccount);
                  }
              }
          }
      }
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress && transfer.fromTokenAccount) {
              userAccounts.add(transfer.fromTokenAccount);
          }
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress && transfer.toTokenAccount) {
              userAccounts.add(transfer.toTokenAccount);
          }
      }
      
      // Calculate the net change in Native SOL, WSOL, and USDC for the user in this transaction using accountData
      let netNativeSolChange = 0;
      let wsolChange = 0;
      let usdcChange = 0;

      for (const ad of tx.accountData || []) {
           // Native SOL change is taken directly from the user's main account balance change
           if (ad.account.toLowerCase() === lowerWalletAddress) {
               netNativeSolChange = lamportsToSol(ad.nativeBalanceChange);
           }

           // Token changes are summed from relevant token balance changes owned by the user
           if (ad.tokenBalanceChanges) {
               for (const tbc of ad.tokenBalanceChanges) {
                   if (tbc.userAccount?.toLowerCase() === lowerWalletAddress) {
                       const changeAmount = parseRawTokenAmount(tbc.rawTokenAmount);
                       if (tbc.mint === SOL_MINT) {
                           wsolChange += changeAmount;
                       }
                       if (tbc.mint === USDC_MINT) {
                           usdcChange += changeAmount;
                       }
                   }
               }
           }
      }
      
      // Combine native and wrapped SOL changes for the final net SOL change
      const finalNetUserSolChange = netNativeSolChange + wsolChange;
      const finalNetUserUsdcChange = usdcChange;
      
      logger.debug(`Tx ${tx.signature}: Net Native SOL Change=${netNativeSolChange.toFixed(9)}, WSOL Change=${wsolChange.toFixed(9)}, USDC Change=${usdcChange.toFixed(9)} -> Final Net SOL=${finalNetUserSolChange.toFixed(9)}, Final Net USDC=${finalNetUserUsdcChange.toFixed(9)}`);

      // Calculate the total absolute movement of WSOL and USDC in the transaction (sum of all transfers)
      // This serves as the primary context for associating value to other token swaps.
      let totalWsolMovement = 0;
      let totalUsdcMovement = 0;
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.mint === SOL_MINT) {
              totalWsolMovement += Math.abs(safeParseAmount(transfer));
          }
          if (transfer.mint === USDC_MINT) {
              totalUsdcMovement += Math.abs(safeParseAmount(transfer));
          }
      }
      logger.debug(`Tx ${tx.signature}: Total WSOL Movement = ${totalWsolMovement.toFixed(9)}, Total USDC Movement = ${totalUsdcMovement.toFixed(9)}`);

      // --- Attempt event parsing for SWAPs ---
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN'; // Moved interactionType up
      // Initialize eventResult with defaults and explicit type
      let eventResult: { solValue: number; usdcValue: number; primaryOutMint: string | null; primaryInMint: string | null } = { 
          solValue: 0, 
          usdcValue: 0, 
          primaryOutMint: null, 
          primaryInMint: null 
      }; 
      if (interactionType === 'SWAP') {
          // Pass the userAccounts Set identified earlier
          eventResult = findIntermediaryValueFromEvent(tx, userAccounts); 
      }
      // --- eventResult now holds potential matched value ---

      // Create records for Native SOL transfers involving the user, applying filters

      for (const transfer of tx.nativeTransfers || []) {
          const rawLamports = transfer.amount;
          if (rawLamports === undefined || rawLamports === null) continue; 
          
          const lamportsNum = typeof rawLamports === 'string' ? parseInt(rawLamports, 10) : Number(rawLamports);
          if (isNaN(lamportsNum)) continue; 
          
          // Filter 1: Ignore tiny "dust" amounts
          if (Math.abs(lamportsNum) < NATIVE_SOL_LAMPORT_THRESHOLD) continue;
          
          const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;

          // Filter 2: Ignore small *outgoing* transfers below the fee threshold
          if (isFromUser && !isToUser && Math.abs(lamportsNum) < NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD) {
              logger.debug(`Skipping outgoing native transfer below fee threshold: ${lamportsNum} lamports`);
              continue; 
          }
          
          if (!isFromUser && !isToUser) continue; // Only process transfers involving the user

          const amount = lamportsToSol(rawLamports); 
          const direction = isToUser ? 'in' : 'out';
          const mint = SOL_MINT; 
          const associatedSolValue = amount; // Native SOL's value is itself
          const associatedUsdcValue = 0;

          const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromUserAccount}:${transfer.toUserAccount}:${amount.toFixed(9)}`;
          if (processedRecordKeys.has(recordKey)) continue;

          analysisInputs.push({
              walletAddress: walletAddress, // Store with original case
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: amount,
              direction: direction,
              associatedSolValue: associatedSolValue,
              associatedUsdcValue: associatedUsdcValue,
              interactionType: interactionType,
          });
          processedRecordKeys.add(recordKey);
      }

      // Create records for SPL Token transfers involving the user
      for (const transfer of tx.tokenTransfers || []) {
          const amount = Math.abs(safeParseAmount(transfer)); 
          if (amount === 0) continue;

          const mint = transfer.mint;
          if (!mint) {
              logger.warn(`Skipping token transfer in tx ${tx.signature} due to missing mint`, { transfer });
              continue; 
          }
          
          const isWsol = mint === SOL_MINT;
          const isUsdc = mint === USDC_MINT;
          
          // Check if the user's token accounts are involved
          const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
          const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);

          let direction: 'in' | 'out' | null = null;
          if (toUserTA && !fromUserTA) direction = 'in';
          else if (fromUserTA && !toUserTA) direction = 'out';
          else if (fromUserTA && toUserTA) direction = 'out'; // Treat self-transfers as 'out'

          if (!direction) continue; // Skip if user's token accounts aren't involved

          // --- Assign associated value logic ---
          let associatedSolValue: number = 0;
          let associatedUsdcValue: number = 0;
          let valueSource = 'direct'; 

          // 1. Handle direct WSOL/USDC transfers
          if (isWsol) {
              associatedSolValue = amount; // Amount is already absolute here
              valueSource = 'direct_wsol';
          } else if (isUsdc) {
              associatedUsdcValue = amount; // Amount is already absolute here
              valueSource = 'direct_usdc';
          } else {
              // 2. Handle other tokens (SPL, potentially Native converted to SPL like SOL->WSOL)
              // Use the pre-calculated total movements and net change with priority
              const significanceThreshold = 0.0001; 

              if (totalWsolMovement >= significanceThreshold) {
                  associatedSolValue = totalWsolMovement;
                  valueSource = 'priority_total_wsol';
                  logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Associating with total WSOL movement: ${associatedSolValue.toFixed(9)}`);
              } else if (totalUsdcMovement >= significanceThreshold) {
                  associatedUsdcValue = totalUsdcMovement;
                  valueSource = 'priority_total_usdc';
                   logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Associating with total USDC movement: ${associatedUsdcValue.toFixed(9)}`);
              } else if (Math.abs(finalNetUserSolChange) >= significanceThreshold) {
                   // Use absolute value of the net change as the associated value
                  associatedSolValue = Math.abs(finalNetUserSolChange); 
                  valueSource = 'priority_net_sol_change';
                   logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Associating with net SOL change: ${associatedSolValue.toFixed(9)}`);
              } else {
                   valueSource = 'priority_none';
                   logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): No significant priority value found.`);
                   // Values remain 0
              }
          } 
          // Log the final decision (ensure logger is still helpful if needed)
          // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Final Assoc: SOL=${associatedSolValue.toFixed(9)}, USDC=${associatedUsdcValue.toFixed(9)} (Source: ${valueSource})`);
          // --- End Assign associated value logic ---

          // --- Push record --- (Ensure amount used is positive Math.abs)
          const recordAmount = Math.abs(safeParseAmount(transfer)); // Recalculate positive amount for storage
          if (recordAmount === 0) continue; // Skip if zero after abs
          
          // Ensure record key uses consistent data; from/to might be null
          const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromTokenAccount ?? 'N/A'}:${transfer.toTokenAccount ?? 'N/A'}:${recordAmount.toFixed(9)}`;
          if (processedRecordKeys.has(recordKey)) continue;

          analysisInputs.push({
              walletAddress: walletAddress, // Store with original case
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: recordAmount,
              direction: direction,
              associatedSolValue: associatedSolValue,
              associatedUsdcValue: associatedUsdcValue,
              interactionType: interactionType,
          });
          processedRecordKeys.add(recordKey);
      }

    } catch (err) {
      logger.error(`Mapper error processing transaction ${tx.signature}`, {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        sig: tx.signature,
      });
    }
  }

  logger.info(`Mapped ${transactions.length} transactions into ${analysisInputs.length} analysis records for ${walletAddress}`);
  return analysisInputs;
}
