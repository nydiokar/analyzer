import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
// Assuming logger setup exists in utils - adjust path if necessary
// import logger from '../utils/logger'; 

// Define the expected structure of a row in the CSV
interface TransferRecord {
    Signature: string;
    Time: string; // Keep as string for now, parse later
    Action: string;
    From: string;
    To: string;
    Amount: string; // Keep as string for now, parse later
    Flow: 'In' | 'Out' | string; // Expect 'In' or 'Out', but handle others
    Value: string; // Keep as string for now, parse later
    Decimals: string; // Keep as string for now, parse later
    TokenAddress: string;
    TokenSymbol?: string; // Add optional TokenSymbol field
}

// Define the structure for calculated results
interface AnalysisResults {
    tokenAddress: string;
    tokenSymbol?: string; // Added field for token symbol if available
    // inputFile: string; // Input file is global now, not per-token result
    totalAmountIn: number;
    totalAmountOut: number;
    netAmountChange: number;
    totalValueIn: number;
    totalValueOut: number;
    netValueChange: number;
    transferCountIn: number;
    transferCountOut: number;
    firstTransferTime?: Date;
    lastTransferTime?: Date;
    processedRecords: number;
    filteredRecords: number;
    possiblyAirdrop: boolean; // Flag for potential airdrops/spam
}

// Tokens to exclude from top gainers/losers
const excludeFromRankings = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'So11111111111111111111111111111111111111112'  // SOL
];

// Helper to detect if a token is likely an airdrop - improved to be less aggressive
function isLikelyAirdrop(records: TransferRecord[]): boolean {
    // Only consider very low activity tokens
    if (records.length === 1) {
        const inFlows = records.filter(r => r.Flow.toLowerCase() === 'in');
        const outFlows = records.filter(r => r.Flow.toLowerCase() === 'out');
        
        // If only one record and it's incoming with very small value, possibly an airdrop
        if (inFlows.length === 1 && outFlows.length === 0) {
            const value = parseFloat(inFlows[0].Value.replace(/[^0-9.-]+/g,""));
            // Only mark as airdrop if value is very small (under $1)
            return !isNaN(value) && value < 1.0;
        }
    }
    return false;
}

// Updated function to analyze all tokens in the file
async function analyzeWalletTransfers(inputFile: string): Promise<AnalysisResults[]> {
    console.log(`Starting analysis for all tokens in file: ${inputFile}`);
    
    const absoluteInputPath = path.resolve(inputFile);
    if (!fs.existsSync(absoluteInputPath)) {
        throw new Error(`Input file not found: ${absoluteInputPath}`);
    }

    // --- 1. CSV Loading & Parsing ---
    console.log('Reading and parsing CSV file...');
    const fileContent = fs.readFileSync(absoluteInputPath, 'utf8');
    const parseResult = Papa.parse<TransferRecord>(fileContent, {
        header: true,
        skipEmptyLines: true,
    });

    if (parseResult.errors.length > 0) {
        console.error('CSV Parsing Errors:', parseResult.errors);
        // Consider more robust error handling
    }
    
    const allRecords = parseResult.data;
    console.log(`Parsed ${allRecords.length} total records.`);

    // --- Group Records by Token Address ---
    const recordsByToken = new Map<string, TransferRecord[]>();
    for (const record of allRecords) {
        const tokenAddress = record.TokenAddress?.trim();
        if (!tokenAddress) continue; // Skip records without a token address

        if (!recordsByToken.has(tokenAddress)) {
            recordsByToken.set(tokenAddress, []);
        }
        recordsByToken.get(tokenAddress)!.push(record);
    }
    console.log(`Found ${recordsByToken.size} unique token addresses.`);

    const analysisResults: AnalysisResults[] = [];

    // --- Process Each Token Group ---
    for (const [tokenAddress, records] of recordsByToken.entries()) {
        console.log(`\nProcessing token: ${tokenAddress} (${records.length} records)`);

        // --- 2. Data Preparation (per token) ---
        const preparedRecords = records.map((record, index) => {
            const decimals = parseInt(record.Decimals, 10);
            const amountRaw = record.Amount?.trim() || '0'; 
            const valueRaw = record.Value?.trim() || '0';  
            const flowRaw = record.Flow?.trim(); 

            const amount = parseFloat(amountRaw.replace(/,/g, '')) / Math.pow(10, isNaN(decimals) ? 0 : decimals);
            const value = parseFloat(valueRaw.replace(/[^0-9.-]+/g,""));
            
            const timeSeconds = parseInt(record.Time, 10);
            const time = new Date(isNaN(timeSeconds) ? NaN : timeSeconds * 1000);
            
            return {
                ...record,
                Flow: flowRaw, 
                parsedAmount: isNaN(amount) ? 0 : amount,
                parsedValue: isNaN(value) ? 0 : value,
                parsedTime: isNaN(time.getTime()) ? undefined : time
            };
        }).filter(r => r.parsedTime); // Remove records with invalid dates

        if (preparedRecords.length === 0) {
            console.log(`Skipping ${tokenAddress} - no valid records after preparation.`);
            continue; // Skip to next token if no valid records remain
        }

        // --- 3. Data Sorting (per token) ---
        preparedRecords.sort((a, b) => (a.parsedTime!.getTime() - b.parsedTime!.getTime()));

        // --- 4. Analysis Calculation (per token) ---
        let totalAmountIn = 0;
        let totalAmountOut = 0;
        let totalValueIn = 0;
        let totalValueOut = 0;
        let transferCountIn = 0;
        let transferCountOut = 0;

        for (const record of preparedRecords) {
            if (record.Flow.toLowerCase() === 'in') {
                totalAmountIn += record.parsedAmount;
                totalValueIn += record.parsedValue;
                transferCountIn++;
            } else if (record.Flow.toLowerCase() === 'out') {
                totalAmountOut += record.parsedAmount; 
                totalValueOut += record.parsedValue;
                transferCountOut++;
            } 
        }
        
        const netAmountChange = totalAmountIn - Math.abs(totalAmountOut); 
        const netValueChange = totalValueOut - totalValueIn; // User preferred calculation
        
        // Determine if token is likely an airdrop
        const possiblyAirdrop = isLikelyAirdrop(records);

        // --- 5. Store Results (per token) ---
        analysisResults.push({
            tokenAddress,
            tokenSymbol: records[0]?.TokenSymbol, // Now properly typed
            totalAmountIn,
            totalAmountOut,
            netAmountChange,
            totalValueIn,
            totalValueOut,
            netValueChange,
            transferCountIn,
            transferCountOut,
            firstTransferTime: preparedRecords[0]?.parsedTime,
            lastTransferTime: preparedRecords[preparedRecords.length - 1]?.parsedTime,
            processedRecords: records.length, // Raw records for this token
            filteredRecords: preparedRecords.length, // Valid records after prep
            possiblyAirdrop
        });
    } // End loop through tokens

    console.log('\nAnalysis complete for all tokens.');
    return analysisResults;
}

// Function to display results for multiple tokens - simplified version
function displayMultiTokenResults(results: AnalysisResults[], inputFile: string) {
    console.log('\n=== WALLET TRANSFER ANALYSIS SUMMARY ===');
    console.log(`Source File: ${path.basename(inputFile)}`);
    console.log(`Total Tokens Analyzed: ${results.length}`);
    
    // Count likely airdrops/spam tokens
    const airdropCount = results.filter(r => r.possiblyAirdrop).length;
    console.log(`Potential Airdrops/Spam: ${airdropCount}`);
    console.log('=======================================');

    // Exclude likely airdrops/spam tokens and SOL/USDC for ranking
    const filteredResults = results.filter(r => 
        !r.possiblyAirdrop && 
        !excludeFromRankings.includes(r.tokenAddress)
    );

    // Get top gainers and losers
    const topGainers = [...filteredResults]
        .sort((a, b) => b.netValueChange - a.netValueChange)
        .slice(0, 5);
    
    const topLosers = [...filteredResults]
        .sort((a, b) => a.netValueChange - b.netValueChange)
        .slice(0, 5);

    // Display top gainers
    console.log('\n=== TOP 5 GAINERS (Excluding USDC/SOL) ===');
    if (topGainers.length === 0) {
        console.log('No qualifying tokens found');
    } else {
        topGainers.forEach((result, index) => {
            console.log(`${index + 1}. Token: ${result.tokenAddress}`);
            console.log(`   Net Realized Value: $${result.netValueChange.toFixed(2)}`);
            console.log(`   Trades: ${result.transferCountIn} in / ${result.transferCountOut} out`);
            console.log(`   Time Range: ${result.firstTransferTime?.toLocaleDateString() ?? 'N/A'} to ${result.lastTransferTime?.toLocaleDateString() ?? 'N/A'}`);
        });
    }

    // Display top losers
    console.log('\n=== TOP 5 LOSERS (Excluding USDC/SOL) ===');
    if (topLosers.length === 0) {
        console.log('No qualifying tokens found');
    } else {
        topLosers.forEach((result, index) => {
            console.log(`${index + 1}. Token: ${result.tokenAddress}`);
            console.log(`   Net Realized Value: $${result.netValueChange.toFixed(2)}`);
            console.log(`   Trades: ${result.transferCountIn} in / ${result.transferCountOut} out`);
            console.log(`   Time Range: ${result.firstTransferTime?.toLocaleDateString() ?? 'N/A'} to ${result.lastTransferTime?.toLocaleDateString() ?? 'N/A'}`);
        });
    }
    
    // Add an option to see detailed results
    console.log('\nDetailed results have been written to CSV. Use --verbose flag to see full console report.');
}

// New function for detailed output if requested
function displayDetailedResults(results: AnalysisResults[]) {
    console.log('\n=== DETAILED TOKEN ANALYSIS ===');
    // Sort tokens by net value change
    results.sort((a, b) => b.netValueChange - a.netValueChange);
    
    for (const result of results) {
        console.log(`\nToken Address: ${result.tokenAddress}`);
        console.log(`  Time Range: ${result.firstTransferTime?.toISOString() ?? 'N/A'} to ${result.lastTransferTime?.toISOString() ?? 'N/A'}`);
        console.log(`  Records Found: ${result.processedRecords}, Valid: ${result.filteredRecords}`);
        console.log(`  Flow: ${result.transferCountIn} In / ${result.transferCountOut} Out`);
        console.log(`  Amount In: ${result.totalAmountIn.toFixed(0)}, Amount Out: ${result.totalAmountOut.toFixed(0)}`);
        console.log(`  Net Amount (Remaining): ${result.netAmountChange.toFixed(0)}`);
        const percentageRemaining = result.totalAmountIn !== 0 
            ? ((result.netAmountChange / result.totalAmountIn) * 100).toFixed(2)
            : (result.netAmountChange !== 0 ? '-Inf' : 'N/A');
        console.log(`  Percentage Remaining: ${percentageRemaining}%`);
        console.log(`  Value In ($): ${result.totalValueIn.toFixed(2)}, Value Out ($): ${result.totalValueOut.toFixed(2)}`);
        console.log(`  Net Realized Value ($): ${result.netValueChange.toFixed(2)}`);
        console.log(`  Possible Airdrop: ${result.possiblyAirdrop ? 'Yes' : 'No'}`);
    }
}

// Function to write multi-token results to CSV
function writeMultiTokenResultsToCsv(results: AnalysisResults[], inputFile: string): void {
    const outputDir = path.resolve('./analysis_reports');
    if (!fs.existsSync(outputDir)){
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Use input filename base for output
    const inputFileBase = path.basename(inputFile, path.extname(inputFile));
    const outputFilename = `wallet_analysis_report_${inputFileBase}_${Date.now()}.csv`;
    const outputPath = path.join(outputDir, outputFilename);

    console.log(`Writing multi-token analysis report to: ${outputPath}`);

    // Prepare data for row-per-token CSV
    const csvData = results.map(result => ({
        'Token Address': result.tokenAddress,
        'Transfers In': result.transferCountIn,
        'Transfers Out': result.transferCountOut,
        'Total Amount In': result.totalAmountIn.toFixed(0),
        'Total Amount Out': result.totalAmountOut.toFixed(0),
        'Net Amount Change': result.netAmountChange.toFixed(0),
        'Percentage Remaining (%)': result.totalAmountIn !== 0 
            ? ((result.netAmountChange / result.totalAmountIn) * 100).toFixed(2)
            : (result.netAmountChange !== 0 ? '-Infinity' : 'N/A'), // Handle division by zero
        'Total Value In ($)': result.totalValueIn.toFixed(2),
        'Total Value Out ($)': result.totalValueOut.toFixed(2),
        'Net Realized Value ($)': result.netValueChange.toFixed(2), // User preferred
        'First Transfer Time': result.firstTransferTime?.toISOString() ?? '',
        'Last Transfer Time': result.lastTransferTime?.toISOString() ?? '',
        'Records Found': result.processedRecords,
        'Valid Records': result.filteredRecords,
        'Possible Airdrop': result.possiblyAirdrop ? 'Yes' : 'No'
    }));

    // Sort data for CSV consistency (e.g., by Net Realized Value)
    csvData.sort((a, b) => parseFloat(b['Net Realized Value ($)']) - parseFloat(a['Net Realized Value ($)']));

    try {
        const csvString = Papa.unparse(csvData, {
             header: true // Ensure header row is generated
        });
        fs.writeFileSync(outputPath, csvString, 'utf8');
        console.log('Successfully wrote multi-token CSV report.');
    } catch (error) {
        console.error('Error writing multi-token CSV report:', error);
    }
}

// --- Main Execution ---
(async () => {
    const defaultInputFile = './data/export_transfer_DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm_1745318132815.csv'; 

    const argv = await yargs(hideBin(process.argv))
        .option('inputFile', {
            alias: 'i',
            description: 'Path to the input CSV file',
            type: 'string',
            default: defaultInputFile, 
        })
        .option('excludeAirdrops', {
            alias: 'e',
            description: 'Exclude likely airdrop/spam tokens',
            type: 'boolean',
            default: true,
        })
        .option('verbose', {
            alias: 'v',
            description: 'Show detailed token analysis in console',
            type: 'boolean',
            default: false,
        })
        .help()
        .alias('help', 'h')
        .argv;

    const inputFileToUse = argv.inputFile || defaultInputFile;
    if (!fs.existsSync(path.resolve(inputFileToUse))) {
        console.error(`Error: Input file not found at ${path.resolve(inputFileToUse)}.`);
        console.error(`Please ensure the file exists or provide a valid path using --inputFile`);
        process.exit(1);
    }

    try {
        // Call the updated analysis function
        const results = await analyzeWalletTransfers(inputFileToUse);
        
        // Filter out airdrops if requested
        const filteredResults = argv.excludeAirdrops 
            ? results.filter(r => !r.possiblyAirdrop) 
            : results;
            
        // Display results based on verbosity setting
        displayMultiTokenResults(filteredResults, inputFileToUse);
        
        // Show detailed results only if verbose flag is set
        if (argv.verbose) {
            displayDetailedResults(filteredResults);
        }
        
        // Call the updated CSV writing function
        writeMultiTokenResultsToCsv(filteredResults, inputFileToUse);
        
        console.log(`\nAnalysis complete. CSV report saved to ./analysis_reports/`);
    } catch (error) {
        console.error('Error during analysis:', error);
        process.exit(1);
    }
})(); 