import { createLogger } from '@/utils/logger';

// Logger specific to CLI utilities
const logger = createLogger('CliUtils');

/**
 * Parses optional start/end date CLI args into a timeRange object 
 * containing Unix timestamps (seconds).
 * 
 * @param startDate - Optional start date string (YYYY-MM-DD).
 * @param endDate - Optional end date string (YYYY-MM-DD).
 * @returns An object with startTs and/or endTs, or undefined if no valid dates provided.
 */
export function parseTimeRange(startDate?: string, endDate?: string): { startTs?: number; endTs?: number } | undefined {
    let timeRange: { startTs?: number; endTs?: number } | undefined = undefined;
    
    if (startDate || endDate) {
        timeRange = {}; // Initialize if at least one date is provided

        if (startDate) {
            try {
                // Parse as UTC start of day
                const parsedStart = Date.parse(startDate + 'T00:00:00Z'); 
                if (isNaN(parsedStart)) throw new Error('Invalid start date format');
                timeRange.startTs = Math.floor(parsedStart / 1000); 
            } catch (e) {
                logger.warn(`Invalid start date format: ${startDate}. Ignoring start date.`);
                delete timeRange.startTs;
            }
        }

        if (endDate) {
             try {
                // Parse as UTC end of day
                const parsedEnd = Date.parse(endDate + 'T23:59:59Z'); 
                if (isNaN(parsedEnd)) throw new Error('Invalid end date format');
                timeRange.endTs = Math.floor(parsedEnd / 1000);
            } catch (e) {
                logger.warn(`Invalid end date format: ${endDate}. Ignoring end date.`);
                delete timeRange.endTs;
            }
        }

        // If both were provided but invalid, reset to undefined
        if (Object.keys(timeRange).length === 0) {
            timeRange = undefined;
        }
    }

    // Log only if a valid time range was constructed
    if (timeRange) {
        logger.info(`Applying time range filter: Start=${timeRange.startTs ? new Date(timeRange.startTs*1000).toISOString() : 'N/A'}, End=${timeRange.endTs ? new Date(timeRange.endTs*1000).toISOString() : 'N/A'}`, timeRange);
    }

    return timeRange;
} 