import { createLogger } from '../../utils/logger';
import { BehaviorService } from '../services/behavior-service';
import { CorrelationService } from '../services/correlation-service';
import { SimilarityService } from '../services/similarity-service';
import { KPIComparisonAnalyzer } from '../core/reporting/kpi_analyzer';
import { generateBehaviorReport, generateCorrelationReport, generateSimilarityReport, saveReport } from '../reporting/report_utils'; // Import utils
import { BehavioralMetrics } from '../../types/behavior';
import { WalletInfo } from '../../types/wallet';


const logger = createLogger('ReportingService');

export class ReportingService {
    // private behaviorService: BehaviorService; // Included via constructor
    private kpiAnalyzer: KPIComparisonAnalyzer | undefined; // Allow undefined
    // Inject other services needed for generating different report types
    private correlationService: CorrelationService | undefined; // Allow undefined
    private similarityService: SimilarityService | undefined; // Allow undefined

    constructor(
        private behaviorService: BehaviorService | undefined, // Allow undefined
        kpiAnalyzer: KPIComparisonAnalyzer | undefined, // Allow undefined
        correlationService?: CorrelationService | undefined, // Keep optional syntax too
        similarityService?: SimilarityService | undefined  // Keep optional syntax too
    ) {
        this.behaviorService = behaviorService; // Assign directly
        this.kpiAnalyzer = kpiAnalyzer;
        this.correlationService = correlationService;
        this.similarityService = similarityService;
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
     * Generates and saves an individual behavior report for a single wallet.
     * 
     * @param walletAddress - The address of the wallet.
     * @param metrics - The calculated BehavioralMetrics for the wallet.
     */
    generateAndSaveIndividualBehaviorReport(walletAddress: string, metrics: BehavioralMetrics): void {
        if (!metrics) {
            logger.warn(`No metrics provided for wallet ${walletAddress}. Cannot generate individual report.`);
            return;
        }
        logger.debug(`Generating individual behavior report for ${walletAddress}`);
        try {
            const reportContent = generateBehaviorReport(walletAddress, metrics);
            const reportPath = saveReport(walletAddress, reportContent, 'individual');
            logger.info(`Saved individual behavior report for ${walletAddress} to ${reportPath}`);
        } catch (error) {
            logger.error(`Error generating or saving individual behavior report for ${walletAddress}:`, { error });
        }
    }

    /**
     * Generates and saves a correlation report for a list of wallets.
     */
    async generateAndSaveCorrelationReport(walletAddresses: string[]): Promise<void> {
        if (!this.correlationService) {
            logger.error('CorrelationService not injected. Cannot generate correlation report.');
            return;
        }
        logger.info(`Generating correlation report for ${walletAddresses.length} wallets...`);
        try {
            const result = await this.correlationService.runCorrelationAnalysis(walletAddresses);
            if (result) {
                // Need WalletInfo for labels - fetch them?
                // Assuming CorrelationService can provide them or we fetch separately
                // Placeholder: Fetch WalletInfo based on addresses in result.pairs/clusters
                const involvedAddresses = new Set<string>();
                result.pairs.forEach(p => { involvedAddresses.add(p.walletA_address); involvedAddresses.add(p.walletB_address); });
                result.clusters.forEach(c => c.wallets.forEach(w => involvedAddresses.add(w)));
                // TODO: Fetch WalletInfo for involvedAddresses using DatabaseService if needed
                const walletInfos: WalletInfo[] = Array.from(involvedAddresses).map(addr => ({ address: addr })); // Placeholder

                const reportContent = generateCorrelationReport(
                    result,
                    walletInfos, // Pass fetched WalletInfo
                    result.walletPnLs // Pass PNLs from result
                    // Pass config if needed by generateCorrelationReport
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
     */
    async generateAndSaveSimilarityReport(walletAddresses: string[], vectorType: 'capital' | 'binary' = 'capital'): Promise<void> {
        if (!this.similarityService) {
            logger.error('SimilarityService not injected. Cannot generate similarity report.');
            return;
        }
        logger.info(`Generating similarity report for ${walletAddresses.length} wallets (type: ${vectorType})...`);
        try {
            const metrics = await this.similarityService.calculateWalletSimilarity(walletAddresses, vectorType);
            if (metrics) {
                 // TODO: Fetch WalletInfo for involved addresses if needed for labels
                 const walletInfos: WalletInfo[] = walletAddresses.map(addr => ({ address: addr })); // Placeholder

                const reportContent = generateSimilarityReport(metrics, walletInfos);
                const reportPath = saveReport(`similarity_${vectorType}`, reportContent, 'similarity');
                logger.info(`Saved similarity report to ${reportPath}`);
            } else {
                logger.warn('Similarity analysis did not produce results. Report not generated.');
            }
        } catch (error) {
            logger.error('Error generating or saving similarity report:', { error });
        }
    }
} 