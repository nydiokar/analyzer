import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client'; // Import Prisma namespace for input types
import {
  HeliusTransaction,
  TokenTransfer,
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
    return isNaN(num) ? 0 : Math.abs(num) / LAMPORTS_PER_SOL;
}

// Helper to safely parse token amount
function safeParseAmount(holder: any): number {
  if (!holder) return 0;

  /* 1️⃣ canonical rawTokenAmount path */
  if (holder.rawTokenAmount?.tokenAmount !== undefined) {
    const { tokenAmount, decimals } = holder.rawTokenAmount;
    const raw = parseFloat(String(tokenAmount));
    return isNaN(raw) ? 0 : Math.abs(raw) / Math.pow(10, decimals ?? 0);
  }

  /* 2️⃣ tokenAmount already human readable (number or string) */
  if (holder.tokenAmount !== undefined) {
    const raw =
      typeof holder.tokenAmount === 'number'
        ? holder.tokenAmount
        : parseFloat(String(holder.tokenAmount));
    return isNaN(raw) ? 0 : Math.abs(raw);
  }

  /* 3️⃣ fallback for Exotic shapes { amount, decimals } */
  if (holder.amount !== undefined) {
    const raw =
      typeof holder.amount === 'number' ? holder.amount : parseFloat(String(holder.amount));
    if (isNaN(raw)) return 0;
    const decimals = typeof holder.decimals === 'number' ? holder.decimals : 0;
    return Math.abs(raw) / Math.pow(10, decimals);
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
      continue; // Skip failed transactions
    }

    try {
      const processedTokensInTx = new Set<string>(); // Prevent duplicates if tx structure is odd

      // -- STEP 1: Calculate Potential SOL/WSOL Values from Transfers --
      const tokensSent = new Map<string, { amount: number, transfers: TokenTransfer[] }>();
      const tokensReceived = new Map<string, { amount: number, transfers: TokenTransfer[] }>();
      let userWsolSent = 0;
      let userWsolReceived = 0;
      let userNativeSolSent = 0;
      let userNativeSolReceived = 0;
      let maxIntermediaryWsolTransfer = 0;

      // Process Token Transfers
      for (const transfer of tx.tokenTransfers || []) {
          const amount = safeParseAmount(transfer);
          if (amount <= 0) continue;

          const fromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const toUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
          const isWsol = transfer.mint === SOL_MINT;

          if (isWsol) {
              if (fromUser) userWsolSent += amount;
              if (toUser) userWsolReceived += amount;
              if (!fromUser && !toUser && amount > maxIntermediaryWsolTransfer) {
                 maxIntermediaryWsolTransfer = amount;
              }
          } else {
              if (fromUser) {
                  const current = tokensSent.get(transfer.mint) || { amount: 0, transfers: [] };
                  current.amount += amount;
                  current.transfers.push(transfer);
                  tokensSent.set(transfer.mint, current);
              }
              if (toUser) {
                  const current = tokensReceived.get(transfer.mint) || { amount: 0, transfers: [] };
                  current.amount += amount;
                  current.transfers.push(transfer);
                  tokensReceived.set(transfer.mint, current);
              }
          }
      }

      // Process Native Transfers
      for (const transfer of tx.nativeTransfers || []) {
          const amount = lamportsToSol(transfer.amount);
          if (amount <= 0) continue;

          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress) {
              userNativeSolSent += amount;
          }
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress) {
              userNativeSolReceived += amount;
          }
      }

      // Get Native Balance Change (for final fallback)
      const userAccountData = tx.accountData?.find(ad => ad.account.toLowerCase() === lowerWalletAddress);
      const userNativeSolChange = userAccountData ? lamportsToSol(userAccountData.nativeBalanceChange) : 0;

      // -- STEP 2: Determine the Single Dominant Value for the Transaction --
      // Priority: P1 (User WSOL) > P2 (Intermediary WSOL) > P3 (Native Balance Change)
      // Direct native transfers are excluded as they often represent fees/tips, not the swap value.
      // Stablecoins (like USDC) are currently not factored into this SOL value; requires separate handling.
      let txValue = 0;
      let source = 'P4_Default_Zero'; // Default if nothing else found

      const maxUserWsolTransfer = Math.max(userWsolSent, userWsolReceived);
      // const maxUserNativeTransfer = Math.max(userNativeSolSent, userNativeSolReceived); // Removed from primary logic

      if (maxUserWsolTransfer > txValue) {
          txValue = maxUserWsolTransfer;
          source = 'P1_DirectUserWSOL';
      }
      // Check intermediary WSOL only if direct user WSOL wasn't the max
      if (source !== 'P1_DirectUserWSOL' && maxIntermediaryWsolTransfer > txValue) {
          txValue = maxIntermediaryWsolTransfer;
          source = 'P2_IntermediaryWSOL';
      }
       // Fallback to native balance change only if WSOL wasn't involved
       // Use Math.abs because nativeBalanceChange reflects net change (can be negative if user received SOL)
       if (source === 'P4_Default_Zero' && userNativeSolChange !== 0) {
           txValue = Math.abs(userNativeSolChange);
           source = 'P3_NativeBalanceChange';
       }
       // Removed check for maxUserNativeTransfer

       logger.debug(`Tx ${tx.signature}: Determined dominant txValue=${txValue} from ${source}`);

      // -- STEP 3: Create Records, Applying the Dominant Value --
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN'; // Keep original type

      // Handle Tokens Sent (OUT)
      for (const [mint, data] of tokensSent.entries()) {
           for (const transfer of data.transfers) { // Use individual transfers for amount
                const uniqueRecordKey = `${tx.signature}:${mint}:out:${transfer.fromTokenAccount}:${transfer.toTokenAccount}`;
                if (processedTokensInTx.has(uniqueRecordKey)) continue;

                const amount = safeParseAmount(transfer);
                if(amount > 0) {
                    analysisInputs.push({
                        walletAddress: lowerWalletAddress,
                        signature: tx.signature,
                        timestamp: tx.timestamp,
                        mint: mint,
                        amount: amount,
                        direction: 'out',
                        associatedSolValue: txValue, // Apply the single transaction value
                        interactionType: interactionType,
                    });
                    processedTokensInTx.add(uniqueRecordKey);
                }
           }
      }

       // Handle Tokens Received (IN)
       for (const [mint, data] of tokensReceived.entries()) {
           for (const transfer of data.transfers) {
                const uniqueRecordKey = `${tx.signature}:${mint}:in:${transfer.fromTokenAccount}:${transfer.toTokenAccount}`;
                if (processedTokensInTx.has(uniqueRecordKey)) continue;

                const amount = safeParseAmount(transfer);
                if (amount > 0) {
                    analysisInputs.push({
                        walletAddress: lowerWalletAddress,
                        signature: tx.signature,
                        timestamp: tx.timestamp,
                        mint: mint,
                        amount: amount,
                        direction: 'in',
                        associatedSolValue: txValue, // Apply the single transaction value
                        interactionType: interactionType,
                    });
                    processedTokensInTx.add(uniqueRecordKey);
                }
           }
      }

    } catch (err) {
      logger.error(`Value-centric parse error for ${tx.signature}`, {
        error: err instanceof Error ? err.message : String(err),
        sig: tx.signature,
      });
    }
  }

  return analysisInputs;
}
