import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { HeliusTransaction, TokenTransfer, NativeTransfer } from '../types/helius-api';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1e9;
const NATIVE_SOL_LAMPORT_THRESHOLD = 100000; // Equivalent to 0.0001 SOL (Dust filter)
const NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD = 20000; // Equivalent to 0.00002 SOL (Fee filter for outgoing)
const FEE_PRECISION_THRESHOLD = 0.000000001; // To avoid assigning near-zero fees

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
 * Analyzes transaction event data to find a consistent
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

    // Ensure swap events structure exists before proceeding - but don't restrict to SWAP type
    if (!tx.events?.swap || !Array.isArray(tx.events.swap.innerSwaps)) {
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
            logger.debug(`Event Matcher: Found consistent SOL value: ${total_wsol_from_sell.toFixed(9)}. Sig: ${tx.signature}`);
            currentResult.solValue = total_wsol_from_sell; 
            return currentResult; 
        } else if (usdcConsistent && (!solConsistent || total_wsol_from_sell < significanceThreshold)) {
             logger.debug(`Event Matcher: Found consistent USDC value: ${total_usdc_from_sell.toFixed(9)}. Sig: ${tx.signature}`);
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
 * [Original Logic + Explicit Fees] Processes Helius transactions to extract transfer data relevant for swap analysis.
 * Uses original logic for value association.
 * Calculates fees based ONLY on explicit SOL costs (base fee + native transfers out from user),
 * assigned ONLY if original logic found a non-zero associatedSolValue.
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

      // --- Populate userAccounts (Original Logic) ---
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
      // --- End Populate userAccounts ---


      // --- Calculate Total Explicit SOL Costs (Once per Tx) ---
      let totalExplicitSolCostLamports = 0;
      const networkFee = tx.fee ?? 0;
      if (networkFee > 0 && tx.feePayer?.toLowerCase() === lowerWalletAddress) {
          totalExplicitSolCostLamports += networkFee;
          logger.debug(`Tx ${tx.signature}: Added base network fee: ${networkFee} lamports.`);
      }
      for (const transfer of tx.nativeTransfers || []) {
           // Add native SOL sent FROM user TO someone else
           if (transfer.fromUserAccount?.toLowerCase() !== lowerWalletAddress || transfer.toUserAccount?.toLowerCase() === lowerWalletAddress) continue;
           const lamportsNum = typeof transfer.amount === 'string' ? parseInt(transfer.amount, 10) : Number(transfer.amount);
           // Ensure the amount is valid and positive (outgoing cost)
           if (!isNaN(lamportsNum) && lamportsNum > 0) {
               totalExplicitSolCostLamports += lamportsNum;
                logger.debug(`Tx ${tx.signature}: Added explicit native SOL cost: ${lamportsNum} lamports to ${transfer.toUserAccount}.`);
           }
      }
      const totalExplicitSolCosts = totalExplicitSolCostLamports / LAMPORTS_PER_SOL;
      logger.debug(`Tx ${tx.signature}: Total Explicit SOL Costs Calculated: ${totalExplicitSolCosts.toFixed(9)}`);
      // --- End Explicit Cost Calculation ---


      // --- Supporting Calculations (RESTORED Original Logic) ---
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

      // Calculate the total absolute movement of WSOL and USDC in the transaction
      let totalWsolMovement = 0;
      let largestWsolTransfer = 0; // Track the largest WSOL transfer amount
      let totalUsdcMovement = 0;
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.mint === SOL_MINT) {
              const wsolAmount = Math.abs(safeParseAmount(transfer));
              totalWsolMovement += wsolAmount;
              if (wsolAmount > largestWsolTransfer) {
                  largestWsolTransfer = wsolAmount;
              }
          }
          if (transfer.mint === USDC_MINT) {
              totalUsdcMovement += Math.abs(safeParseAmount(transfer));
          }
      }
      logger.debug(`Tx ${tx.signature}: Total WSOL Movement = ${totalWsolMovement.toFixed(9)}, Largest WSOL Transfer = ${largestWsolTransfer.toFixed(9)}, Total USDC Movement = ${totalUsdcMovement.toFixed(9)}`);

      // UNIFIED SPL-to-SPL DETECTION logic
      let isSplToSplSwap = false;
      let correctSolValueForSplToSpl = 0;
      const userNonWsolTokensOut = new Set<string>();
      const userNonWsolTokensIn = new Set<string>();
      for (const transfer of tx.tokenTransfers || []) {
          if (!transfer.mint || transfer.mint === SOL_MINT) continue;
          const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
          if (isFromUser && !isToUser) userNonWsolTokensOut.add(transfer.mint);
          if (!isFromUser && isToUser) userNonWsolTokensIn.add(transfer.mint);
      }
      const hasTokensInBothDirections = userNonWsolTokensOut.size > 0 && userNonWsolTokensIn.size > 0;
      const maxTokenTypesForSimpleSwap = 3;
      const hasReasonableTokenCount = userNonWsolTokensOut.size <= maxTokenTypesForSimpleSwap && userNonWsolTokensIn.size <= maxTokenTypesForSimpleSwap;
      const absSolChange = Math.abs(finalNetUserSolChange);
      const isApproximatelyDouble = largestWsolTransfer > 0 && (Math.abs(absSolChange - (2 * largestWsolTransfer)) / absSolChange < 0.20);
      if (hasTokensInBothDirections && largestWsolTransfer > 0 && (isApproximatelyDouble || hasReasonableTokenCount)) {
          isSplToSplSwap = true;
          correctSolValueForSplToSpl = largestWsolTransfer;
          logger.debug(`Detected SPL-to-SPL swap with WSOL intermediary: ${tx.signature} (Type: ${tx.type || 'UNKNOWN'}, OUT: ${Array.from(userNonWsolTokensOut).join(', ')}, IN: ${Array.from(userNonWsolTokensIn).join(', ')})`);
          logger.debug(`Using largest WSOL transfer (${correctSolValueForSplToSpl.toFixed(9)}) as SOL value...`);
      }

      // Event Parsing Logic
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN';
      let eventResult: { solValue: number; usdcValue: number; primaryOutMint: string | null; primaryInMint: string | null } = { solValue: 0, usdcValue: 0, primaryOutMint: null, primaryInMint: null };
      if (!isSplToSplSwap && tx.events?.swap) {
          eventResult = findIntermediaryValueFromEvent(tx, userAccounts);
      }
      // --- End RESTORED Supporting Calculations ---


      // --- Process Native SOL Transfers (Original Logic) ---
      // Ensure this loop is exactly your original logic
      for (const transfer of tx.nativeTransfers || []) {
           // *Your original filtering and value assignment logic here*
           // Example structure:
           const rawLamports = transfer.amount;
           if (rawLamports === undefined || rawLamports === null) continue;
           const lamportsNum = typeof rawLamports === 'string' ? parseInt(rawLamports, 10) : Number(rawLamports);
           if (isNaN(lamportsNum)) continue;
           // Apply original filters
           if (Math.abs(lamportsNum) < NATIVE_SOL_LAMPORT_THRESHOLD) continue;
           const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
           const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
            // Apply original NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD filter if it existed in original
            const NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD = 20000; // Define if used below
           // if (isFromUser && !isToUser && Math.abs(lamportsNum) < NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD) continue;
           if (!isFromUser && !isToUser) continue;

           const amount = lamportsToSol(rawLamports); // Original uses absolute value
           const direction = isToUser ? 'in' : 'out';
           const mint = SOL_MINT;
           const associatedSolValue = amount; // Native SOL's value is itself
           const associatedUsdcValue = 0;
           // Use original key generation logic
           const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromUserAccount ?? 'N/A'}:${transfer.toUserAccount ?? 'N/A'}:${amount.toFixed(9)}`;

           if (processedRecordKeys.has(recordKey)) continue; // Original check

           analysisInputs.push({
               walletAddress: walletAddress, signature: tx.signature, timestamp: tx.timestamp,
               mint: mint, amount: amount, direction: direction,
               associatedSolValue: associatedSolValue, associatedUsdcValue: associatedUsdcValue,
               interactionType: interactionType,
               feeAmount: null, // <<< Ensure this is null for native transfers
               feePercentage: null,
           });
           processedRecordKeys.add(recordKey); // Original key tracking
      }
      // --- End Native SOL Transfers ---


      // --- Process SPL Token Transfers (Original Logic + Fee Layer) ---
      for (const transfer of tx.tokenTransfers || []) {
            // !!! IMPORTANT: Ensure this entire block is your original, working code !!!
            // --- START OF ORIGINAL VALUE ASSOCIATION LOGIC ---
            let currentTransferAmount = 0, mint: string | undefined, isWsol = false, isUsdc = false;
            let direction: 'in' | 'out' | null = null;
            let associatedSolValue = 0, associatedUsdcValue = 0, valueSource = 'unknown'; // Determined by THIS block

             // YOUR ACTUAL ORIGINAL LOGIC TO DETERMINE ALL THE ABOVE VARIABLES GOES HERE
             // Example:
             currentTransferAmount = Math.abs(safeParseAmount(transfer)); // Use original safeParseAmount
             if (currentTransferAmount === 0) continue;
             mint = transfer.mint;
             if (!mint) continue;
             isWsol = mint === SOL_MINT; isUsdc = mint === USDC_MINT;
             const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
             const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);
             if (toUserTA && !fromUserTA) direction = 'in';
             else if (fromUserTA && !toUserTA) direction = 'out';
             else if (fromUserTA && toUserTA) direction = 'out';
             if (!direction) continue;

             if (isWsol) {
                  associatedSolValue = currentTransferAmount; valueSource = 'direct_wsol';
             } else if (isUsdc) {
                  associatedUsdcValue = currentTransferAmount; valueSource = 'direct_usdc';
             } else {
                  // Non-WSOL/USDC Logic (using RESTORED calculations)
                   valueSource = 'unassigned';
                   const netChangeSignificanceThreshold = 0.0001; // Threshold for considering net change significant
                   const movementSignificanceThreshold = 0.0001; // Threshold for considering movement significant

                   // 1. SPL-to-SPL Check
                   if (isSplToSplSwap && correctSolValueForSplToSpl > 0) {
                       associatedSolValue = correctSolValueForSplToSpl; valueSource = 'spl_to_spl_wsol_intermediary';
                   } else {
                       const eventSolFound = eventResult.solValue > 0; const eventUsdcFound = eventResult.usdcValue > 0;
                       let eventValueApplied = false;
                       const isPrimaryOutTokenFromEvent = direction === 'out' && mint === eventResult.primaryOutMint;
                       const isPrimaryInTokenFromEvent = direction === 'in' && mint === eventResult.primaryInMint;
                       if ((isPrimaryInTokenFromEvent || isPrimaryOutTokenFromEvent)) {
                           if (eventSolFound) { associatedSolValue = eventResult.solValue; valueSource = direction === 'in' ? 'event_matched_sol_in' : 'event_matched_sol_out'; eventValueApplied = true; }
                           else if (eventUsdcFound) { associatedUsdcValue = eventResult.usdcValue; valueSource = direction === 'in' ? 'event_matched_usdc_in' : 'event_matched_usdc_out'; eventValueApplied = true; }
                       }
                       // 3. Fallback: Total Movement Heuristic
                       if (!eventValueApplied && associatedSolValue === 0 && associatedUsdcValue === 0) {
                        valueSource = 'fallback_check';
                        const wsolMoveIsSignificant = totalWsolMovement >= movementSignificanceThreshold;
                        const usdcMoveIsSignificant = totalUsdcMovement >= movementSignificanceThreshold;
                        if (wsolMoveIsSignificant && !usdcMoveIsSignificant) {
                            associatedSolValue = totalWsolMovement;
                            associatedUsdcValue = 0;
                            valueSource = 'fallback_total_wsol_movement';
                        } else if (usdcMoveIsSignificant && !wsolMoveIsSignificant) {
                            associatedUsdcValue = totalUsdcMovement;
                            associatedSolValue = 0;
                            valueSource = 'fallback_total_usdc_movement';
                        } else {
                        }
                    } // <<< Closing brace for Tier 3 block

                    // 4. Fallback: Net User SOL/USDC Change (SHOULD BE HERE, AFTER TIER 3)
                    if (associatedSolValue === 0 && associatedUsdcValue === 0) {
                        valueSource = 'fallback_net_change_check';
                        const absSolChange = Math.abs(finalNetUserSolChange);
                        const absUsdcChange = Math.abs(finalNetUserUsdcChange);
                        const solChangeIsSignificant = absSolChange >= netChangeSignificanceThreshold;
                        const usdcChangeIsSignificant = absUsdcChange >= netChangeSignificanceThreshold;

                        if (solChangeIsSignificant && !usdcChangeIsSignificant) {
                            logger.debug(`>>> ENTERING TIER 4 ASSIGNMENT (SOL CHANGE): Current AssocSOL=${associatedSolValue}, Assigning ${absSolChange}`);
                            associatedSolValue = absSolChange;
                            associatedUsdcValue = 0;
                            valueSource = 'fallback_net_sol_change';
                            logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Assigned via Fallback Net SOL Change: ${associatedSolValue.toFixed(9)}`);
                        } else if (usdcChangeIsSignificant && !solChangeIsSignificant) {
                            // Similar check could be added for USDC if needed, comparing absUsdcChange and totalExplicitUsdcCosts (if calculated)
                            // ... assign net usdc change ...
                        } else {
                            valueSource = 'fallback_failed_all';
                        }
                    } // <<< Closing brace for Tier 4 block

               } // <<< Closing brace for the `else` containing Tiers 2, 3, 4
          } // <<< Closing brace for the main non-WSOL/USDC `else` block

            // Log the result of the original logic BEFORE fee calculation
            logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Original Logic Result: AssocSOL=${associatedSolValue.toFixed(9)}, AssocUSDC=${associatedUsdcValue.toFixed(9)}, Source=${valueSource}`);
            // --- END OF ORIGINAL VALUE ASSOCIATION LOGIC ---


            // --- Fee Assignment Layer (Runs AFTER original logic) ---
            let feeAmount: number | null = null;
            let feePercentage: number | null = null;

            const FEE_TRANSFER_THRESHOLD_SOL = 0.1; // Heuristic: Native transfers out below this are considered fees/tips
            let refinedFeeAmountSol = 0;

            // Start with network fee
            const networkFee = tx.fee ?? 0;
            if (networkFee > 0 && tx.feePayer?.toLowerCase() === lowerWalletAddress) {
                refinedFeeAmountSol += networkFee / LAMPORTS_PER_SOL;
            }

            // Add small native transfers OUT
            for (const transfer of tx.nativeTransfers || []) {
                if (transfer.fromUserAccount?.toLowerCase() !== lowerWalletAddress || transfer.toUserAccount?.toLowerCase() === lowerWalletAddress) continue; // Only transfers OUT from user to others
                const transferAmountSol = lamportsToSol(transfer.amount);
                if (transferAmountSol > 0 && transferAmountSol < FEE_TRANSFER_THRESHOLD_SOL) {
                    refinedFeeAmountSol += transferAmountSol;
                    logger.debug(`Tx ${tx.signature}: Added small native transfer to fee amount: ${transferAmountSol.toFixed(9)} SOL to ${transfer.toUserAccount}`);
                }
            }

            if (!isWsol && !isUsdc) {
                if (associatedSolValue > FEE_PRECISION_THRESHOLD) { // Check result from original logic
                    if (refinedFeeAmountSol > FEE_PRECISION_THRESHOLD) { // Check if total refined fee is significant
                        feeAmount = refinedFeeAmountSol;
                        feePercentage = (feeAmount / associatedSolValue) * 100;
                        logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Assigned: Refined Fee (Network + Small Native Out)=${feeAmount.toFixed(9)} (AssocSOL > 0). Percentage=${feePercentage.toFixed(4)}`);
                    } else {
                        logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Skipped: No significant refined fee (network + small native out) paid by user.`);
                    }
                } else {
                    logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Skipped: Original logic found AssocSOL=0.`);
                }
            }
            // --- End Fee Assignment Layer ---


            // --- Push Record (Original + Fees) ---
            const recordAmount = currentTransferAmount;
            // Use original key generation logic
            const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromTokenAccount ?? 'N/A'}:${transfer.toTokenAccount ?? 'N/A'}:${recordAmount.toFixed(9)}`;
            if (processedRecordKeys.has(recordKey)) continue; // Original check

            analysisInputs.push({
                 walletAddress: walletAddress,
                 signature: tx.signature,
                 timestamp: tx.timestamp,
                 mint: mint,
                 amount: recordAmount,
                 direction: direction,
                 associatedSolValue: associatedSolValue, // Value from original logic
                 associatedUsdcValue: associatedUsdcValue, // Value from original logic
                 interactionType: interactionType, // Original type
                 feeAmount: feeAmount, // Fee determined by the layer above
                 feePercentage: feePercentage, // Fee determined by the layer above
            });
            processedRecordKeys.add(recordKey); // Original key tracking
      }
      // --- End SPL Token Transfers ---

    } catch (err) {
        // ... Original error handling ...
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