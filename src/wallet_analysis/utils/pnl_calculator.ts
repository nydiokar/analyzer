import { TransactionData } from '../../types/correlation';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PnlCalculator');

/**
 * Calculates the simple Profit and Loss (PNL) for a single wallet based on
 * associated SOL values of token swaps.
 * Assumes provided transactions are relevant for PNL (e.g., excludes stables if needed).
 *
 * @param transactions - An array of TransactionData for the wallet.
 * @returns The calculated PNL in SOL.
 */
export function calculateWalletPnl(transactions: TransactionData[]): number {
    let pnl = 0;
    if (!transactions || transactions.length === 0) {
        return 0;
    }

    for (const tx of transactions) {
        // Ensure associatedSolValue is a valid number
        const solValue = tx.associatedSolValue ?? 0;

        if (tx.direction === 'in') {
            pnl -= solValue; // Cost of acquiring token (SOL out)
        } else if (tx.direction === 'out') {
            pnl += solValue; // Revenue from selling token (SOL in)
        }
    }
    // logger.debug(`Calculated PNL: ${pnl} SOL from ${transactions.length} transactions.`);
    return pnl;
}

/**
 * Calculates PNL for multiple wallets.
 *
 * @param transactionsByWallet - A record mapping wallet addresses to their TransactionData arrays.
 * @returns A record mapping wallet addresses to their calculated PNL.
 */
export function calculatePnlForWallets(transactionsByWallet: Record<string, TransactionData[]>): Record<string, number> {
    const walletPnLs: Record<string, number> = {};
    logger.info(`Calculating PNL for ${Object.keys(transactionsByWallet).length} wallets.`);
    for (const walletAddress in transactionsByWallet) {
        const pnl = calculateWalletPnl(transactionsByWallet[walletAddress]);
        walletPnLs[walletAddress] = pnl;
        logger.debug(`- PNL for ${walletAddress}: ${pnl.toFixed(4)} SOL`);
    }
    return walletPnLs;
} 