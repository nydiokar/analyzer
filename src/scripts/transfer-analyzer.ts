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
}

// Define the structure for calculated results
interface AnalysisResults {
    tokenAddress: string;
    inputFile: string;
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
}

async function analyzeTransfers(inputFile: string, tokenAddress: string): Promise<AnalysisResults> {
    console.log(`Starting analysis for token ${tokenAddress} from file ${inputFile}`);
    // logger?.info(`Starting analysis for token ${tokenAddress} from file ${inputFile}`); // Uncomment when logger is integrated

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
        // Potentially throw or handle specific errors
    }
    
    const allRecords = parseResult.data;
    console.log(`Parsed ${allRecords.length} records.`);


    // --- 2. Data Filtering & Preparation ---
    console.log(`Filtering records for token address: ${tokenAddress}...`);
    const filteredRecords = allRecords.filter(record => record.TokenAddress === tokenAddress);
    console.log(`Found ${filteredRecords.length} records for the specified token.`);

    if (filteredRecords.length === 0) {
        console.warn('No records found for the specified token address.');
        // Return early or with zeroed results
        return { 
            /* Initial empty results */
            tokenAddress, inputFile, totalAmountIn: 0, totalAmountOut: 0, netAmountChange: 0,
            totalValueIn: 0, totalValueOut: 0, netValueChange: 0, transferCountIn: 0,
            transferCountOut: 0, processedRecords: allRecords.length, filteredRecords: 0
        };
    }
    
    // Placeholder for preparing data (parsing dates, numbers, adjusting amount)
    const preparedRecords = filteredRecords.map((record, index) => {
        // TODO: Implement robust parsing and error handling
        const decimals = parseInt(record.Decimals, 10);
        const amountRaw = record.Amount?.trim() || '0'; // Handle potential undefined/null and trim whitespace
        const valueRaw = record.Value?.trim() || '0';  // Handle potential undefined/null and trim whitespace
        const flowRaw = record.Flow?.trim(); // Handle potential undefined/null and trim whitespace

        // FIX: Remove commas from amountRaw before parsing
        const amount = parseFloat(amountRaw.replace(/,/g, '')) / Math.pow(10, isNaN(decimals) ? 0 : decimals);
        const value = parseFloat(valueRaw.replace(/[^0-9.-]+/g,"")); // Remove currency symbols/commas
        
        // Correctly parse Unix timestamp (seconds) to Date object (milliseconds)
        const timeSeconds = parseInt(record.Time, 10);
        const time = new Date(isNaN(timeSeconds) ? NaN : timeSeconds * 1000);

        // --- REMOVED DEBUG LOGGING ---
        // console.log(`DEBUG [${index}] PREP: Flow='${flowRaw}', Amt='${amountRaw}', Val='${valueRaw}' -> pAmt=${amount}, pVal=${value}, pTime=${time.toISOString()}`);
        
        return {
            ...record,
            Flow: flowRaw, // Use trimmed value
            parsedAmount: isNaN(amount) ? 0 : amount,
            parsedValue: isNaN(value) ? 0 : value,
            parsedTime: isNaN(time.getTime()) ? undefined : time, // Store Date object or undefined if invalid
        };
    }).filter(r => r.parsedTime); // Remove records with invalid dates

    // --- 3. Data Sorting ---
    console.log('Sorting records by time...');
    preparedRecords.sort((a, b) => (a.parsedTime!.getTime() - b.parsedTime!.getTime()));


    // --- 4. Analysis Calculation ---
    console.log('Calculating metrics...');
    let totalAmountIn = 0;
    let totalAmountOut = 0;
    let totalValueIn = 0;
    let totalValueOut = 0;
    let transferCountIn = 0;
    let transferCountOut = 0;
    
    for (const record of preparedRecords) {
        // --- REMOVED DEBUG LOGGING ---
        // console.log(`DEBUG CALC: Checking Record Flow='${record.Flow}' (Type: ${typeof record.Flow})`);
        
        // FIX: Check against lowercase 'in' and 'out'
         if (record.Flow === 'in') {
            // console.log(`DEBUG CALC: Adding IN - Amount: ${record.parsedAmount}, Value: ${record.parsedValue}`); 
            totalAmountIn += record.parsedAmount;
            totalValueIn += record.parsedValue;
            transferCountIn++;
        } else if (record.Flow === 'out') {
            // console.log(`DEBUG CALC: Adding OUT - Amount: ${record.parsedAmount}, Value: ${record.parsedValue}`); 
            totalAmountOut += record.parsedAmount; // Amount might be negative already, check data source consistency
            totalValueOut += record.parsedValue;
            transferCountOut++;
        } else {
            // console.log(`DEBUG CALC: Flow is neither 'in' nor 'out'.`); 
             // Optionally handle unexpected Flow values here if needed
        }
    }
    
    const netAmountChange = totalAmountIn - Math.abs(totalAmountOut); // Assuming Out amounts might be negative
    const netValueChange = totalValueOut - totalValueIn;


    // --- 5. Prepare Results ---
    const results: AnalysisResults = {
        tokenAddress,
        inputFile: absoluteInputPath,
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
        processedRecords: allRecords.length, 
        filteredRecords: preparedRecords.length, // Count after preparation/filtering
    };

    console.log('Analysis complete.');
    return results;
}

function displayResults(results: AnalysisResults) {
    console.log('\n--- Transfer Analysis Report ---');
    console.log(`Token Address: ${results.tokenAddress}`);
    console.log(`Input File: ${results.inputFile}`);
    console.log(`Time Range: ${results.firstTransferTime?.toISOString() ?? 'N/A'} to ${results.lastTransferTime?.toISOString() ?? 'N/A'}`);
    console.log(`Processed Records: ${results.processedRecords}`);
    console.log(`Filtered Records (for token): ${results.filteredRecords}`);
    console.log('\n--- Flow Summary ---');
    console.log(`Transfers In: ${results.transferCountIn}`);
    console.log(`Transfers Out: ${results.transferCountOut}`);
    // --- Refined Amount Formatting --- 
    console.log(`Total Amount In: ${results.totalAmountIn.toFixed(0)}`); // No decimals
    console.log(`Total Amount Out: ${results.totalAmountOut.toFixed(0)}`); // No decimals
    console.log(`Net Amount Change (Remaining): ${results.netAmountChange.toFixed(0)}`); // No decimals
    // --- Add Percentage Remaining --- 
    const percentageRemaining = results.totalAmountIn !== 0 
        ? ((results.netAmountChange / results.totalAmountIn) * 100).toFixed(2)
        : 'N/A'; // Avoid division by zero
    console.log(`Percentage Remaining: ${percentageRemaining}%`);
    // --- Value Metrics (Keep decimals) --- 
    console.log(`Total Value In ($): ${results.totalValueIn.toFixed(2)}`);
    console.log(`Total Value Out ($): ${results.totalValueOut.toFixed(2)}`);
    console.log(`Net Value Change ($): ${results.netValueChange.toFixed(2)}`); // Correctly reflects net value flow
    console.log('----------------------------\n');
}

// Function to write results to CSV
function writeResultsToCsv(results: AnalysisResults): void {
    const outputDir = path.resolve('./analysis_reports'); // Define output directory
    if (!fs.existsSync(outputDir)){
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Sanitize token address for filename
    const safeTokenAddress = results.tokenAddress.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const outputFilename = `transfer_analysis_report_${safeTokenAddress}_${Date.now()}.csv`;
    const outputPath = path.join(outputDir, outputFilename);

    console.log(`Writing analysis report to: ${outputPath}`);

    const csvData = [
        {
            Metric: 'Token Address', 
            Value: results.tokenAddress
        },
        {
            Metric: 'Input File', 
            Value: results.inputFile
        },
        {
            Metric: 'Time Range Start', 
            Value: results.firstTransferTime?.toISOString() ?? 'N/A'
        },
        {
            Metric: 'Time Range End', 
            Value: results.lastTransferTime?.toISOString() ?? 'N/A'
        },
        {
            Metric: 'Processed Records (Total)',
            Value: results.processedRecords.toString()
        },
        {
            Metric: 'Filtered Records (Token)',
            Value: results.filteredRecords.toString()
        },
        { Metric: '-', Value: '-' }, // Separator
        { Metric: 'Transfers In Count', Value: results.transferCountIn.toString() },
        { Metric: 'Transfers Out Count', Value: results.transferCountOut.toString() },
        {
            Metric: 'Total Amount In',
            Value: results.totalAmountIn.toFixed(0) // No decimals in CSV too
        },
        {
            Metric: 'Total Amount Out', 
            Value: results.totalAmountOut.toFixed(0) // No decimals in CSV too
        },
        {
            Metric: 'Net Amount Change',
            Value: results.netAmountChange.toFixed(0) // No decimals in CSV too
        },
        {
            Metric: 'Percentage Remaining (%)', // Add percentage to CSV
            Value: results.totalAmountIn !== 0 ? ((results.netAmountChange / results.totalAmountIn) * 100).toFixed(2) : 'N/A'
        },
        {
            Metric: 'Total Value In ($)',
            Value: results.totalValueIn.toFixed(2)
        },
        {
            Metric: 'Total Value Out ($)',
            Value: results.totalValueOut.toFixed(2)
        },
        {
            Metric: 'Net Value Change ($)', // Performance Metric
            Value: results.netValueChange.toFixed(2)
        },
    ];

    try {
        const csvString = Papa.unparse(csvData);
        fs.writeFileSync(outputPath, csvString, 'utf8');
        console.log('Successfully wrote CSV report.');
    } catch (error) {
        console.error('Error writing CSV report:', error);
        // logger?.error('Error writing CSV report:', error);
    }
}

// --- Main Execution ---
(async () => {
    const defaultInputFile = './data/export_transfer_DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm_1745318132815.csv'; // Default to the specific file inside ./data/

    const argv = await yargs(hideBin(process.argv))
        .option('inputFile', {
            alias: 'i',
            description: 'Path to the input CSV file',
            type: 'string',
            default: defaultInputFile, // Set the default value
            // demandOption: true, // No longer strictly required
        })
        .option('tokenAddress', {
            alias: 't',
            description: 'Token mint address to analyze',
            type: 'string',
            demandOption: true, // Still required
        })
        .help()
        .alias('help', 'h')
        .argv;

    // Check if the default file exists if it's being used
    const inputFileToUse = argv.inputFile || defaultInputFile;
    if (!fs.existsSync(path.resolve(inputFileToUse))) {
        console.error(`Error: Input file not found at ${path.resolve(inputFileToUse)}.`);
        console.error(`Please ensure the file exists or provide a valid path using --inputFile`);
        process.exit(1);
    }

    try {
        const results = await analyzeTransfers(inputFileToUse, argv.tokenAddress);
        displayResults(results);
        writeResultsToCsv(results); // Call the CSV writing function
    } catch (error) {
        console.error('Error during analysis:', error);
        // logger?.error('Error during analysis:', error); // Uncomment when logger is integrated
        process.exit(1);
    }
})(); 