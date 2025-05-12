#!/usr/bin/env node

// This script is used to fetch all signatures for a given Solana wallet address using the Helius RPC endpoint

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
import { createLogger } from '../../general_crypto/utils/logger';
import path from 'path';
import fs from 'fs';

// Initialize environment variables
dotenv.config();

const logger = createLogger('FetchRpcSignaturesScript');

// Use Helius RPC endpoint as it requires the API key anyway
const SOLANA_RPC_URL_MAINNET = 'https://mainnet.helius-rpc.com/';
const REQUEST_LIMIT = 1000; // Max limit for getSignaturesForAddress is 1000

// Interface for the signature information returned by the RPC
interface SignatureInfo {
    signature: string;
    slot: number;
    err: any; // TransactionError object, or null
    memo: string | null;
    blockTime?: number | null; // Unix timestamp of confirmation, if available
}

async function fetchRpcSignaturesPage(apiKey: string, address: string, limit: number, before?: string | null): Promise<SignatureInfo[]> {
    const url = `${SOLANA_RPC_URL_MAINNET}?api-key=${apiKey}`;
    const payload = {
        jsonrpc: '2.0',
        id: `fetch-rpc-signatures-${address}-${before || 'first'}`,
        method: 'getSignaturesForAddress',
        params: [
            address,
            {
                limit: limit,
                before: before || undefined // Only include 'before' if it has a value
                // We could add 'until' here to limit to a specific end signature
            }
        ]
    };

    logger.info(`Fetching RPC signatures: limit=${limit}, before=${before || 'N/A'}`);
    try {
        const response = await axios.post<{ result: SignatureInfo[] }>(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && Array.isArray(response.data.result)) {
            logger.info(`Received ${response.data.result.length} signatures.`);
            return response.data.result;
        } else {
            logger.warn('Received unexpected response structure from RPC.', { responseData: response.data });
            return [];
        }
    } catch (error) {
        logger.error(`Error fetching RPC signatures`, { 
            error: error instanceof AxiosError ? error.response?.data || error.message : String(error) 
        });
        throw error; // Re-throw to stop the process
    }
}

async function getAllRpcSignatures(apiKey: string, address: string, maxSignatures: number | null = null, outputPath: string | null = null): Promise<void> {
    logger.info(`Starting RPC signature fetch for address: ${address}`);
    let allSignatures: SignatureInfo[] = [];
    let lastSignature: string | null = null;
    let hasMore = true;
    let fetchedCount = 0;
    const limit = REQUEST_LIMIT;

    try {
        while (hasMore) {
            const signatures = await fetchRpcSignaturesPage(apiKey, address, limit, lastSignature);
            
            if (signatures.length > 0) {
                allSignatures.push(...signatures);
                fetchedCount += signatures.length;
                lastSignature = signatures[signatures.length - 1].signature;
                
                // Stop if we hit the maxSignatures limit, if provided
                if (maxSignatures !== null && fetchedCount >= maxSignatures) {
                    logger.info(`Reached maxSignatures limit (${maxSignatures}). Stopping fetch.`);
                    hasMore = false;
                } else if (signatures.length < limit) {
                    // Stop if the API returned fewer than requested (last page)
                    logger.info('Last page reached (received less than limit).');
                    hasMore = false;
                }
            } else {
                // Stop if API returned zero signatures
                logger.info('Last page reached (received 0 items).');
                hasMore = false;
            }
            // Optional: Add a small delay between pages if hitting rate limits
            // await new Promise(resolve => setTimeout(resolve, 200)); 
        }

        logger.info(`Finished fetching. Total signatures retrieved via RPC: ${allSignatures.length}`);

        // Output the count
        console.log(`\nTotal signatures found for ${address} via getSignaturesForAddress: ${allSignatures.length}`);
        
        // Write signatures to file if an output path is provided
        if (outputPath) {
            try {
                const signatureList = allSignatures.map(sigInfo => sigInfo.signature).join('\n');
                const resolvedPath = path.resolve(process.cwd(), outputPath);
                // Ensure directory exists (create if not)
                const outputDir = path.dirname(resolvedPath);
                if (!fs.existsSync(outputDir)){
                    fs.mkdirSync(outputDir, { recursive: true });
                    logger.info(`Created output directory: ${outputDir}`);
                }
                
                fs.writeFileSync(resolvedPath, signatureList, 'utf8');
                console.log(`Signatures saved to: ${resolvedPath}`);
                logger.info(`Signatures saved to: ${resolvedPath}`);
            } catch (writeError) {
                logger.error('Failed to write signatures to file', { error: writeError, path: outputPath });
                console.error(`Error writing signatures to file: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
            }
        }

    } catch (error) {
        logger.error('Failed to complete RPC signature fetching process due to error.');
        console.error('Error retrieving all RPC signatures. Check logs for details.');
        process.exit(1);
    }
}

// CLI setup
(async () => {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
        throw new Error('HELIUS_API_KEY environment variable is required. Please add it to your .env file.');
    }

    const argv = await yargs(hideBin(process.argv))
        .scriptName('fetch-rpc-signatures')
        .usage('$0 --address <wallet_address> [--max <max_signatures>] [--output <output_path>]')
        .option('address', {
            alias: 'a',
            description: 'Solana wallet address to query signatures for',
            type: 'string',
            demandOption: true,
        })
        .option('max', {
            alias: 'm',
            description: 'Optional maximum number of signatures to fetch (fetches all if omitted)',
            type: 'number',
            demandOption: false,
        })
        .option('output', {
            alias: 'o',
            description: 'Optional path to save the list of signatures (e.g., data/signatures.txt)',
            type: 'string',
            demandOption: false,
        })
        .help()
        .alias('help', 'h')
        .parse();

    const typedArgv = argv as {
        address: string;
        max?: number | null;
        output?: string | null;
        [key: string]: unknown;
    };

    await getAllRpcSignatures(heliusApiKey, typedArgv.address, typedArgv.max || null, typedArgv.output || null);
})(); 