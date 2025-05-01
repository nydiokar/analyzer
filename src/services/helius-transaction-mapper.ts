import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { HeliusTransaction, TokenTransfer, NativeTransfer } from '../types/helius-api';
// Removed BigNumber dependency as we will use standard numbers for Prisma

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1e9;

// Define the output type matching Prisma's expectations
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

// Helper to convert lamports to SOL
function lamportsToSol(lamports: number | string | undefined | null): number {
    if (lamports === undefined || lamports === null) return 0;
    const num = typeof lamports === 'string' ? parseFloat(lamports) : lamports;
    // Using standard number division
    return isNaN(num) ? 0 : Math.abs(num) / LAMPORTS_PER_SOL; 
}

// Helper to safely parse token amount - RETURNS number
function safeParseAmount(holder: any): number {
  if (!holder) return 0;

  try {
      if (holder.rawTokenAmount?.tokenAmount !== undefined) {
        const { tokenAmount, decimals } = holder.rawTokenAmount;
        const raw = parseFloat(String(tokenAmount));
        return isNaN(raw) ? 0 : Math.abs(raw) / Math.pow(10, decimals ?? 0);
      }
      if (holder.tokenAmount !== undefined) {
         // Handles cases where amount might be pre-formatted number or string
         const raw = typeof holder.tokenAmount === 'number' ? holder.tokenAmount : parseFloat(String(holder.tokenAmount));
         return isNaN(raw) ? 0 : Math.abs(raw);
      }
      if (holder.amount !== undefined) {
         // Fallback for exotic shapes { amount, decimals }
         const raw = typeof holder.amount === 'number' ? holder.amount : parseFloat(String(holder.amount));
         if (isNaN(raw)) return 0;
         const decimals = typeof holder.decimals === 'number' ? holder.decimals : 0;
         return Math.abs(raw) / Math.pow(10, decimals);
      }
  } catch (e) {
      logger.warn('Error in safeParseAmount', { data: holder, error: e });
  }
  return 0;
}

/**
 * [VALUE-CENTRIC] Processes Helius transactions to extract swap-related data.
 * Determines a single dominant SOL/WSOL value for the transaction based on transfers
 * and applies it uniformly to all user SPL legs.
 * Minimizes reliance on Helius event structures or type classification.
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
      continue; 
    }

    try {
      const processedRecordKeys = new Set<string>(); // Track unique records generated

      // -- STEP 0: Identify user's token accounts --
      const userTokenAccounts = new Set<string>();
      // Populate from accountData.tokenBalanceChanges
      for (const ad of tx.accountData || []) {
          if (ad.tokenBalanceChanges) {
              for (const tbc of ad.tokenBalanceChanges) {
                  if (tbc.userAccount?.toLowerCase() === lowerWalletAddress && tbc.tokenAccount) {
                      userTokenAccounts.add(tbc.tokenAccount);
                  }
              }
          }
      }
       // Populate from tokenTransfers (sender/receiver owner)
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress && transfer.fromTokenAccount) {
              userTokenAccounts.add(transfer.fromTokenAccount);
          }
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress && transfer.toTokenAccount) {
              userTokenAccounts.add(transfer.toTokenAccount);
          }
      }
      // Add main wallet if involved in native transfers
      for (const transfer of tx.nativeTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress) userTokenAccounts.add(lowerWalletAddress);
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress) userTokenAccounts.add(lowerWalletAddress);
      }
      
      // --- STEP 1: Calculate TOTAL WSOL/USDC Movement for Context --- 
      let totalUserWsolSent = 0;
      let totalUserWsolReceived = 0;
      let totalUserUsdcSent = 0;
      let totalUserUsdcReceived = 0;
      let maxIntermediaryWsolTransfer = 0;

      for (const transfer of tx.tokenTransfers || []) {
          const amount = safeParseAmount(transfer);
          if (amount === 0) continue;
          const fromUserTA = transfer.fromTokenAccount && userTokenAccounts.has(transfer.fromTokenAccount);
          const toUserTA = transfer.toTokenAccount && userTokenAccounts.has(transfer.toTokenAccount);
          const isWsol = transfer.mint === SOL_MINT;
          const isUsdc = transfer.mint === USDC_MINT;

          if (isWsol) {
              if (fromUserTA) totalUserWsolSent += amount;
              if (toUserTA) totalUserWsolReceived += amount;
              if (!fromUserTA && !toUserTA && amount > maxIntermediaryWsolTransfer) {
                 maxIntermediaryWsolTransfer = amount;
              }
          } else if (isUsdc) {
              if (fromUserTA) totalUserUsdcSent += amount;
              if (toUserTA) totalUserUsdcReceived += amount;
          }
      }

      // --- STEP 2: Determine Dominant SOL Value (txValue) --- 
      const netNativeSolChange = lamportsToSol(tx.accountData?.find(ad => ad.account.toLowerCase() === lowerWalletAddress)?.nativeBalanceChange);
      let txValue = 0;
      let source = 'P4_Default_Zero';
      const maxUserWsolTotal = Math.max(totalUserWsolSent, totalUserWsolReceived);

      if (maxUserWsolTotal > txValue) {
          txValue = maxUserWsolTotal;
          source = 'P1_UserWSOLTotal';
      }
      if (source !== 'P1_UserWSOLTotal' && maxIntermediaryWsolTransfer > txValue) {
          txValue = maxIntermediaryWsolTransfer;
          source = 'P2_IntermediaryWSOL';
      }
      if (source === 'P4_Default_Zero' && netNativeSolChange !== 0) {
          txValue = Math.abs(netNativeSolChange);
          source = 'P3_NetNativeBalanceChange';
      }
      logger.debug(`Tx ${tx.signature}: Dominant txValue=${txValue} from ${source}`);
      
      // --- STEP 3: Create Individual Records for Each User Transfer Leg --- 
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN';
      
      for (const transfer of tx.tokenTransfers || []) {
          const fromUserTA = transfer.fromTokenAccount && userTokenAccounts.has(transfer.fromTokenAccount);
          const toUserTA = transfer.toTokenAccount && userTokenAccounts.has(transfer.toTokenAccount);

          // Only process transfers directly involving user's token accounts
          if (!fromUserTA && !toUserTA) continue;
          
          const amount = safeParseAmount(transfer);
          if (amount === 0) continue;
          
          const mint = transfer.mint;
          const isUsdc = mint === USDC_MINT;
          const isWsol = mint === SOL_MINT;
          
          // Determine direction based on which side belongs to user
          // Handle cases where both might be user (self-transfer - rare but possible)
          let direction: 'in' | 'out' | null = null;
          if (toUserTA && !fromUserTA) direction = 'in';
          else if (fromUserTA && !toUserTA) direction = 'out';
          else if (fromUserTA && toUserTA) direction = 'out'; // Treat self-transfers as 'out' for simplicity? Or skip?
          // Skip if direction couldn't be determined (shouldn't happen if from/toUserTA logic is correct)
          if (!direction) continue; 
              
          // Generate unique key for this specific transfer leg
          const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromTokenAccount}:${transfer.toTokenAccount}:${amount.toFixed(9)}`; 
          if (processedRecordKeys.has(recordKey)) continue; // Skip duplicates

          // Determine associated USDC value context
          const associatedUsdcValue = (!isWsol && !isUsdc) 
              ? (direction === 'in' ? (totalUserUsdcSent > 0 ? totalUserUsdcSent : null) : (totalUserUsdcReceived > 0 ? totalUserUsdcReceived : null))
              : null;

          analysisInputs.push({
              walletAddress: lowerWalletAddress,
              signature: tx.signature,
              timestamp: tx.timestamp,
              mint: mint,
              amount: amount, // Amount of this specific transfer
              direction: direction,
              associatedSolValue: txValue, // Transaction-wide SOL value context
              associatedUsdcValue: associatedUsdcValue, // Transaction-wide USDC value context (for non-WSOL/USDC)
              interactionType: interactionType,
          });
          processedRecordKeys.add(recordKey);
      }
      
      // NOTE: This approach doesn't explicitly create records for Native SOL movements.
      // The SOL value context is captured in `associatedSolValue`.

    } catch (err) {
      logger.error(`Mapper error for ${tx.signature}`, {
        error: err instanceof Error ? err.message : String(err),
        sig: tx.signature,
      });
    }
  }

  return analysisInputs;
}
