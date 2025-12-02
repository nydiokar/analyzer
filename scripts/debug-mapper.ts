import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { mapHeliusTransactionsToIntermediateRecords } from '../src/core/services/helius-transaction-mapper';
import { HeliusTransaction } from '../src/types/helius-api';
import { createLogger } from '../src/core/utils/logger';

const logger = createLogger('DebugMapperScript');

// Correct Helius API endpoint for fetching parsed transaction history
const HELIUS_API_URL = `https://api.helius.xyz/v0/transactions/?api-key=${process.env.HELIUS_API_KEY}`;
const OUTPUT_DIR = path.join(process.cwd(), 'debug_output');

if (!process.env.HELIUS_API_KEY) {
    logger.error('HELIUS_API_KEY environment variable not set. Please set it in your .env file.');
    process.exit(1);
}

/**
 * Fetches parsed transaction details from the Helius Transaction History API.
 * This endpoint returns the rich data structure the mapper expects.
 */
async function fetchParsedTransactions(txIds: string[]): Promise<HeliusTransaction[]> {
    logger.info(`Fetching ${txIds.length} parsed transaction(s) from Helius...`);
    try {
        const { data } = await axios.post(HELIUS_API_URL, {
            transactions: txIds,
        });
        return data as HeliusTransaction[];
    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error(`Axios error fetching parsed transactions: ${error.message}`);
            logger.error(`Response data: ${JSON.stringify(error.response?.data)}`);
        } else {
            logger.error(`Unknown error fetching parsed transactions: ${error}`);
        }
        return [];
    }
}

function ensureOutputDirectory(): void {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .usage('Usage: npm run debug:mapper -- <txId1> [txId2]... [-w <wallet_address>]')
        .option('wallet', {
            alias: 'w',
            type: 'string',
            description: 'The wallet address to use for mapping context. If omitted, the transaction fee payer will be used.',
            required: false,
        })
        .command('$0 <txIds...>', 'The transaction IDs to process')
        .help()
        .parseAsync();

    const { wallet, txIds } = argv;

    if (!txIds || txIds.length === 0) {
        logger.error('No transaction IDs provided.');
        process.exit(1);
    }
    
    ensureOutputDirectory();

    const parsedTransactions = await fetchParsedTransactions(txIds as string[]);

    if (parsedTransactions.length === 0) {
        logger.warn('Could not fetch any parsed transactions from Helius. Aborting.');
        return;
    }
    
    for (const tx of parsedTransactions) {
        const txId = tx.signature;
        logger.info(`--- Processing Transaction: ${txId} ---`);

        // 1. Save the raw (but now correctly parsed) transaction data
        const rawOutputPath = path.join(OUTPUT_DIR, `${txId}_raw.json`);
        fs.writeFileSync(rawOutputPath, JSON.stringify(tx, null, 2));
        logger.info(`Successfully saved raw transaction to: ${rawOutputPath}`);
        
        // 2. Determine wallet address for context
        const walletAddress = wallet || tx.feePayer;
        logger.info(`Using wallet context: ${walletAddress}`);

        // 3. Run the transaction through the mapper
        logger.info(`Running mapper for transaction: ${txId}`);
        const mappingResult = mapHeliusTransactionsToIntermediateRecords(walletAddress, [tx]);

        // 4. Display and Save the Mapped DB Rows
        if (mappingResult.analysisInputs && mappingResult.analysisInputs.length > 0) {
            logger.info(`--- Mapped Database Rows for ${txId} ---`);
            console.table(mappingResult.analysisInputs);

            const mappedOutputPath = path.join(OUTPUT_DIR, `${txId}_database_rows.json`);
            fs.writeFileSync(mappedOutputPath, JSON.stringify(mappingResult.analysisInputs, null, 2));
            logger.info(`Successfully saved mapped DB rows to: ${mappedOutputPath}`);
        } else {
            logger.warn(`Mapper did not generate any analysis inputs (DB rows) for ${txId}.`);
        }
        
        // 5. Save and Log summary stats
        const statsOutputPath = path.join(OUTPUT_DIR, `${txId}_stats.json`);
        fs.writeFileSync(statsOutputPath, JSON.stringify(mappingResult.stats, null, 2));
        logger.info(`Successfully saved mapping stats to: ${statsOutputPath}`);

        logger.info(`------------------------------------`);
    }
}

main().catch((error) => {
    logger.error('Script failed with an unhandled error:', error);
    process.exit(1);
}); 