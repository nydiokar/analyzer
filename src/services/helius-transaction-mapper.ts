import { createLogger } from '../utils/logger';
import { Prisma } from '@prisma/client'; // Import Prisma namespace for input types
import {
  HeliusTransaction,
  TokenTransfer,
  NativeTransfer
} from '../types/helius-api';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // WSOL Mint address
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC Mint Address
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

      // -- STEP 0: Identify user's token accounts involved in this transaction --
      const userTokenAccounts = new Set<string>();
      for (const ad of tx.accountData || []) {
          if (ad.tokenBalanceChanges) {
              for (const tbc of ad.tokenBalanceChanges) {
                  if (tbc.userAccount?.toLowerCase() === lowerWalletAddress && tbc.tokenAccount) {
                      userTokenAccounts.add(tbc.tokenAccount);
                  }
              }
          }
      }
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress && transfer.fromTokenAccount) {
              userTokenAccounts.add(transfer.fromTokenAccount);
          }
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress && transfer.toTokenAccount) {
              userTokenAccounts.add(transfer.toTokenAccount);
          }
      }
      for (const transfer of tx.nativeTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress) userTokenAccounts.add(lowerWalletAddress);
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress) userTokenAccounts.add(lowerWalletAddress);
      }

      // -- STEP 1: Calculate Values from Transfers --
      const tokensSent = new Map<string, { amount: number, transfers: TokenTransfer[] }>();
      const tokensReceived = new Map<string, { amount: number, transfers: TokenTransfer[] }>();
      let userWsolSent = 0;
      let userWsolReceived = 0;
      let userNativeSolSent = 0;
      let userNativeSolReceived = 0;
      let maxIntermediaryWsolTransfer = 0;
      let userUsdcSent = 0;
      let userUsdcReceived = 0;

      // Process Token Transfers (Using userTokenAccounts for relevance)
      for (const transfer of tx.tokenTransfers || []) {
          const amount = safeParseAmount(transfer);
          if (amount <= 0) continue;

          const fromUserTokenAccount = transfer.fromTokenAccount && userTokenAccounts.has(transfer.fromTokenAccount);
          const toUserTokenAccount = transfer.toTokenAccount && userTokenAccounts.has(transfer.toTokenAccount);
          const isWsol = transfer.mint === SOL_MINT;
          const isUsdc = transfer.mint === USDC_MINT;

          // Track User WSOL based on token account involvement
          if (isWsol) {
              if (fromUserTokenAccount) userWsolSent += amount;
              if (toUserTokenAccount) userWsolReceived += amount;
              if (!fromUserTokenAccount && !toUserTokenAccount && amount > maxIntermediaryWsolTransfer) {
                 maxIntermediaryWsolTransfer = amount;
              }
          }
          // Track User USDC based on token account involvement
          else if (isUsdc) {
              if (fromUserTokenAccount) userUsdcSent += amount;
              if (toUserTokenAccount) userUsdcReceived += amount;
          }

          // Group other SPL tokens based on token account involvement
          if (fromUserTokenAccount && !isWsol && !isUsdc) {
              const current = tokensSent.get(transfer.mint) || { amount: 0, transfers: [] };
              current.amount += amount;
              current.transfers.push(transfer);
              tokensSent.set(transfer.mint, current);
          }
          if (toUserTokenAccount && !isWsol && !isUsdc) {
              const current = tokensReceived.get(transfer.mint) || { amount: 0, transfers: [] };
              current.amount += amount;
              current.transfers.push(transfer);
              tokensReceived.set(transfer.mint, current);
          }
      }

      // Process Native Transfers (based on main user account - unchanged)
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

      // Get Native Balance Change (unchanged)
      const userAccountData = tx.accountData?.find(ad => ad.account.toLowerCase() === lowerWalletAddress);
      const userNativeSolChange = userAccountData ? lamportsToSol(userAccountData.nativeBalanceChange) : 0;

      // -- STEP 2: Determine the Single Dominant Value for the Transaction --
      // Priority: P1 (User WSOL via Token Accounts) > P2 (Intermediary WSOL) > P3 (Native Balance Change)
      let txValue = 0;
      let source = 'P4_Default_Zero';
      const maxUserWsolTransfer = Math.max(userWsolSent, userWsolReceived); // Based on token accounts

      if (maxUserWsolTransfer > txValue) {
          txValue = maxUserWsolTransfer;
          source = 'P1_DirectUserWSOL';
      }
      if (source !== 'P1_DirectUserWSOL' && maxIntermediaryWsolTransfer > txValue) {
          txValue = maxIntermediaryWsolTransfer;
          source = 'P2_IntermediaryWSOL';
      }
       if (source === 'P4_Default_Zero' && userNativeSolChange !== 0) {
           txValue = Math.abs(userNativeSolChange);
           source = 'P3_NativeBalanceChange';
       }

       logger.debug(`Tx ${tx.signature}: Determined dominant txValue=${txValue} from ${source}`);

      // -- STEP 3: Create Records, Applying the Dominant Value --
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN';

      // Handle Other SPL Tokens Sent (OUT)
      for (const [mint, data] of tokensSent.entries()) {
           // This loop now only contains non-WSOL, non-USDC tokens sent by the user's token accounts
           for (const transfer of data.transfers) {
                // Use a more robust key including amount to allow multiple legs of same token
                const amount = safeParseAmount(transfer);
                const uniqueRecordKey = `${tx.signature}:${mint}:out:${transfer.fromTokenAccount}:${transfer.toTokenAccount}:${amount.toFixed(9)}`;
                if (processedTokensInTx.has(uniqueRecordKey)) continue;

                if(amount > 0) {
                    const associatedUsdcValue = userUsdcReceived > 0 ? userUsdcReceived : null;

                    analysisInputs.push({
                        walletAddress: lowerWalletAddress,
                        signature: tx.signature,
                        timestamp: tx.timestamp,
                        mint: mint,
                        amount: amount, // Individual transfer amount
                        direction: 'out',
                        associatedSolValue: txValue, // Transaction-wide SOL value
                        associatedUsdcValue: associatedUsdcValue, // Total USDC received this tx
                        interactionType: interactionType,
                    });
                    processedTokensInTx.add(uniqueRecordKey);
                }
           }
      }

       // Handle Other SPL Tokens Received (IN)
       for (const [mint, data] of tokensReceived.entries()) {
           // This loop now only contains non-WSOL, non-USDC tokens received by the user's token accounts
           for (const transfer of data.transfers) {
                const amount = safeParseAmount(transfer);
                const uniqueRecordKey = `${tx.signature}:${mint}:in:${transfer.fromTokenAccount}:${transfer.toTokenAccount}:${amount.toFixed(9)}`;
                if (processedTokensInTx.has(uniqueRecordKey)) continue;

                if (amount > 0) {
                     const associatedUsdcValue = userUsdcSent > 0 ? userUsdcSent : null;

                    analysisInputs.push({
                        walletAddress: lowerWalletAddress,
                        signature: tx.signature,
                        timestamp: tx.timestamp,
                        mint: mint,
                        amount: amount, // Individual transfer amount
                        direction: 'in',
                        associatedSolValue: txValue, // Transaction-wide SOL value
                        associatedUsdcValue: associatedUsdcValue, // Total USDC sent this tx
                        interactionType: interactionType,
                    });
                    processedTokensInTx.add(uniqueRecordKey);
                }
           }
      }

      // Manually add ONE summary record for user's total WSOL/USDC movements, ensuring uniqueness
      const summaryRecordKey = (mint: string, direction: string, amount: number) => 
          `${tx.signature}:${mint}:${direction}:${amount.toFixed(9)}`; // Use fixed decimal places for amount key

      // WSOL SENT Summary Record
      if (userWsolSent > 0) {
        const key = summaryRecordKey(SOL_MINT, 'out', userWsolSent);
        if (!processedTokensInTx.has(key)) {
           analysisInputs.push({
                walletAddress: lowerWalletAddress, signature: tx.signature, timestamp: tx.timestamp,
                mint: SOL_MINT, amount: userWsolSent, direction: 'out',
                associatedSolValue: txValue, associatedUsdcValue: null, interactionType: interactionType,
           });
           processedTokensInTx.add(key);
        }
      }
       // WSOL RECEIVED Summary Record
      if (userWsolReceived > 0) {
        const key = summaryRecordKey(SOL_MINT, 'in', userWsolReceived);
        if (!processedTokensInTx.has(key)) {
           analysisInputs.push({
                walletAddress: lowerWalletAddress, signature: tx.signature, timestamp: tx.timestamp,
                mint: SOL_MINT, amount: userWsolReceived, direction: 'in',
                associatedSolValue: txValue, associatedUsdcValue: null, interactionType: interactionType,
           });
           processedTokensInTx.add(key);
         }
      }
       // USDC SENT Summary Record
      if (userUsdcSent > 0) {
        const key = summaryRecordKey(USDC_MINT, 'out', userUsdcSent);
        if (!processedTokensInTx.has(key)) {
             analysisInputs.push({
                  walletAddress: lowerWalletAddress, signature: tx.signature, timestamp: tx.timestamp,
                  mint: USDC_MINT, amount: userUsdcSent, direction: 'out',
                  associatedSolValue: txValue, associatedUsdcValue: null, interactionType: interactionType,
             });
             processedTokensInTx.add(key);
        }
      }
       // USDC RECEIVED Summary Record
      if (userUsdcReceived > 0) {
        const key = summaryRecordKey(USDC_MINT, 'in', userUsdcReceived);
        if (!processedTokensInTx.has(key)) {
             analysisInputs.push({
                  walletAddress: lowerWalletAddress, signature: tx.signature, timestamp: tx.timestamp,
                  mint: USDC_MINT, amount: userUsdcReceived, direction: 'in',
                  associatedSolValue: txValue, associatedUsdcValue: null, interactionType: interactionType,
             });
            processedTokensInTx.add(key);
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
