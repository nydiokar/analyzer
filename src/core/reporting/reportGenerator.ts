import { createLogger } from 'core/utils/logger';
import { BehaviorService } from 'core/analysis/behavior/behavior-service';
import { CorrelationService } from 'core/analysis/correlation/correlation-service';
import { SimilarityService, ComprehensiveSimilarityResult } from 'core/analysis/similarity/similarity-service';
import { KPIComparisonAnalyzer } from 'core/analysis/behavior/kpi_analyzer';
import { generateBehaviorReport, generateCorrelationReport, generateSimilarityReport, saveReport } from './report_utils'; // Import utils
import { BehavioralMetrics } from '@/types/behavior';
import { WalletInfo } from '@/types/wallet';
import { PnlAnalysisService } from 'core/services/pnl-analysis-service';
import { SwapAnalysisSummary } from '@/types/helius-api';
import { generateSwapPnlReport, generateSwapPnlCsv } from './report_utils'; // Import additional report utils


const logger = createLogger('ReportingService');

export class ReportingService {
    // private behaviorService: BehaviorService; // Included via constructor
    private kpiAnalyzer: KPIComparisonAnalyzer | undefined; // Allow undefined
    // Inject other services needed for generating different report types
    private correlationService: CorrelationService | undefined; // Allow undefined
    private similarityService: SimilarityService | undefined; // Allow undefined
    private pnlAnalysisService: PnlAnalysisService | undefined; // Allow undefined

    constructor(
        private behaviorService: BehaviorService | undefined, // Allow undefined
        kpiAnalyzer: KPIComparisonAnalyzer | undefined, // Allow undefined
        correlationService: CorrelationService | undefined, // Keep optional syntax too
        similarityService: SimilarityService | undefined,  // Keep optional syntax too
        pnlAnalysisService: PnlAnalysisService | undefined // Added
    ) {
        this.behaviorService = behaviorService; // Assign directly
        this.kpiAnalyzer = kpiAnalyzer;
        this.correlationService = correlationService;
        this.similarityService = similarityService;
        this.pnlAnalysisService = pnlAnalysisService; // Assign
        logger.info('ReportingService instantiated');
    }

    /**
     * Generates individual and comparative behavior reports for a list of wallets.
     * 
     * @param wallets - Array of WalletInfo objects.
     * @returns Promise resolving when all reports are generated and saved.
     */
    async generateComparativeBehaviorReport(wallets: WalletInfo[]): Promise<void> {
        if (!this.behaviorService) { // Check if service is available
            logger.error('BehaviorService not injected. Cannot generate comparative behavior report.');
            return;
        }
        if (!wallets || wallets.length === 0) {
            logger.warn('No wallets provided for comparison report.');
            return;
        }

        logger.info(`Generating comparative report for ${wallets.length} wallets`);

        const walletMetrics: Array<{ wallet: WalletInfo, metrics: BehavioralMetrics }> = [];

        for (const wallet of wallets) {
            const walletId = wallet.label ? `${wallet.address} (${wallet.label})` : wallet.address;
            logger.info(`Analyzing wallet: ${walletId}`);
            try {
                // Use BehaviorService to get metrics
                const metrics = await this.behaviorService.analyzeWalletBehavior(wallet.address);
                
                if (metrics) {
                    walletMetrics.push({
                        wallet,
                        metrics,
                    });
                    // Generate and save individual report using the utility function
                    const individualReportContent = generateBehaviorReport(wallet.address, metrics);
                    const reportPath = saveReport(wallet.address, individualReportContent, 'individual');
                    logger.info(`Saved individual report for ${wallet.address} to ${reportPath}`);
                } else {
                     logger.warn(`No metrics generated for wallet ${wallet.address}, skipping its reports.`);
                }
            } catch (error) {
                logger.error(`Error processing wallet ${walletId} for comparison report:`, error);
                // Continue with the next wallet
            }
        }

        if (walletMetrics.length === 0 || !this.kpiAnalyzer) { // Also check kpiAnalyzer
             if (!this.kpiAnalyzer) logger.warn('KPIAnalyzer not injected. Cannot generate final comparison.');
             else logger.warn('Failed to collect metrics for any wallets. No comparison report generated.');
             return;
        }

        // Generate comparative report using the analyzer
        try {
            const comparisonReportContent = this.kpiAnalyzer.generateComparisonReport(walletMetrics);
            const reportPath = saveReport('kpi_comparison', comparisonReportContent, 'comparison'); // Use specific name
            logger.info(`Saved comparative report to ${reportPath}`);
        } catch (error) {
             logger.error('Error generating or saving the final comparison report:', error);
        }
        
        logger.info('Comparative report generation process complete.');
    }

    /**
     * Generates and saves an individual behavior report (Markdown) for a single wallet.
     * 
     * @param walletAddress - The address of the wallet.
     * @param metrics - The calculated BehavioralMetrics for the wallet.
     */
    generateAndSaveBehaviorReportMD(walletAddress: string, metrics: BehavioralMetrics): void {
        if (!metrics) {
            logger.warn(`No metrics provided for wallet ${walletAddress}. Cannot generate individual behavior report.`);
            return;
        }
        logger.debug(`Generating individual behavior report (MD) for ${walletAddress}`);
        try {
            const reportContent = generateBehaviorReport(walletAddress, metrics);
            const reportPath = saveReport(walletAddress, reportContent, 'behavior_metrics_md', 'md');
            logger.info(`Saved individual behavior report (MD) for ${walletAddress} to ${reportPath}`);
        } catch (error) {
            logger.error(`Error generating or saving individual behavior report (MD) for ${walletAddress}:`, { error });
        }
    }

    /**
     * Generates and saves a correlation report for a list of wallets.
     */
    async generateAndSaveCorrelationReport(targetWallets: WalletInfo[]): Promise<void> {
        if (!this.correlationService) {
            logger.error('CorrelationService not injected. Cannot generate correlation report.');
            return;
        }
        if (!targetWallets || targetWallets.length === 0) {
            logger.warn('No wallets provided for correlation report.');
            return;
        }
        logger.info(`Generating correlation report for ${targetWallets.length} wallets...`);
        try {
            // Pass WalletInfo[] to runCorrelationAnalysis
            const result = await this.correlationService.runCorrelationAnalysis(targetWallets); 
            if (result) {
                // The result might contain data for a subset of targetWallets if some had no transactions.
                // We need to ensure the WalletInfo passed to generateCorrelationReport matches the wallets in the 'result'.

                // Extract addresses from the correlation result to filter targetWallets
                const involvedAddressesInResult = new Set<string>();
                result.pairs.forEach(p => { 
                    involvedAddressesInResult.add(p.walletA_address); 
                    involvedAddressesInResult.add(p.walletB_address); 
                });
                result.clusters.forEach(c => c.wallets.forEach(wAddr => involvedAddressesInResult.add(wAddr)));
                // Add addresses from walletPnLs as well, if they exist
                if (result.walletPnLs) {
                    Object.keys(result.walletPnLs).forEach(addr => involvedAddressesInResult.add(addr));
                }

                // Filter the original targetWallets to only include those present in the analysis results
                const walletInfosForReport = targetWallets.filter(w => involvedAddressesInResult.has(w.address));

                if (walletInfosForReport.length === 0 && (result.pairs.length > 0 || result.clusters.length > 0)) {
                    // This case should ideally not happen if runCorrelationAnalysis returns results for at least two wallets.
                    // However, as a safeguard, if we have pairs/clusters but no WalletInfo, log a warning.
                    // For the report, we might have to use addresses directly if labels are missing.
                    logger.warn('Correlation result has pairs/clusters, but could not map all to original WalletInfo. Report might lack labels.');
                    // Fallback: create basic WalletInfo from result addresses if labels are critical for the report
                    // const fallbackWalletInfos = Array.from(involvedAddressesInResult).map(addr => ({ address: addr }));
                    // For now, we proceed with potentially empty walletInfosForReport if all else fails, 
                    // generateCorrelationReport should handle this gracefully.
                }

                const reportContent = generateCorrelationReport(
                    result,
                    walletInfosForReport, // Pass filtered WalletInfo based on actual analysis results
                    result.walletPnLs // Pass PNLs from result
                );
                const reportPath = saveReport('correlation', reportContent, 'correlation');
                logger.info(`Saved correlation report to ${reportPath}`);
            } else {
                logger.warn('Correlation analysis did not produce results. Report not generated.');
            }
        } catch (error) {
            logger.error('Error generating or saving correlation report:', { error });
        }
    }

    /**
     * Generates and saves a similarity report for a list of wallets.
     * It now calls the enhanced similarity service and passes the comprehensive results to the report utility.
     */
    async generateAndSaveSimilarityReport(walletAddresses: string[], vectorType: 'capital' | 'binary' = 'capital'): Promise<void> {
        if (!this.similarityService) {
            logger.error('SimilarityService not injected. Cannot generate similarity report.');
            return;
        }
        logger.info(`Generating similarity report for ${walletAddresses.length} wallets (type: ${vectorType})...`);
        try {
            // Call the enhanced service method which returns ComprehensiveSimilarityResult | null
            const comprehensiveMetrics: ComprehensiveSimilarityResult | null = await this.similarityService.calculateWalletSimilarity(walletAddresses, vectorType);
            
            if (comprehensiveMetrics) {
                 // Need WalletInfo for labels - create placeholders or fetch if necessary
                 // report_utils now expects WalletInfo[]
                 const walletInfos: WalletInfo[] = walletAddresses.map(addr => ({ address: addr })); // Simple placeholder

                // Pass the comprehensive metrics object to the updated report utility
                const reportContent = generateSimilarityReport(comprehensiveMetrics, walletInfos);
                const reportPath = saveReport(`similarity_${vectorType}`, reportContent, 'similarity');
                logger.info(`Saved similarity report to ${reportPath}`);
            } else {
                logger.warn('Similarity analysis did not produce results. Report not generated.');
            }
        } catch (error) {
            logger.error('Error generating or saving similarity report:', { error });
        }
    }

    /**
     * Generates and saves a Swap P/L analysis report (Markdown).
     *
     * @param walletAddress The wallet address being reported on.
     * @param summary The SwapAnalysisSummary data.
     */
    async generateAndSaveSwapPnlReport(walletAddress: string, summary: SwapAnalysisSummary): Promise<void> {
        if (!summary) {
            logger.warn(`[ReportingService] No summary provided for ${walletAddress}. Cannot generate Swap Pnl report.`);
            return;
        }
        logger.info(`[ReportingService] Generating Swap Pnl report for ${walletAddress}...`);
        try {
            const reportContent = generateSwapPnlReport(summary, walletAddress);
            const reportPath = saveReport(walletAddress, reportContent, 'swap_pnl', 'md');
            logger.info(`[ReportingService] Saved Swap Pnl report to ${reportPath}`);
        } catch (error) {
            logger.error(`[ReportingService] Error generating or saving Swap Pnl report for ${walletAddress}:`, { error });
        }
    }

    /**
     * Generates and saves a Swap P/L analysis report as a CSV file.
     *
     * @param walletAddress The wallet address being reported on.
     * @param summary The SwapAnalysisSummary data.
     * @param runId Optional AnalysisRun ID to include in the CSV.
     */
    async generateAndSaveSwapPnlCsv(walletAddress: string, summary: SwapAnalysisSummary, runId?: number): Promise<void> {
         if (!summary) {
            logger.warn(`[ReportingService] No summary provided for ${walletAddress}. Cannot generate Swap Pnl CSV.`);
            return;
        }
        logger.info(`[ReportingService] Generating Swap Pnl CSV for ${walletAddress}...`);
        try {
            const csvContent = generateSwapPnlCsv(summary, walletAddress, runId);
            if (csvContent) {
                const reportPath = saveReport(walletAddress, csvContent, 'swap_pnl_csv', 'csv');
                logger.info(`[ReportingService] Saved Swap Pnl CSV to ${reportPath}`);
            } else {
                 logger.warn(`[ReportingService] CSV content generation failed for ${walletAddress}.`);
            }
        } catch (error) {
            logger.error(`[ReportingService] Error generating or saving Swap Pnl CSV for ${walletAddress}:`, { error });
        }
    }
} 