import { CorrelationAnalyzer } from '../core/correlation/analyzer';
import { DatabaseService } from './database-service'; // Assuming db service export is fixed
import { CorrelationAnalysisConfig } from '../../types/analysis'; // Updated import
import { CorrelationMetrics, TransactionData, CorrelatedPairData } from '../../types/correlation'; // Use TransactionData
import { WalletInfo } from '../../types/wallet'; // Import WalletInfo
import { CLUSTERING_CONFIG } from '../../config/constants'; // Assuming config lives here
import { createLogger } from '../../utils/logger';
import { calculatePnlForWallets } from '../utils/pnl_calculator'; // Import PNL utility

const logger = createLogger('CorrelationService');

// Configuration specific to bot filtering (could be moved to constants/config)
const MAX_DAILY_TOKENS_FOR_FILTER = 50;

export class CorrelationService {
  private correlationAnalyzer: CorrelationAnalyzer;
  private config: CorrelationAnalysisConfig; // Store the specific config

  constructor(
    private databaseService: DatabaseService,
    // Potentially add HeliusApiClient if needed for fetching additional data
    config: CorrelationAnalysisConfig // Update constructor signature
  ) {
    this.config = config; // Store the incoming config
    // Initialize the analyzer with the specific clustering thresholds from the config,
    // or the default CLUSTERING_CONFIG if thresholds are not provided in the specific config.
    const analyzerConfig = config.thresholds ?? CLUSTERING_CONFIG;
    this.correlationAnalyzer = new CorrelationAnalyzer(analyzerConfig);
    logger.info('CorrelationService instantiated with correlation-specific config.'); // Update log
  }

  /**
   * Fetches data for specified wallets, filters potential bots,
   * calculates PNL, and runs correlation analysis.
   * @param walletAddresses - An array of wallet addresses to analyze.
   * @returns A promise resolving to CorrelationMetrics or null if an error occurs.
   */
  async runCorrelationAnalysis(
    walletAddresses: string[]
  ): Promise<CorrelationMetrics & { walletPnLs?: Record<string, number> } | null> { // Extend return type for PNL
    logger.info(`Running correlation analysis for ${walletAddresses.length} wallets.`);

    let allTransactionData: Record<string, TransactionData[]> = {}; // Store all initially fetched data
    let walletInfos: WalletInfo[] = [];

    // 1. Fetch required data (Transactions and WalletInfo)
    try {
      walletInfos = await this.databaseService.getWallets(walletAddresses); // Assuming a method like this exists
      const validAddresses = new Set(walletInfos.map(w => w.address));
      const requestedAddresses = [...walletAddresses]; // Keep original list for logging
      walletAddresses = walletAddresses.filter(addr => validAddresses.has(addr)); // Filter based on found WalletInfo
      if (walletAddresses.length !== requestedAddresses.length) {
           logger.warn(`Could not fetch WalletInfo for all requested addresses. Proceeding with ${walletAddresses.length} wallets.`);
      }
      if (walletAddresses.length < 2) {
          logger.warn('Need at least 2 wallets with WalletInfo to proceed.');
          return this.getEmptyMetrics();
      }

      // Fetch Transactions using correlation config
      allTransactionData = await this.databaseService.getTransactionsForAnalysis(
          walletAddresses, 
          this.config // Pass the CorrelationAnalysisConfig object
      );
      logger.debug(`Fetched transaction data for ${Object.keys(allTransactionData).length} wallets.`);

    } catch (error) {
        logger.error('Error fetching data for correlation analysis:', { error });
        return null;
    }

    // 2. Filter wallets (Bot Detection Logic)
    const { filteredWalletInfos, filteredTransactionData } = this.filterWalletsByActivity(
        walletInfos, // Pass original WalletInfo array
        allTransactionData
    );

    if (filteredWalletInfos.length < 2) {
        logger.warn('Less than 2 wallets remain after bot filtering. Cannot perform correlation analysis.');
        return this.getEmptyMetrics();
    }

    // 3. Calculate PNL for filtered wallets
    const walletPnLs = calculatePnlForWallets(filteredTransactionData);

    // 4. Run the analysis using the core analyzer methods on FILTERED data
    try {
      const pairs: CorrelatedPairData[] = await this.correlationAnalyzer.analyzeCorrelations(filteredTransactionData, filteredWalletInfos);
      const clusters = await this.correlationAnalyzer.identifyClusters(pairs);
      // Get global stats based on the *filtered* data used for correlation
      const globalTokenStats = this.correlationAnalyzer.getGlobalTokenStats(filteredTransactionData);

      const metrics: CorrelationMetrics = {
        pairs,
        clusters,
        globalTokenStats
      };

      logger.info('Correlation analysis completed successfully.');
      // Include PNLs in the return object
      return { ...metrics, walletPnLs };
    } catch (error) {
        logger.error('Error during correlation analysis execution:', { error });
        return null;
    }
  }

  /**
   * Filters wallets based on daily unique token activity to exclude potential bots.
   * Logic moved from activityCorrelator.ts script.
   */
  private filterWalletsByActivity( 
    walletInfos: WalletInfo[], // Use original WalletInfo
    transactionData: Record<string, TransactionData[]>
  ): { filteredWalletInfos: WalletInfo[], filteredTransactionData: Record<string, TransactionData[]> } {
      logger.debug(`Filtering ${walletInfos.length} wallets based on daily activity (threshold: ${MAX_DAILY_TOKENS_FOR_FILTER} unique tokens/day)...`);
      const dailyTokenCountsByWallet: Record<string, Record<string, Set<string>>> = {};

      // Calculate daily unique token counts
      for (const walletInfo of walletInfos) {
          const address = walletInfo.address;
          const transactions = transactionData[address];
          if (!transactions) continue;

          dailyTokenCountsByWallet[address] = dailyTokenCountsByWallet[address] || {};
          transactions.forEach(txn => {
              const day = new Date(txn.timestamp * 1000).toISOString().split('T')[0];
              dailyTokenCountsByWallet[address][day] = dailyTokenCountsByWallet[address][day] || new Set<string>();
              dailyTokenCountsByWallet[address][day].add(txn.mint);
          });
      }

      // Filter based on threshold
      const filteredWalletInfos = walletInfos.filter(wallet => {
          const address = wallet.address;
          const walletDailyActivity = dailyTokenCountsByWallet[address] || {};
          const exceedsThreshold = Object.values(walletDailyActivity).some(
              tokenSetOnDay => tokenSetOnDay.size > MAX_DAILY_TOKENS_FOR_FILTER
          );

          if (exceedsThreshold) {
              logger.debug(`Filtering out wallet ${wallet.label || address} due to exceeding threshold.`);
              return false;
          }
          return true;
      });

      const filteredAddresses = new Set(filteredWalletInfos.map(w => w.address));
      const filteredTransactionData = Object.entries(transactionData).reduce((acc, [address, txs]) => {
          if (filteredAddresses.has(address)) {
              acc[address] = txs;
          }
          return acc;
      }, {} as Record<string, TransactionData[]>);

      if (walletInfos.length !== filteredWalletInfos.length) {
          logger.info(`Filtered out ${walletInfos.length - filteredWalletInfos.length} wallets suspected of bot activity. Analyzing ${filteredWalletInfos.length} wallets.`);
      } else {
          logger.info(`No wallets filtered out based on daily token activity.`);
      }
      return { filteredWalletInfos, filteredTransactionData };
  }

  private getEmptyMetrics(): CorrelationMetrics {
      return { pairs: [], clusters: [], globalTokenStats: { totalNonObviousTokens: 0, totalPopularTokens: 0, totalUniqueTokens: 0 } };
  }
} 