import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { HeliusTransaction, TokenTransfer, NativeTransfer } from '../types/helius-api';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1e9;
const NATIVE_SOL_LAMPORT_THRESHOLD = 100000; // Filter out dust native SOL transfers (0.0001 SOL)
const FEE_PRECISION_THRESHOLD = 0.000000001; // Avoid assigning near-zero fees
const FEE_TRANSFER_THRESHOLD_SOL = 0.1; // Heuristic: Native transfers OUT below this are considered fees/tips
// const TOKEN_FEE_AMOUNT_MATCH_TOLERANCE = 0.001; // 0.1% tolerance for matching token fee amounts (commented out as we are trying a new heuristic)
const TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD = 0.05; // 5% - Heuristic for mapper-level fee identification

// Define the output type matching Prisma's expectations
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

/**
 * Converts lamports to SOL, returning the absolute value.
 * Handles undefined, null, string, and number inputs.
 */
function lamportsToSol(lamports: number | string | undefined | null): number {
    if (lamports === undefined || lamports === null) return 0;
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

    if (!tx.events?.swap || !Array.isArray(tx.events.swap.innerSwaps)) {
        return defaultValue;
    }
    const swapEvent = tx.events.swap;

    // 1. Identify User's Primary In/Out Tokens (Heuristic from top-level transfers)
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

    const currentResult = { ...defaultValue, primaryOutMint, primaryInMint };

    if (!primaryOutMint || !primaryInMint) {
        // logger.debug(`Event Matcher: Could not identify primary user IN/OUT non-WSOL/USDC mints. Sig: ${tx.signature}`); // Removed debug
        return currentResult;
    }
    // logger.debug(`Event Matcher: Identified Primary OUT: ${primaryOutMint}, Primary IN: ${primaryInMint}. Sig: ${tx.signature}`); // Removed debug

    // 2. Scan innerSwaps for values associated with these primaries
    let total_wsol_from_sell = 0;
    let total_usdc_from_sell = 0;
    let total_wsol_to_buy = 0;
    let total_usdc_to_buy = 0;
    const significanceThreshold = 0.00001; // Threshold for considering inner swap amounts

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
        // logger.debug(`Event Matcher: Calculated Values - SOL Sell: ${total_wsol_from_sell.toFixed(9)}, SOL Buy: ${total_wsol_to_buy.toFixed(9)}, USDC Sell: ${total_usdc_from_sell.toFixed(9)}, USDC Buy: ${total_usdc_to_buy.toFixed(9)}. Sig: ${tx.signature}`); // Removed debug

        // 3. Consistency Check & Decision
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
            // logger.debug(`Event Matcher: Found consistent SOL value: ${total_wsol_from_sell.toFixed(9)}. Sig: ${tx.signature}`); // Removed debug
            currentResult.solValue = total_wsol_from_sell;
            return currentResult;
        } else if (usdcConsistent && (!solConsistent || total_wsol_from_sell < significanceThreshold)) {
            // logger.debug(`Event Matcher: Found consistent USDC value: ${total_usdc_from_sell.toFixed(9)}. Sig: ${tx.signature}`); // Removed debug
            currentResult.usdcValue = total_usdc_from_sell;
            return currentResult;
        } else {
             if (solConsistent || usdcConsistent) {
                 logger.warn(`Event Matcher: Ambiguous - Cannot choose between consistent SOL (${solConsistent}) and USDC (${usdcConsistent}). Sig: ${tx.signature}`);
             } else {
                 // logger.debug(`Event Matcher: No single consistent intermediary value found. Sig: ${tx.signature}`); // Removed debug
             }
            return currentResult; // Return with values still 0
        }

    } catch (error) {
        logger.error(`Error during 'Matching Value' event processing. Sig: ${tx.signature}`, { error });
        return currentResult; // Return identified mints even if error occurs
    }
}

/**
 * Processes Helius transactions to extract transfer data relevant for swap analysis.
 * Calculates associated SOL/USDC values using a tiered fallback logic.
 * Calculates fees based on network fee and small native SOL transfers out.
 *
 * @param walletAddress The target wallet address.
 * @param transactions Array of full HeliusTransaction objects.
 * @returns Array of `SwapAnalysisInputCreateData` objects.
 */
export function mapHeliusTransactionsToIntermediateRecords(
  walletAddress: string,
  transactions: HeliusTransaction[],
): SwapAnalysisInputCreateData[] {
  const analysisInputs: SwapAnalysisInputCreateData[] = [];
  const lowerWalletAddress = walletAddress.toLowerCase();

  for (const tx of transactions) {
    if (tx.transactionError) {
      // logger.debug(`Skipping tx ${tx.signature} due to transaction error.`); // Removed debug
      continue;
    }

    try {
      const processedRecordKeys = new Set<string>();
      const lowerWalletAddress = walletAddress.toLowerCase(); // Ensure this is defined early

      // Commenting out userPaidTokenFeesMap as we are trying a new broader heuristic first
      /*
      const userPaidTokenFeesMap = new Map<string, number[]>();
      if (tx.events?.swap?.tokenFees) {
        for (const feeEntry of tx.events.swap.tokenFees) {
          if (feeEntry.userAccount?.toLowerCase() === lowerWalletAddress && feeEntry.mint && feeEntry.rawTokenAmount) {
            const feeAmount = parseRawTokenAmount(feeEntry.rawTokenAmount);
            if (Math.abs(feeAmount) > 0) { 
              if (!userPaidTokenFeesMap.has(feeEntry.mint)) {
                userPaidTokenFeesMap.set(feeEntry.mint, []);
              }
              userPaidTokenFeesMap.get(feeEntry.mint)!.push(Math.abs(feeAmount)); 
            }
          }
        }
      }
      */

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

      // Calculate the net change in Native SOL, WSOL, and USDC for the user
      let netNativeSolChange = 0;
      let wsolChange = 0;
      let usdcChange = 0;

      for (const ad of tx.accountData || []) {
           if (ad.account.toLowerCase() === lowerWalletAddress) {
               netNativeSolChange = lamportsToSol(ad.nativeBalanceChange);
           }
           if (ad.tokenBalanceChanges) {
               for (const tbc of ad.tokenBalanceChanges) {
                   if (tbc.userAccount?.toLowerCase() === lowerWalletAddress) {
                       const changeAmount = parseRawTokenAmount(tbc.rawTokenAmount);
                       if (tbc.mint === SOL_MINT) wsolChange += changeAmount;
                       if (tbc.mint === USDC_MINT) usdcChange += changeAmount;
                   }
               }
           }
      }
      const finalNetUserSolChange = netNativeSolChange + wsolChange;
      const finalNetUserUsdcChange = usdcChange;
      // logger.debug(`Tx ${tx.signature}: Net Native SOL Change=${netNativeSolChange.toFixed(9)}, WSOL Change=${wsolChange.toFixed(9)}, USDC Change=${usdcChange.toFixed(9)} -> Final Net SOL=${finalNetUserSolChange.toFixed(9)}, Final Net USDC=${finalNetUserUsdcChange.toFixed(9)}`); // Removed debug

      // Calculate the total absolute movement and largest transfer of WSOL/USDC
      let totalWsolMovement = 0;
      let largestWsolTransfer = 0;
      let totalUsdcMovement = 0;
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.mint === SOL_MINT) {
              const wsolAmount = Math.abs(safeParseAmount(transfer));
              totalWsolMovement += wsolAmount;
              if (wsolAmount > largestWsolTransfer) largestWsolTransfer = wsolAmount;
          }
          if (transfer.mint === USDC_MINT) {
              totalUsdcMovement += Math.abs(safeParseAmount(transfer));
          }
      }
      // logger.debug(`Tx ${tx.signature}: Total WSOL Movement = ${totalWsolMovement.toFixed(9)}, Largest WSOL Transfer = ${largestWsolTransfer.toFixed(9)}, Total USDC Movement = ${totalUsdcMovement.toFixed(9)}`); // Removed debug

      // --- Heuristic Pre-calculation: Find largest transfer amount for each mint in this transaction ---
      const largestAmountsPerMintInTx = new Map<string, number>(); // Key: mint, Value: largest absolute amount
      const mintTransferCountsInTx = new Map<string, number>(); // Key: mint, Value: count of transfers for this mint

      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.mint && transfer.tokenAmount != null) { // check for null/undefined tokenAmount
              const currentAbsAmount = Math.abs(safeParseAmount(transfer));
              if (currentAbsAmount > 0) {
                  largestAmountsPerMintInTx.set(
                      transfer.mint,
                      Math.max(largestAmountsPerMintInTx.get(transfer.mint) || 0, currentAbsAmount)
                  );
                  mintTransferCountsInTx.set(
                      transfer.mint,
                      (mintTransferCountsInTx.get(transfer.mint) || 0) + 1
                  );
              }
          }
      }
      // --- End Heuristic Pre-calculation ---

      // Detect SPL-to-SPL swaps using WSOL as an intermediary
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
      const maxTokenTypesForSimpleSwap = 3; // Heuristic threshold
      const hasReasonableTokenCount = userNonWsolTokensOut.size <= maxTokenTypesForSimpleSwap && userNonWsolTokensIn.size <= maxTokenTypesForSimpleSwap;
      const absSolChange = Math.abs(finalNetUserSolChange);
      const isApproximatelyDouble = largestWsolTransfer > 0 && (Math.abs(absSolChange - (2 * largestWsolTransfer)) / absSolChange < 0.20); // Ratio check heuristic
      if (hasTokensInBothDirections && largestWsolTransfer > 0 && (isApproximatelyDouble || hasReasonableTokenCount)) {
          isSplToSplSwap = true;
          correctSolValueForSplToSpl = largestWsolTransfer; // Use largest WSOL transfer as value
          // logger.debug(`Detected SPL-to-SPL swap with WSOL intermediary: ${tx.signature}`); // Removed debug
          // logger.debug(`Using largest WSOL transfer (${correctSolValueForSplToSpl.toFixed(9)}) as SOL value.`); // Removed debug
      }

      // Attempt to find intermediary value from swap events if not detected as SPL-to-SPL
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN';
      let eventResult: { solValue: number; usdcValue: number; primaryOutMint: string | null; primaryInMint: string | null } = { solValue: 0, usdcValue: 0, primaryOutMint: null, primaryInMint: null };
      if (!isSplToSplSwap && tx.events?.swap) {
          eventResult = findIntermediaryValueFromEvent(tx, userAccounts);
      }

      // Process Native SOL Transfers (excluding dust amounts)
      for (const transfer of tx.nativeTransfers || []) {
           const rawLamports = transfer.amount;
           if (rawLamports === undefined || rawLamports === null) continue;
           const lamportsNum = typeof rawLamports === 'string' ? parseInt(rawLamports, 10) : Number(rawLamports);
           if (isNaN(lamportsNum)) continue;
           if (Math.abs(lamportsNum) < NATIVE_SOL_LAMPORT_THRESHOLD) continue; // Filter dust

           const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
           const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
           if (!isFromUser && !isToUser) continue; // Only transfers involving the user

           const amount = lamportsToSol(rawLamports);
           const direction = isToUser ? 'in' : 'out';
           const mint = SOL_MINT;
           const associatedSolValue = amount; // Native SOL's value is itself
           const associatedUsdcValue = 0;
           const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromUserAccount ?? 'N/A'}:${transfer.toUserAccount ?? 'N/A'}:${amount.toFixed(9)}`;

           if (processedRecordKeys.has(recordKey)) continue;

           analysisInputs.push({
               walletAddress: walletAddress, signature: tx.signature, timestamp: tx.timestamp,
               mint: mint, amount: amount, direction: direction,
               associatedSolValue: associatedSolValue, associatedUsdcValue: associatedUsdcValue,
               interactionType: interactionType,
               feeAmount: null, // Native transfers don't get the calculated fee assigned here
               feePercentage: null,
           });
           processedRecordKeys.add(recordKey);
      }

      // Process SPL Token Transfers
      for (const transfer of tx.tokenTransfers || []) {
            let currentTransferAmount = 0, mint: string | undefined, isWsol = false, isUsdc = false;
            let direction: 'in' | 'out' | null = null;
            let associatedSolValue = 0, associatedUsdcValue = 0;

             currentTransferAmount = safeParseAmount(transfer); 
             const currentAbsTransferAmount = Math.abs(currentTransferAmount);

             if (currentAbsTransferAmount === 0) continue;
             mint = transfer.mint;
             if (!mint) continue;
             isWsol = mint === SOL_MINT; isUsdc = mint === USDC_MINT;

             const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
             const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);
             if (toUserTA && !fromUserTA) direction = 'in';
             else if (fromUserTA && !toUserTA) direction = 'out';
             else if (fromUserTA && toUserTA) direction = 'out'; // Treat self-transfers as 'out'
             if (!direction) continue;

             // --- Apply Heuristic for Small Outgoing Transfers --- 
             let applyFeeHeuristic = false;
             if (direction === 'out' && mint && largestAmountsPerMintInTx.has(mint)) {
                const largestAmtForThisMint = largestAmountsPerMintInTx.get(mint)!;
                const countForThisMint = mintTransferCountsInTx.get(mint) || 0;

                if (countForThisMint > 1 && 
                    currentAbsTransferAmount < largestAmtForThisMint && // Ensure it's not the largest amount itself
                    currentAbsTransferAmount < (TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD * largestAmtForThisMint)) {
                    applyFeeHeuristic = true;
                    logger.debug(`Tx ${tx.signature}, Mint ${mint}: Applying mapper heuristic. Outgoing amount ${currentAbsTransferAmount.toFixed(6)} is < ${TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD*100}% of largest amount ${largestAmtForThisMint.toFixed(6)} for this mint in tx (and other transfers of this mint exist). Setting associatedSolValue to 0.`);
                }
             }

             if (applyFeeHeuristic) {
                associatedSolValue = 0; 
                associatedUsdcValue = 0;
             } else {
                 // --- Original Value Association Logic (if not a heuristic-identified fee) ---
                 if (isWsol) {
                      associatedSolValue = currentAbsTransferAmount; // WSOL value is its amount
                 } else if (isUsdc) {
                      associatedUsdcValue = currentAbsTransferAmount; // USDC value is its amount
                 } else {
                      // Non-WSOL/USDC: Use tiered logic
                       const netChangeSignificanceThreshold = 0.0001;
                       const movementSignificanceThreshold = 0.0001;

                       // 1. SPL-to-SPL Check
                       if (isSplToSplSwap && correctSolValueForSplToSpl > 0) {
                           associatedSolValue = correctSolValueForSplToSpl;
                       } else {
                           // 2. Event Matching Check
                           const eventSolFound = eventResult.solValue > 0; const eventUsdcFound = eventResult.usdcValue > 0;
                           let eventValueApplied = false;
                           const isPrimaryOutTokenFromEvent = direction === 'out' && mint === eventResult.primaryOutMint;
                           const isPrimaryInTokenFromEvent = direction === 'in' && mint === eventResult.primaryInMint;
                           if ((isPrimaryInTokenFromEvent || isPrimaryOutTokenFromEvent)) {
                               if (eventSolFound) { associatedSolValue = eventResult.solValue; eventValueApplied = true; }
                               else if (eventUsdcFound) { associatedUsdcValue = eventResult.usdcValue; eventValueApplied = true; }
                           }

                           // 3. Fallback: Total Movement Heuristic
                           if (!eventValueApplied && associatedSolValue === 0 && associatedUsdcValue === 0) {
                            const wsolMoveIsSignificant = totalWsolMovement >= movementSignificanceThreshold;
                            const usdcMoveIsSignificant = totalUsdcMovement >= movementSignificanceThreshold;
                            if (wsolMoveIsSignificant && !usdcMoveIsSignificant) {
                                associatedSolValue = totalWsolMovement;
                            } else if (usdcMoveIsSignificant && !wsolMoveIsSignificant) {
                                associatedUsdcValue = totalUsdcMovement;
                            }
                            // If both or neither significant, do nothing here, move to next fallback
                        }

                        // 4. Fallback: Net User SOL/USDC Change
                        if (associatedSolValue === 0 && associatedUsdcValue === 0) {
                            const absSolChange = Math.abs(finalNetUserSolChange);
                            const absUsdcChange = Math.abs(finalNetUserUsdcChange);
                            const solChangeIsSignificant = absSolChange >= netChangeSignificanceThreshold;
                            const usdcChangeIsSignificant = absUsdcChange >= netChangeSignificanceThreshold;

                            if (solChangeIsSignificant && !usdcChangeIsSignificant) {
                                associatedSolValue = absSolChange;
                                // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Assigned via Fallback Net SOL Change: ${associatedSolValue.toFixed(9)}`); // Removed debug
                            } else if (usdcChangeIsSignificant && !solChangeIsSignificant) {
                                associatedUsdcValue = absUsdcChange; // If USDC logic is needed
                            }
                        }
                   }
              }
          }
            // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): AssocSOL=${associatedSolValue.toFixed(9)}, AssocUSDC=${associatedUsdcValue.toFixed(9)}`); // Removed debug


            // --- Fee Calculation & Assignment (Only for non-WSOL/USDC transfers with associated SOL value) ---
            let feeAmount: number | null = null;
            let feePercentage: number | null = null;

            if (!isWsol && !isUsdc && associatedSolValue > FEE_PRECISION_THRESHOLD) {
                 // Calculate refined fee (network fee + small native transfers out)
                let refinedFeeAmountSol = 0;
                const networkFee = tx.fee ?? 0;
                if (networkFee > 0 && tx.feePayer?.toLowerCase() === lowerWalletAddress) {
                    refinedFeeAmountSol += networkFee / LAMPORTS_PER_SOL;
                }
                for (const nativeTransfer of tx.nativeTransfers || []) {
                    // Only transfers OUT from user to others, below the threshold
                    if (nativeTransfer.fromUserAccount?.toLowerCase() !== lowerWalletAddress || nativeTransfer.toUserAccount?.toLowerCase() === lowerWalletAddress) continue;
                    const transferAmountSol = lamportsToSol(nativeTransfer.amount);
                    if (transferAmountSol > 0 && transferAmountSol < FEE_TRANSFER_THRESHOLD_SOL) {
                        refinedFeeAmountSol += transferAmountSol;
                         // logger.debug(`Tx ${tx.signature}: Added small native transfer to fee amount: ${transferAmountSol.toFixed(9)} SOL to ${nativeTransfer.toUserAccount}`); // Removed debug
                    }
                }

                // Assign fee if it's significant
                if (refinedFeeAmountSol > FEE_PRECISION_THRESHOLD) {
                    feeAmount = refinedFeeAmountSol;
                    feePercentage = (feeAmount / associatedSolValue) * 100;
                    // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Assigned: Refined Fee=${feeAmount.toFixed(9)}, Percentage=${feePercentage.toFixed(4)}`); // Removed debug
                } else {
                    // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Skipped: No significant refined fee paid by user.`); // Removed debug
                }
            } // else { if (!isWsol && !isUsdc) logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Skipped: AssocSOL=0.`); } // Removed debug


            // --- Push Record ---
            const recordAmount = currentTransferAmount;
            const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromTokenAccount ?? 'N/A'}:${transfer.toTokenAccount ?? 'N/A'}:${recordAmount.toFixed(9)}`;
            if (processedRecordKeys.has(recordKey)) continue;

            analysisInputs.push({
                 walletAddress: walletAddress,
                 signature: tx.signature,
                 timestamp: tx.timestamp,
                 mint: mint,
                 amount: recordAmount,
                 direction: direction,
                 associatedSolValue: associatedSolValue,
                 associatedUsdcValue: associatedUsdcValue,
                 interactionType: interactionType,
                 feeAmount: feeAmount, // Calculated fee (or null)
                 feePercentage: feePercentage, // Calculated percentage (or null)
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