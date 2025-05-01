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

// Helper to convert lamports to SOL
function lamportsToSol(lamports: number | string | undefined | null): number {
    if (lamports === undefined || lamports === null) return 0;
    // Ensure input is treated as a number, even if it's a string representation of a number
    const num = typeof lamports === 'string' ? parseFloat(lamports) : Number(lamports); 
    return isNaN(num) ? 0 : Math.abs(num) / LAMPORTS_PER_SOL; 
}

// Helper function to parse rawTokenAmount safely from accountData.tokenBalanceChanges
function parseRawTokenAmount(rawAmountData: any): number {
    if (!rawAmountData || rawAmountData.tokenAmount === undefined || rawAmountData.decimals === undefined) {
        return 0;
    }
    try {
        const { tokenAmount, decimals } = rawAmountData;
        // Use BigInt for potentially large raw amounts before converting to number
        const raw = BigInt(String(tokenAmount)); 
        // Using Number() for conversion after division
        const scaledAmount = Number(raw) / Math.pow(10, decimals); 
        return isNaN(scaledAmount) ? 0 : scaledAmount; // Return the signed amount
    } catch (e) {
        logger.warn('Error parsing rawTokenAmount', { data: rawAmountData, error: e });
        return 0;
    }
}

// Helper to safely parse token amount from the tokenTransfers array
// Assumes transfer.tokenAmount is already scaled correctly for this context.
function safeParseAmount(transfer: TokenTransfer | any): number { 
  if (!transfer || transfer.tokenAmount === undefined || transfer.tokenAmount === null) {
    return 0;
  }
  try {
    // Directly parse the tokenAmount field
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
 * [VALUE-CENTRIC REFINED] Processes Helius transactions to extract swap-related data.
 * Creates records for both native SOL and SPL token transfers involving the user.
 * Associates non-SOL/USDC transfers with the net SOL or USDC movement within the transaction.
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
  const lowerWalletAddress = walletAddress.toLowerCase();

  for (const tx of transactions) {
    if (tx.transactionError) {
      logger.debug(`Skipping tx ${tx.signature} due to transaction error.`);
      continue; 
    }

    try {
      const processedRecordKeys = new Set<string>(); // Track unique records generated per TX

      // -- STEP 0: Identify user's token accounts (including the main wallet address itself for native transfers) --
      const userAccounts = new Set<string>([lowerWalletAddress]); // Start with the main wallet
      // Populate from accountData.tokenBalanceChanges owners
      for (const ad of tx.accountData || []) {
          if (ad.tokenBalanceChanges) {
              for (const tbc of ad.tokenBalanceChanges) {
                  // Ensure we capture the owner of the token account if it matches the user
                  if (tbc.userAccount?.toLowerCase() === lowerWalletAddress && tbc.tokenAccount) {
                      userAccounts.add(tbc.tokenAccount);
                  }
              }
          }
      }
      // Populate from tokenTransfers owners/accounts
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress && transfer.fromTokenAccount) {
              userAccounts.add(transfer.fromTokenAccount);
          }
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress && transfer.toTokenAccount) {
              userAccounts.add(transfer.toTokenAccount);
          }
      }
      // Native transfers involve the main wallet address directly
      // logger.debug(`User accounts for tx ${tx.signature}: ${Array.from(userAccounts).join(', ')}`);

      // --- STEP 1: Calculate Net User SOL/USDC Movements using accountData ---
      let netNativeSolChange = 0;
      let wsolChange = 0;
      let usdcChange = 0;

      // Calculate net changes from accountData
      for (const ad of tx.accountData || []) {
           // Get Native SOL change for the main wallet
           if (ad.account.toLowerCase() === lowerWalletAddress) {
               netNativeSolChange = lamportsToSol(ad.nativeBalanceChange);
               // Note: lamportsToSol returns absolute value, need to re-apply sign if needed
               // However, for net change, sum of signed token changes + net native change is fine.
           }

           // Accumulate Token Balance Changes for user-owned accounts
           if (ad.tokenBalanceChanges) {
               for (const tbc of ad.tokenBalanceChanges) {
                   // Ensure this change is for an account owned by the user we are analyzing
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
      
      // Final net changes including native and wrapped SOL
      const finalNetUserSolChange = netNativeSolChange + wsolChange;
      const finalNetUserUsdcChange = usdcChange;
      
      logger.debug(`Tx ${tx.signature}: Net Native SOL Change=${netNativeSolChange.toFixed(9)}, WSOL Change=${wsolChange.toFixed(9)}, USDC Change=${usdcChange.toFixed(9)} -> Final Net SOL=${finalNetUserSolChange.toFixed(9)}, Final Net USDC=${finalNetUserUsdcChange.toFixed(9)}`);

      // Calculate total WSOL and USDC movement in the transaction as primary context sources
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

      // --- STEP 2: Create Records from Native Transfers (Optional but retained for direct native moves) ---
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN';

      for (const transfer of tx.nativeTransfers || []) {
          // *** USE LAMPORT THRESHOLD CHECK FOR DUST ***
          const rawLamports = transfer.amount;
          if (rawLamports === undefined || rawLamports === null) continue; // Skip if no amount
          
          const lamportsNum = typeof rawLamports === 'string' ? parseInt(rawLamports, 10) : Number(rawLamports);
          if (isNaN(lamportsNum)) continue; // Skip if not a valid number
          
          // Check absolute lamport value against the general dust threshold
          if (Math.abs(lamportsNum) < NATIVE_SOL_LAMPORT_THRESHOLD) continue;
          
          // Determine direction and apply specific outgoing fee filter
          const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;

          // *** ADDED OUTGOING FEE FILTER ***
          if (isFromUser && !isToUser && Math.abs(lamportsNum) < NATIVE_SOL_OUT_FEE_FILTER_THRESHOLD) {
              // If it's outgoing and smaller than the fee filter threshold, skip it
              logger.debug(`Skipping outgoing native transfer below fee threshold: ${lamportsNum} lamports`);
              continue; 
          }
          
          // If it passes thresholds and filters, now calculate the SOL amount and create record
          const amount = lamportsToSol(rawLamports); 
          
          if (!isFromUser && !isToUser) continue; // Only process transfers involving the user (redundant check, but safe)

          const direction = isToUser ? 'in' : 'out';
          const mint = SOL_MINT; // Native SOL
          const associatedSolValue = amount; // SOL value is its own amount
          const associatedUsdcValue = 0; // Default to 0 instead of null for Prisma

          // Use a more specific key for native transfers
          const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromUserAccount}:${transfer.toUserAccount}:${amount.toFixed(9)}`;
          if (processedRecordKeys.has(recordKey)) continue;

          analysisInputs.push({
              walletAddress: walletAddress,
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: amount,
              direction: direction,
              associatedSolValue: associatedSolValue,
              associatedUsdcValue: associatedUsdcValue, // Use 0 default
              interactionType: interactionType, // Use transaction-level type
          });
          processedRecordKeys.add(recordKey);
          // logger.debug(`Added Native Record: ${recordKey}`);
      }

      // --- STEP 3: Create Records from Token Transfers ---
      for (const transfer of tx.tokenTransfers || []) {
          const amount = Math.abs(safeParseAmount(transfer)); // Use absolute amount now
          if (amount === 0) continue;

          const mint = transfer.mint;
          if (!mint) {
              logger.warn(`Skipping token transfer in tx ${tx.signature} due to missing mint`, { transfer });
              continue; // Cannot process without a mint
          }
          
          const isWsol = mint === SOL_MINT;
          const isUsdc = mint === USDC_MINT;
          
          // Check involvement based on *token accounts*
          const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
          const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);

          // Determine direction (treat self-transfers as 'out' for simplicity, adjust if needed)
          let direction: 'in' | 'out' | null = null;
          if (toUserTA && !fromUserTA) direction = 'in';
          else if (fromUserTA && !toUserTA) direction = 'out';
          else if (fromUserTA && toUserTA) direction = 'out'; // Or potentially 'self'? Or skip?

          if (!direction) continue; // Skip if user not directly involved via these token accounts

          let associatedSolValue: number = 0; // Default to 0
          let associatedUsdcValue: number = 0; // Default to 0

          // *** USE FINAL NET CHANGES FOR ASSOCIATION ***
          if (isWsol) {
              associatedSolValue = amount; 
          } else if (isUsdc) {
              associatedUsdcValue = amount;
          } else {
              // Associate based on the priority: Total WSOL Movement > Total USDC Movement > Net Native SOL Change
              const significanceThreshold = 0.0001; // Define what negligible means

              if (totalWsolMovement >= significanceThreshold) {
                  // 1. Prioritize Total WSOL Movement
                  associatedSolValue = totalWsolMovement;
                  logger.debug(`Tx ${tx.signature}, Mint ${mint}: Using total WSOL movement (${totalWsolMovement.toFixed(9)}) as primary SOL context.`);
              } else if (totalUsdcMovement >= significanceThreshold) {
                  // 2. Prioritize Total USDC Movement if WSOL wasn't significant
                  associatedUsdcValue = totalUsdcMovement;
                  logger.debug(`Tx ${tx.signature}, Mint ${mint}: Using total USDC movement (${totalUsdcMovement.toFixed(9)}) as primary USDC context.`);
              } else if (Math.abs(netNativeSolChange) >= significanceThreshold) {
                  // 3. Use Net Native SOL Change as last resort for SOL context
                  associatedSolValue = Math.abs(netNativeSolChange); 
                  logger.debug(`Tx ${tx.signature}, Mint ${mint}: Using net native SOL change (${netNativeSolChange.toFixed(9)}) as fallback SOL context.`);
              }
              // If none are significant, values remain 0.
              
              logger.debug(`Tx ${tx.signature}, Mint ${mint}: Linking to Final Associated SOL=${associatedSolValue?.toFixed(9)}, Final Associated USDC=${associatedUsdcValue?.toFixed(9)}`);
          }

          const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromTokenAccount}:${transfer.toTokenAccount}:${amount.toFixed(9)}`;
          if (processedRecordKeys.has(recordKey)) continue; // Skip duplicates

          analysisInputs.push({
              walletAddress: walletAddress,
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: amount,
              direction: direction,
              associatedSolValue: associatedSolValue, // Use 0 default
              associatedUsdcValue: associatedUsdcValue, // Use 0 default
              interactionType: interactionType, // Use transaction-level type
          });
          processedRecordKeys.add(recordKey);
          // logger.debug(`Added Token Record: ${recordKey}`);
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
