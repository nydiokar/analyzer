import { createLogger } from 'core/utils/logger';

const logger = createLogger('Formatters');

/**
 * Formats a UNIX timestamp (in seconds) into a YYYY-MM-DD HH:MM:SS UTC string.
 * Handles null/undefined/zero timestamps.
 */
export function formatTimestamp(timestampSeconds: number | null | undefined): string {
    if (!timestampSeconds || timestampSeconds <= 0) {
        return 'N/A';
    }
    try {
        // Multiply by 1000 for JavaScript Date constructor (expects milliseconds)
        const date = new Date(timestampSeconds * 1000);
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        // Use UTC methods for consistency
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
    } catch (e) {
        logger.error(`Error formatting timestamp: ${timestampSeconds}`, e);
        return 'Error';
    }
}

/**
 * Formats a number representing a SOL amount to a fixed number of decimal places (e.g., 4).
 * Handles null/undefined/non-finite numbers.
 */
export function formatSolAmount(amount: number | null | undefined, decimals: number = 4): string {
    if (amount === null || amount === undefined || !isFinite(amount)) {
        // Represent null/undefined/NaN/Infinity clearly
        return amount === null ? 'null' : String(amount);
    }
    try {
        return amount.toFixed(decimals);
    } catch (e) {
        logger.error(`Error formatting SOL amount: ${amount}`, e);
        return 'Error';
    }
}

/**
 * Formats a generic number to a specified number of decimal places.
 * Uses exponential notation for very large or small numbers.
 * Handles null/undefined/non-finite numbers.
 */
export function formatNumber(num: number | null | undefined, decimals: number = 2): string {
    if (num === null || num === undefined || !isFinite(num)) {
        return num === null ? 'null' : String(num);
    }
    try {
        // Use exponential for very large/small magnitudes
        if (Math.abs(num) >= 1e9 || (Math.abs(num) < 1e-6 && num !== 0)) {
            return num.toExponential(decimals);
        }
        return num.toFixed(decimals);
    } catch (e) {
        logger.error(`Error formatting number: ${num}`, e);
        return 'Error';
    }
} 