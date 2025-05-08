#!/usr/bin/env node
import { SwapAnalysisInput } from '@prisma/client';
import { prisma } from '../services/database-service'; // Use shared Prisma client
import { createLogger } from '../utils/logger'; // Use project logger
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import cosineSimilarity from 'compute-cosine-similarity';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path'; // Added for file saving

// Initialize environment variables
dotenv.config();

// Create logger for this module
const logger = createLogger('WalletSimilarityAnalyzer');

// --- Configuration for Excluded Tokens ---
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    // Add other common stablecoins or LSTs if needed, e.g.:
    // 'J1toso1uCkDRpQh4gzMcmUhn8vhpAbcXPoo1ROLNzG8', // JitoSOL
    // 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // Marinade SOL
];

interface WalletTransactionData {
    mint: string;
    amount: number; // Token units
    associatedSolValue: number; // Value of this leg in SOL
    direction: string; // 'in' or 'out'
    timestamp: number; // Unix timestamp (seconds)
}

interface WalletInfo {
    address: string;
    label?: string; // Optional friendly name from walletsFile
}

// --- Database Interaction ---
async function fetchWalletTransactions(
    walletAddress: string,
    excludedMints: string[]
): Promise<WalletTransactionData[]> {
    logger.debug(`Fetching transactions for ${walletAddress}...`);
    try {
        const transactions = await prisma.swapAnalysisInput.findMany({
            where: {
                walletAddress: walletAddress,
                NOT: {
                    mint: {
                        in: excludedMints,
                    },
                },
            },
            select: {
                mint: true,
                amount: true,
                associatedSolValue: true,
                direction: true,
                timestamp: true,
            },
            orderBy: {
                timestamp: 'asc',
            }
        });
        logger.debug(`Fetched ${transactions.length} transactions for ${walletAddress} after excluding ${excludedMints.length} mints.`);
        return transactions.map(t => ({
            mint: t.mint,
            amount: t.amount,
            associatedSolValue: t.associatedSolValue,
            direction: t.direction,
            timestamp: t.timestamp
        }));
    } catch (error) {
        logger.error(`Error fetching transactions for wallet ${walletAddress}:`, { error });
        return [];
    }
}

// --- Data Processing ---

interface SharedTokenInfo {
    mint: string;
    sharedByWallets: string[];
    count: number;
}

/**
 * Analyzes and identifies tokens shared by two or more wallets.
 * @param walletData Record where keys are wallet addresses and values are their transaction data.
 * @returns An array of SharedTokenInfo objects, sorted by the number of wallets sharing the token.
 */
function analyzeSharedTokens(walletData: Record<string, WalletTransactionData[]>): SharedTokenInfo[] {
    const tokenToWalletsMap: Record<string, Set<string>> = {};
    const allWalletAddresses = Object.keys(walletData);

    if (allWalletAddresses.length < 2) {
        logger.info('[analyzeSharedTokens] Less than 2 wallets provided, no shared token analysis possible.');
        return [];
    }

    logger.debug('[analyzeSharedTokens] Identifying tokens transacted by each wallet (post-exclusion):');
    for (const walletAddress of allWalletAddresses) {
        const txData = walletData[walletAddress];
        if (!txData || txData.length === 0) {
            logger.debug(`- Wallet ${walletAddress}: No relevant transactions for shared token analysis.`);
            continue;
        }
        const uniqueMintsForWallet = new Set(txData.map(tx => tx.mint));
        logger.debug(`- Wallet ${walletAddress}: ${uniqueMintsForWallet.size} unique relevant tokens.`);
        
        for (const mint of uniqueMintsForWallet) {
            if (!tokenToWalletsMap[mint]) {
                tokenToWalletsMap[mint] = new Set();
            }
            tokenToWalletsMap[mint].add(walletAddress);
        }
    }

    const sharedTokensResult: SharedTokenInfo[] = [];
    for (const mint in tokenToWalletsMap) {
        const wallets = tokenToWalletsMap[mint];
        if (wallets.size >= 2) { 
            sharedTokensResult.push({
                mint: mint,
                sharedByWallets: Array.from(wallets).sort(),
                count: wallets.size,
            });
        }
    }
    sharedTokensResult.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.mint.localeCompare(b.mint);
    });
    return sharedTokensResult;
}

function calculateWalletPairCounts(sharedTokenDetails: SharedTokenInfo[], targetWallets: WalletInfo[]): Record<string, Record<string, number>> {
    const walletAddresses = targetWallets.map(w => w.address).sort();
    const pairCounts: Record<string, Record<string, number>> = {};
    // Initialize the nested structure properly
    for (const addrA of walletAddresses) {
        pairCounts[addrA] = {};
        for (const addrB of walletAddresses) {
            if (addrA !== addrB) {
                pairCounts[addrA][addrB] = 0;
            }
        }
    }

    for (const info of sharedTokenDetails) {
        const sharingWallets = info.sharedByWallets;
        // Ensure we only count pairs within the targetWallets list
        const targetSharingWallets = sharingWallets.filter(addr => walletAddresses.includes(addr));
        
        for (let i = 0; i < targetSharingWallets.length; i++) {
            for (let j = i + 1; j < targetSharingWallets.length; j++) {
                const walletA = targetSharingWallets[i];
                const walletB = targetSharingWallets[j];
                // Increment counts symmetrically
                pairCounts[walletA][walletB] = (pairCounts[walletA][walletB] || 0) + 1;
                pairCounts[walletB][walletA] = (pairCounts[walletB][walletA] || 0) + 1;
            }
        }
    }
    logger.debug(`[calculateWalletPairCounts] Calculated shared token counts between ${walletAddresses.length} wallets.`);
    return pairCounts;
}

// --- Vector Creation and Similarity (To be Revamped) ---
interface TokenVector {
    [token: string]: number; // Currently sum of token amounts, will change to % capital
}
interface WalletVectors {
    [walletAddress: string]: TokenVector;
}

// OLD version - sum of token units
function createSimpleTokenVectors(
    walletData: Record<string, WalletTransactionData[]>,
    allUniqueTokens: string[]
): WalletVectors {
    const vectors: WalletVectors = {};
    logger.debug('[createSimpleTokenVectors] Creating vectors based on sum of token units.')
    for (const walletAddress in walletData) {
        vectors[walletAddress] = {};
        for (const token of allUniqueTokens) {
            vectors[walletAddress][token] = 0;
        }
        const currentWalletTxs = walletData[walletAddress];
        if (currentWalletTxs) {
            currentWalletTxs.forEach(tx => {
                if (allUniqueTokens.includes(tx.mint)) {
                    vectors[walletAddress][tx.mint] = (vectors[walletAddress][tx.mint] || 0) + tx.amount;
                }
            });
        }
    }
    return vectors;
}

// NEW version - % of capital allocation
function createCapitalAllocationVectors(
    walletData: Record<string, WalletTransactionData[]>,
    allUniqueTokens: string[] // All unique, non-excluded tokens bought by ANY analyzed wallet
): WalletVectors {
    const vectors: WalletVectors = {};
    logger.info('[createCapitalAllocationVectors] Creating vectors based on % capital allocation...');

    for (const walletAddress in walletData) {
        vectors[walletAddress] = {};
        const buysForWallet = walletData[walletAddress]?.filter(tx => tx.direction === 'in') || [];

        let totalSolInvestedByWallet = 0;
        const solInvestedPerToken: Record<string, number> = {};

        for (const token of allUniqueTokens) {
            vectors[walletAddress][token] = 0; // Initialize
            solInvestedPerToken[token] = 0;
        }

        if (buysForWallet.length === 0) {
            logger.debug(`- Wallet ${walletAddress}: No 'in' (buy) transactions found for capital allocation vector.`);
            // Vector remains all zeros, which is correct.
            continue;
        }

        for (const tx of buysForWallet) {
            if (allUniqueTokens.includes(tx.mint)) { // Ensure token is part of our defined dimensions
                solInvestedPerToken[tx.mint] = (solInvestedPerToken[tx.mint] || 0) + tx.associatedSolValue;
                totalSolInvestedByWallet += tx.associatedSolValue;
            }
        }
        
        logger.debug(`- Wallet ${walletAddress}: Total SOL invested (on non-excluded buys): ${totalSolInvestedByWallet.toFixed(4)}`);

        if (totalSolInvestedByWallet > 0) {
            for (const token of allUniqueTokens) {
                if (solInvestedPerToken[token] > 0) {
                    vectors[walletAddress][token] = solInvestedPerToken[token] / totalSolInvestedByWallet;
                }
            }
        } else {
            logger.debug(`- Wallet ${walletAddress}: Total SOL invested is 0, capital allocation vector will be all zeros.`);
        }
        // Log a snippet of the vector for verification
        const vectorSnippet = Object.entries(vectors[walletAddress]).filter(([,val]) => val > 0).slice(0,3);
        logger.debug(`- Wallet ${walletAddress}: Vector snippet (non-zero %): ${JSON.stringify(vectorSnippet)} Sum of percentages: ${Object.values(vectors[walletAddress]).reduce((s,p) => s+p, 0).toFixed(4)}`);
    }
    return vectors;
}

function calculateSimilarityMatrix(
    walletVectors: WalletVectors,
    walletOrder: string[]
): Record<string, Record<string, number>> {
    const similarityMatrix: Record<string, Record<string, number>> = {};
    for (let i = 0; i < walletOrder.length; i++) {
        const walletA_address = walletOrder[i];
        similarityMatrix[walletA_address] = {};
        for (let j = 0; j < walletOrder.length; j++) {
            const walletB_address = walletOrder[j];
            if (i === j) {
                similarityMatrix[walletA_address][walletB_address] = 1.0;
                continue;
            }
            const vectorA_raw = walletVectors[walletA_address];
            const vectorB_raw = walletVectors[walletB_address];
            if (!vectorA_raw || !vectorB_raw) {
                similarityMatrix[walletA_address][walletB_address] = 0;
                continue;
            }
            const allTokensInvolved = Object.keys(vectorA_raw); 
            const vectorA: number[] = [];
            const vectorB: number[] = [];
            for (const token of allTokensInvolved) {
                vectorA.push(vectorA_raw[token] || 0);
                vectorB.push(vectorB_raw[token] || 0);
            }
            if (vectorA.length === 0 || vectorB.length === 0) {
                 similarityMatrix[walletA_address][walletB_address] = 0;
                 continue;
            }
            const isVectorANotZero = vectorA.some(val => val !== 0);
            const isVectorBNotZero = vectorB.some(val => val !== 0);
            if (isVectorANotZero && isVectorBNotZero) {
                 const sim = cosineSimilarity(vectorA, vectorB);
                 similarityMatrix[walletA_address][walletB_address] = sim === null || isNaN(sim) ? 0 : sim;
            } else {
                 similarityMatrix[walletA_address][walletB_address] = 0;
            }
        }
    }
    return similarityMatrix;
}

/**
 * Creates binary vectors indicating token presence (1 if traded, 0 otherwise).
 */
function createBinaryTokenVectors(
    walletData: Record<string, WalletTransactionData[]>,
    allUniqueTokens: string[] // All unique, non-excluded tokens traded by ANY analyzed wallet
): WalletVectors {
    const vectors: WalletVectors = {};
    logger.debug('[createBinaryTokenVectors] Creating vectors based on token presence (1/0)...');

    for (const walletAddress in walletData) {
        vectors[walletAddress] = {};
        const tradedTokensByWallet = new Set(walletData[walletAddress]?.map(tx => tx.mint) || []);
        
        for (const token of allUniqueTokens) {
            vectors[walletAddress][token] = tradedTokensByWallet.has(token) ? 1 : 0;
        }
        // Log snippet
        const presentTokens = Object.entries(vectors[walletAddress]).filter(([,val]) => val > 0).length;
        logger.debug(`- Wallet ${walletAddress}: Binary vector created with ${presentTokens}/${allUniqueTokens.length} tokens present.`);
    }
    return vectors;
}

/**
 * Calculates Jaccard Similarity between two binary vectors (sets).
 * Jaccard = |Intersection(A, B)| / |Union(A, B)|
 */
function calculateJaccardSimilarity(vectorA: TokenVector, vectorB: TokenVector): number {
    let intersectionSize = 0;
    let unionSize = 0;
    const allKeys = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);

    for (const key of allKeys) {
        const valA = vectorA[key] || 0;
        const valB = vectorB[key] || 0;

        if (valA === 1 && valB === 1) {
            intersectionSize++;
            unionSize++;
        } else if (valA === 1 || valB === 1) {
            unionSize++;
        }
    }

    return unionSize === 0 ? 1 : intersectionSize / unionSize; // Return 1 if both empty, 0 if union exists but no intersection
}

/**
 * Calculates a similarity matrix using a provided similarity function (e.g., Jaccard).
 */
function calculateGenericSimilarityMatrix(
    walletVectors: WalletVectors, 
    walletOrder: string[],
    similarityFn: (vecA: TokenVector, vecB: TokenVector) => number
): Record<string, Record<string, number>> {
    const similarityMatrix: Record<string, Record<string, number>> = {};
    for (let i = 0; i < walletOrder.length; i++) {
        const walletA_address = walletOrder[i];
        similarityMatrix[walletA_address] = {};
        for (let j = 0; j < walletOrder.length; j++) {
            const walletB_address = walletOrder[j];
            if (i === j) {
                similarityMatrix[walletA_address][walletB_address] = 1.0;
                continue;
            }
            const vectorA = walletVectors[walletA_address];
            const vectorB = walletVectors[walletB_address];
            if (!vectorA || !vectorB) {
                similarityMatrix[walletA_address][walletB_address] = 0; // Handle missing vectors
            } else {
                similarityMatrix[walletA_address][walletB_address] = similarityFn(vectorA, vectorB);
            }
        }
    }
    return similarityMatrix;
}

// Keep the Cosine Similarity matrix function (specific implementation)
function calculateCosineSimilarityMatrix(
    walletVectors: WalletVectors, 
    walletOrder: string[]
): Record<string, Record<string, number>> {
    // ... uses compute-cosine-similarity (implementation unchanged)
    const similarityMatrix: Record<string, Record<string, number>> = {};
    for (let i = 0; i < walletOrder.length; i++) {
        const walletA_address = walletOrder[i];
        similarityMatrix[walletA_address] = {};
        for (let j = 0; j < walletOrder.length; j++) {
            const walletB_address = walletOrder[j];
            if (i === j) { similarityMatrix[walletA_address][walletB_address] = 1.0; continue; }
            const vectorA_raw = walletVectors[walletA_address]; const vectorB_raw = walletVectors[walletB_address];
            if (!vectorA_raw || !vectorB_raw) { similarityMatrix[walletA_address][walletB_address] = 0; continue; }
            const allTokensInvolved = Object.keys(vectorA_raw); 
            const vectorA: number[] = []; const vectorB: number[] = [];
            for (const token of allTokensInvolved) { vectorA.push(vectorA_raw[token] || 0); vectorB.push(vectorB_raw[token] || 0); }
            if (vectorA.length === 0 || vectorB.length === 0) { similarityMatrix[walletA_address][walletB_address] = 0; continue; }
            const isVectorANotZero = vectorA.some(val => val !== 0); const isVectorBNotZero = vectorB.some(val => val !== 0);
            if (isVectorANotZero && isVectorBNotZero) { 
                 const sim = cosineSimilarity(vectorA, vectorB); similarityMatrix[walletA_address][walletB_address] = sim === null || isNaN(sim) ? 0 : sim;
            } else { similarityMatrix[walletA_address][walletB_address] = 0; }
        }
    }
    return similarityMatrix;
}

// --- Reporting --- 

function formatMatrix(matrix: Record<string, Record<string, number | string>>, walletOrder: string[], labels: Record<string, string>, title: string, valueFormatter: (val: number | string) => string): string[] {
    const lines: string[] = [`=== ${title} ===`, ''];
    const displayLabels = walletOrder.map(addr => labels[addr] || addr.substring(0, 10));
    const colWidth = 12;
    let header = " ".padEnd(15);
    displayLabels.forEach(label => header += label.padEnd(colWidth));
    lines.push(header);
    for (let i = 0; i < walletOrder.length; i++) {
        const walletA_addr = walletOrder[i];
        const walletA_label = displayLabels[i];
        let row = walletA_label.padEnd(15);
        for (let j = 0; j < walletOrder.length; j++) {
            const walletB_addr = walletOrder[j];
            if (i === j) {
                row += "N/A".padEnd(colWidth);
            } else {
                const value = matrix[walletA_addr]?.[walletB_addr] ?? 0;
                row += valueFormatter(value).padEnd(colWidth);
            }
        }
        lines.push(row);
    }
    lines.push(''); // Add space after matrix
    return lines;
}

function generateSimilarityReport(
    targetWallets: WalletInfo[],
    allWalletTransactions: Record<string, WalletTransactionData[]>,
    excludedMints: string[], 
    sharedTokenDetails: SharedTokenInfo[], 
    pairCounts: Record<string, Record<string, number>>,
    capitalSimilarityMatrix: Record<string, Record<string, number>>,
    assetOverlapMatrix: Record<string, Record<string, number>>
): string {
    const reportLines: string[] = [];
    const walletAddresses = targetWallets.map(w => w.address).sort();
    const walletLabels: Record<string, string> = {};
    targetWallets.forEach(w => { walletLabels[w.address] = w.label || w.address.substring(0, 10); });

    // Pre-calculate unique traded token counts for each wallet for percentage calculation
    const uniqueTokensPerWallet: Record<string, number> = {};
    for (const addr of walletAddresses) {
        const txs = allWalletTransactions[addr];
        if (txs) {
            uniqueTokensPerWallet[addr] = new Set(txs.map(tx => tx.mint)).size;
        } else {
            uniqueTokensPerWallet[addr] = 0;
        }
    }

    // --- 1. Header ---
    reportLines.push('==================================================');
    reportLines.push('    Wallet Similarity Analysis Report');
    reportLines.push('==================================================');
    reportLines.push(`Generated on: ${new Date().toISOString()}`);
    reportLines.push(`Wallets Analyzed (${targetWallets.length}):`);
    targetWallets.forEach(w => reportLines.push(`- ${w.address}${w.label ? ' (' + w.label + ')' : ''}`));
    reportLines.push(`Excluded Mints (${excludedMints.length}): ${excludedMints.join(', ')}`);
    reportLines.push('');

    // --- 2. Connection Strength Summary ---
    reportLines.push('=== Connection Strength Summary ===');
    reportLines.push('(Based on Shared Token Counts, Asset Overlap, and Capital Allocation Similarity)');
    reportLines.push('');
    const categories: { [key: string]: string[] } = { Strongly: [], Mildly: [], Barely: [], NotConnected: [] };
    const processedPairs = new Set<string>();

    const THRESHOLDS = {
        STRONG: { count: 10, capSim: 0.75, assetSim: 0.5, sharedPct: 0.5 },
        MILD:   { count: 5,  capSim: 0.5,  assetSim: 0.3, sharedPct: 0.25 },
        BARELY: { count: 3,  capSim: 0.25, assetSim: 0.15, sharedPct: 0.1 },
    };

    for (let i = 0; i < walletAddresses.length; i++) {
        for (let j = i + 1; j < walletAddresses.length; j++) {
            const addrA = walletAddresses[i];
            const addrB = walletAddresses[j];
            const pairKey = [addrA, addrB].sort().join('|');
            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            const count = pairCounts[addrA]?.[addrB] || 0;
            const capSim = capitalSimilarityMatrix[addrA]?.[addrB] || 0;
            const assetSim = assetOverlapMatrix[addrA]?.[addrB] || 0;
            const pairLabel = `${walletLabels[addrA]} <-> ${walletLabels[addrB]}`;

            const uniqueA = uniqueTokensPerWallet[addrA] || 0;
            const uniqueB = uniqueTokensPerWallet[addrB] || 0;
            const pctA = uniqueA > 0 ? (count / uniqueA) * 100 : 0;
            const pctB = uniqueB > 0 ? (count / uniqueB) * 100 : 0;
            const maxSharedPct = Math.max(pctA / 100, pctB / 100);

            const details = `(Shared: ${count} [A:${pctA.toFixed(1)}%, B:${pctB.toFixed(1)}%], Alloc Sim: ${capSim.toFixed(3)}, Asset Sim: ${assetSim.toFixed(3)})`;

            if ( (capSim >= THRESHOLDS.STRONG.capSim && count >= THRESHOLDS.STRONG.count && maxSharedPct >= THRESHOLDS.STRONG.sharedPct) || 
                 (assetSim >= THRESHOLDS.STRONG.assetSim && count >= THRESHOLDS.STRONG.count && maxSharedPct >= THRESHOLDS.STRONG.sharedPct) ||
                 (capSim >= THRESHOLDS.STRONG.capSim && assetSim >= THRESHOLDS.STRONG.assetSim && maxSharedPct >= THRESHOLDS.STRONG.sharedPct) ) {
                categories.Strongly.push(`${pairLabel} ${details}`);
            } else if ( (capSim >= THRESHOLDS.MILD.capSim && count >= THRESHOLDS.MILD.count && maxSharedPct >= THRESHOLDS.MILD.sharedPct) || 
                        (assetSim >= THRESHOLDS.MILD.assetSim && count >= THRESHOLDS.MILD.count && maxSharedPct >= THRESHOLDS.MILD.sharedPct) ||
                        (capSim >= THRESHOLDS.MILD.capSim && assetSim >= THRESHOLDS.MILD.assetSim && maxSharedPct >= THRESHOLDS.MILD.sharedPct) ||
                        (capSim >= THRESHOLDS.STRONG.capSim || assetSim >= THRESHOLDS.STRONG.assetSim || maxSharedPct >= THRESHOLDS.STRONG.sharedPct) ) {
                categories.Mildly.push(`${pairLabel} ${details}`);
            } else if ( (capSim >= THRESHOLDS.BARELY.capSim && count >= THRESHOLDS.BARELY.count) || 
                        (assetSim >= THRESHOLDS.BARELY.assetSim && count >= THRESHOLDS.BARELY.count) || 
                        (capSim >= THRESHOLDS.MILD.capSim || assetSim >= THRESHOLDS.MILD.assetSim || count >= THRESHOLDS.STRONG.count || maxSharedPct >= THRESHOLDS.MILD.sharedPct) ) {
                categories.Barely.push(`${pairLabel} ${details}`);
            } else {
                // categories.NotConnected.push(pairLabel);
            }
        }
    }

    if (categories.Strongly.length > 0) { reportLines.push('Strongly Connected Pairs:'); categories.Strongly.forEach(s => reportLines.push(`- ${s}`)); reportLines.push(''); }
    if (categories.Mildly.length > 0) { reportLines.push('Mildly Connected Pairs:'); categories.Mildly.forEach(s => reportLines.push(`- ${s}`)); reportLines.push(''); }
    if (categories.Barely.length > 0) { reportLines.push('Barely Connected Pairs:'); categories.Barely.forEach(s => reportLines.push(`- ${s}`)); reportLines.push(''); }
    if (categories.Strongly.length === 0 && categories.Mildly.length === 0 && categories.Barely.length === 0) {
        reportLines.push('No significant connections found based on current thresholds.','');
    }

    // --- 3. Detailed Matrices ---
    reportLines.push(...formatMatrix(pairCounts, walletAddresses, walletLabels, 'Wallet-Pair Shared Token Counts (Raw)', (v) => String(v)));
    reportLines.push(...formatMatrix(capitalSimilarityMatrix, walletAddresses, walletLabels, 'Behavioral Similarity (% Capital Allocation - Cosine)', (v) => typeof v === 'number' ? v.toFixed(4) : String(v)));
    reportLines.push(...formatMatrix(assetOverlapMatrix, walletAddresses, walletLabels, 'Asset Overlap Similarity (Jaccard)', (v) => typeof v === 'number' ? v.toFixed(4) : String(v)));

    // --- 4. Shared Token Details (Token-Centric) ---
    reportLines.push('=== Shared Token Details (Token-Centric, Post-Exclusion) ===');
    if (sharedTokenDetails.length > 0) {
        reportLines.push(`Found ${sharedTokenDetails.length} tokens shared by 2 or more wallets.`);
        reportLines.push('(Mint Address | Shared by X Wallets | Wallet Addresses)');
        reportLines.push('---');
        sharedTokenDetails.forEach(info => {
            reportLines.push(`- ${info.mint} | ${info.count} Wallets | ${info.sharedByWallets.join(', ')}`);
        });
    } else {
        reportLines.push('No tokens were found to be shared by 2 or more specified wallets after exclusions.');
    }
    reportLines.push('');
    reportLines.push('==================== END OF REPORT ====================');

    return reportLines.join('\n');
}

function saveReportToFile(reportContent: string, filenamePrefix: string = 'wallet_similarity'): string {
    const dir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (error) {
            logger.error(`Failed to create report directory: ${dir}`, { error });
            return ""; // Return empty path on error
        }
    }
  
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${filenamePrefix}_${timestamp}.txt`;
    const filepath = path.join(dir, filename);
    
    try {
        fs.writeFileSync(filepath, reportContent);
        logger.debug(`Report saved to ${filepath}`);
        return filepath;
    } catch (error) {
        logger.error(`Failed to write report file: ${filepath}`, { error });
        return ""; // Return empty path on error
    }
}

// --- Main Execution --- 
async function main(targetWallets: WalletInfo[], excludedMints: string[]) {
    const startTime = process.hrtime();
    logger.info(`Starting wallet similarity analysis for ${targetWallets.length} wallets...`);
    logger.debug(`Target wallets: ${targetWallets.map(w=>w.label || w.address).join(', ')}`);
    logger.debug(`Excluded mints: ${excludedMints.join(', ')}`);

    const walletAddresses = targetWallets.map(w => w.address).sort();

    // 1. Fetch Data
    const allWalletTransactions: Record<string, WalletTransactionData[]> = {};
    for (const walletInfo of targetWallets) {
        logger.debug(`Fetching transactions for ${walletInfo.label || walletInfo.address}...`);
        const walletTxData = await fetchWalletTransactions(walletInfo.address, excludedMints);
        if (walletTxData.length > 0) {
            allWalletTransactions[walletInfo.address] = walletTxData;
            logger.info(`Fetched ${walletTxData.length} relevant transactions for ${walletInfo.label || walletInfo.address}.`);
        } else {
            logger.info(`No relevant transactions found for ${walletInfo.label || walletInfo.address} after exclusion.`);
            allWalletTransactions[walletInfo.address] = [];
        }
    }

    // 2. Analyze Shared Tokens (Token-Centric)
    const sharedTokenDetails = analyzeSharedTokens(allWalletTransactions);
    
    // 3. Calculate Wallet-Pair Counts
    logger.info('Calculating wallet-pair shared token counts...');
    const pairCounts = calculateWalletPairCounts(sharedTokenDetails, targetWallets);

    // Determine dimensions for vectors - all unique non-excluded tokens TRADED
    const allTradedMintsSet = new Set<string>();
    for (const walletAddressKey in allWalletTransactions) {
        allWalletTransactions[walletAddressKey]?.forEach(tx => allTradedMintsSet.add(tx.mint));
    }
    const allTradedMintsList = Array.from(allTradedMintsSet).sort();

    // 4. Calculate Capital Allocation Vectors & Similarity
    let capitalAllocationVectors: WalletVectors = {};
    let capitalSimilarityMatrix: Record<string, Record<string, number>> = {};
    const boughtMintsSet = new Set<string>(); // Track which mints were actually bought
    for (const walletAddressKey in allWalletTransactions) {
        allWalletTransactions[walletAddressKey]?.filter(tx => tx.direction === 'in').forEach(tx => boughtMintsSet.add(tx.mint));
    }
    const allBoughtMintsList = Array.from(boughtMintsSet).sort();

    if (allBoughtMintsList.length > 0) {
        logger.info(`Calculating capital allocation vectors based on ${allBoughtMintsList.length} unique bought tokens...`);
        capitalAllocationVectors = createCapitalAllocationVectors(allWalletTransactions, allBoughtMintsList);
        logger.info('Calculating behavioral similarity matrix (Cosine on % Capital Allocation)...');
        // Use walletAddresses for consistent order, ensuring they exist in capitalAllocationVectors
        const walletOrderForCapSim = walletAddresses.filter(addr => capitalAllocationVectors[addr]);
        if (walletOrderForCapSim.length > 1) {
            capitalSimilarityMatrix = calculateCosineSimilarityMatrix(capitalAllocationVectors, walletOrderForCapSim);
        } else { logger.warn('Not enough wallets with \'buy\' data for capital similarity calc.'); }
    } else { logger.warn("No 'buy' transactions found. Skipping capital allocation vectors and similarity."); }

    // 5. Calculate Binary Token Vectors & Jaccard Similarity
    let binaryTokenVectors: WalletVectors = {};
    let jaccardSimilarityMatrix: Record<string, Record<string, number>> = {};
    if (allTradedMintsList.length > 0) {
        logger.info(`Calculating binary token vectors based on ${allTradedMintsList.length} unique traded tokens...`);
        binaryTokenVectors = createBinaryTokenVectors(allWalletTransactions, allTradedMintsList);
        logger.info('Calculating asset overlap similarity matrix (Jaccard)...');
        // Use walletAddresses for consistent order, ensuring they exist in binaryTokenVectors
        const walletOrderForJaccard = walletAddresses.filter(addr => binaryTokenVectors[addr]);
        if (walletOrderForJaccard.length > 1) {
            jaccardSimilarityMatrix = calculateGenericSimilarityMatrix(binaryTokenVectors, walletOrderForJaccard, calculateJaccardSimilarity);
        } else { logger.warn('Not enough wallets with data for Jaccard similarity calc.'); }
    } else { logger.warn("No relevant transactions found. Skipping binary vectors and Jaccard similarity."); }

    // 6. Generate Report String
    logger.info('Generating analysis report...');
    const reportContent = generateSimilarityReport(
        targetWallets,
        allWalletTransactions,
        excludedMints,
        sharedTokenDetails,
        pairCounts, 
        capitalSimilarityMatrix, 
        jaccardSimilarityMatrix
    );

    // 7. Save Report to File
    const reportPath = saveReportToFile(reportContent);

    // 8. Final Output
    const endTime = process.hrtime(startTime);
    const durationSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);
    if (reportPath) {
        logger.info(`Analysis complete in ${durationSeconds}s. Report saved to: ${reportPath}`);
        console.log(`Analysis complete. Report saved to: ${reportPath}`);
    } else {
        logger.error('Analysis complete, but failed to save the report.');
        console.error('Analysis complete, but failed to save the report.');
    }
}

// --- CLI argument parsing and main call --- 

interface CliArgs {
    wallets?: string;
    walletsFile?: string;
    excludeMints?: string; // Comma-separated string of mints to exclude
    [key: string]: unknown;
    _: (string | number)[];
    $0: string;
}

if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .scriptName('wallet-similarity-analyzer')
        .usage('$0 --wallets "addr1,addr2,..." | --walletsFile <path-to-json> [options]')
        .option('wallets', {
            alias: 'w',
            type: 'string',
            description: 'Comma-separated list of wallet addresses to analyze',
        })
        .option('walletsFile', {
            alias: 'f',
            type: 'string',
            description: 'Path to a JSON file containing wallet addresses or {address, label} objects',
        })
        .option('excludeMints', {
            alias: 'e',
            type: 'string',
            description: 'Comma-separated list of token mints to exclude from analysis (e.g., SOL,USDC mints)',
        })
        .check((argv) => {
            if (!argv.wallets && !argv.walletsFile) {
                throw new Error('You must provide either --wallets or --walletsFile');
            }
            if (argv.wallets && argv.walletsFile) {
                throw new Error('Please provide either --wallets or --walletsFile, not both.');
            }
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv as CliArgs;

    let targetWallets: WalletInfo[] = [];
    let finalExcludedMints: string[] = DEFAULT_EXCLUDED_MINTS;

    if (argv.wallets) {
        targetWallets = argv.wallets.split(',').map((address: string) => ({ address: address.trim() }));
    } else if (argv.walletsFile) {
        try {
            const fileContent = fs.readFileSync(argv.walletsFile, 'utf-8');
            const walletsData = JSON.parse(fileContent);
            if (Array.isArray(walletsData)) {
                targetWallets = walletsData.map((item: any) => {
                    if (typeof item === 'string') return { address: item.trim() };
                    if (item && typeof item.address === 'string') return { address: item.address.trim(), label: item.label };
                    logger.warn(`Skipping invalid wallet entry in file: ${JSON.stringify(item)}`);
                    return null;
                }).filter((w): w is WalletInfo => w !== null);
            } else {
                logger.error('Wallets file is not a JSON array.');
                process.exit(1);
            }
        } catch (error) {
            logger.error(`Error reading or parsing wallets file '${argv.walletsFile}':`, { error });
            process.exit(1);
        }
    }

    if (argv.excludeMints) {
        // User provided exclusions override/extend the default
        // For simplicity, let's combine them and remove duplicates
        const userExcludedMints = argv.excludeMints.split(',').map(m => m.trim()).filter(m => m);
        finalExcludedMints = Array.from(new Set([...DEFAULT_EXCLUDED_MINTS, ...userExcludedMints]));
    }

    // --- Execute Main Logic --- 
    main(targetWallets, finalExcludedMints).catch(async (e) => {
        logger.error('Unhandled error in main execution:', { error: e });
        await prisma.$disconnect();
        process.exit(1);
    }).finally(async () => {
        await prisma.$disconnect();
    });
} 