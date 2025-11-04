import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';
import { Prisma, AnalysisResult as PrismaAnalysisResult, TokenInfo } from '@prisma/client';
import { TokenPerformanceQueryDto, SortOrder, TokenPerformanceSortBy, SpamFilterType } from '../shared/dto/token-performance-query.dto';
import { ApiProperty } from '@nestjs/swagger';
import { TokenPerformanceDataDto } from '../shared/dto/token-performance-data.dto';
import { TokenInfoService } from '../services/token-info.service';
import { DexscreenerService } from '../services/dexscreener.service';
import { getWellKnownTokenMetadata, isWellKnownToken } from '../../core/utils/token-metadata';  
import { DEFAULT_EXCLUDED_MINTS } from '../../config/constants';

export class PaginatedTokenPerformanceResponse {
  @ApiProperty({ type: () => [TokenPerformanceDataDto], description: 'Array of token performance records' })
  data: TokenPerformanceDataDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}

@Injectable()
/**
 * Service for querying pre-calculated, historical token performance data.
 * Retrieves data from the AnalysisResult table. Ideal for dashboard views
 * and reports, not for live, on-demand balance checks.
 * For live balances, use WalletBalanceService.
 */
export class TokenPerformanceService {
  private readonly logger = new Logger(TokenPerformanceService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly dexscreenerService: DexscreenerService,
  ) {}

  async getPaginatedTokenPerformance(
    walletAddress: string,
    queryDto: TokenPerformanceQueryDto,
  ): Promise<PaginatedTokenPerformanceResponse> {
    this.logger.debug(`Getting paginated token performance for ${walletAddress} from AnalysisResult with DTO: ${JSON.stringify(queryDto)}`);
    const {
        page = 1,
        pageSize = 20,
        sortBy = TokenPerformanceSortBy.NET_SOL_PROFIT_LOSS,
        sortOrder = SortOrder.DESC,
        startDate, // ISO Date String
        endDate,   // ISO Date String
        searchTerm,
        showOnlyHoldings, // Explicitly destructure showOnlyHoldings here for clarity
        pnlConditionOperator,
        pnlConditionValue,
        minTrades,
        spamFilter,
    } = queryDto;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.AnalysisResultWhereInput = {
      walletAddress: walletAddress,
    };

    if (showOnlyHoldings) { // Use the destructured variable
      // Only show meaningful holdings (not dust)
      // This will be further filtered post-processing to ensure positions are worth > $1 USD or have meaningful token amounts
      where.currentUiBalance = { gt: 0 };
    }

    // Add search term filtering
    if (searchTerm) {
      where.tokenAddress = {
        contains: searchTerm,
        // mode: 'insensitive', // Removed earlier, ensure DB collation handles case-insensitivity if needed
      };
    }

    // Apply PNL condition
    if (pnlConditionOperator && typeof pnlConditionValue === 'number') {
      const op = pnlConditionOperator.toLowerCase();
      if (op === 'gt' || op === 'lt' || op === 'gte' || op === 'lte') {
        where.netSolProfitLoss = { [op]: pnlConditionValue } as Prisma.FloatFilter;
      } else if (op === 'eq') { // DTO enum uses 'eq', Prisma uses 'equals' for numbers
        where.netSolProfitLoss = { equals: pnlConditionValue } as Prisma.FloatFilter;
      } else {
        this.logger.warn(`Unsupported PNL operator: ${pnlConditionOperator}. Expected gt, lt, gte, lte, or eq.`);
      }
    }

    // Apply Min Trades condition
    if (typeof minTrades === 'number' && minTrades > 0) {
      // Generic condition for (transferCountIn + transferCountOut) >= minTrades
      // This requires a more complex structure if minTrades can be other than 2, 
      // or specific combinations are needed. For minTrades = 2, the logic is specific.
      if (minTrades === 2) {
        const minTradesCondition = {
          OR: [
            { transferCountIn: { gte: 2 } },
            { transferCountOut: { gte: 2 } },
            {
              AND: [
                { transferCountIn: { equals: 1 } },
                { transferCountOut: { equals: 1 } },
              ],
            },
          ],
        };

        if (where.AND) {
          if (Array.isArray(where.AND)) {
            where.AND.push(minTradesCondition);
          } else {
            where.AND = [where.AND, minTradesCondition];
          }
        } else {
          where.AND = [minTradesCondition];
        }
      } else {
        // For other minTrades values, if a simpler sum isn't directly possible, this might need raw SQL
        // or a broader interpretation e.g. (transferCountIn >= minTrades OR transferCountOut >= minTrades)
        // For now, only minTrades = 2 is explicitly handled with the sum logic.
        this.logger.warn(`Min trades filter currently only implements specific logic for value 2. Received: ${minTrades}`);
      }
    }

    // Apply time range filtering if startDate or endDate is provided
    // This will filter based on when the token activity occurred (lastTransferTimestamp)
    let timeFilter: Prisma.IntFilter | Prisma.IntNullableFilter | undefined = undefined;

    if (typeof where.lastTransferTimestamp === 'object' && where.lastTransferTimestamp !== null) {
        // If it's already an object (like IntFilter), preserve existing conditions
        // Make sure to cast to a type that can be spread and then refined.
        timeFilter = { ...(where.lastTransferTimestamp as Prisma.IntFilter) }; 
    } else if (typeof where.lastTransferTimestamp === 'number') {
        // If it was a direct number, this implies an equality check was set before.
        // For a range query, we typically initialize timeFilter and overwrite this.
        // If we needed to preserve an exact number match AND add range, logic would be more complex.
        // Assuming here that if startDate/endDate are present, we build a range query.
    }
    
    if (startDate) {
      timeFilter = { ...(timeFilter || {}), gte: Math.floor(new Date(startDate).getTime() / 1000) };
    }
    if (endDate) {
      timeFilter = { ...(timeFilter || {}), lte: Math.floor(new Date(endDate).getTime() / 1000) };
    }

    if (timeFilter) {
        where.lastTransferTimestamp = timeFilter;
    }
    
    // If only startDate is provided, it means "from startDate onwards"
    // If only endDate is provided, it means "up to endDate"

    // Handle calculated fields that need post-processing
    let orderBy: Prisma.AnalysisResultOrderByWithRelationInput = {};
    let needsPostSorting = false;
    let needsPostFiltering = false;
    
    // These fields are calculated after data fetch, so they need post-processing
    const calculatedFields = ['roi', 'totalPnlSol', 'unrealizedPnlSol', 'currentSolValue'];
    
    if (calculatedFields.includes(sortBy)) {
      // For calculated fields, we'll sort by a related field for now and apply post-processing
      if (sortBy === 'roi' || sortBy === 'totalPnlSol') {
        orderBy.netSolProfitLoss = sortOrder.toLowerCase() as Prisma.SortOrder;
      } else if (sortBy === 'unrealizedPnlSol' || sortBy === 'currentSolValue') {
        orderBy.currentUiBalance = sortOrder.toLowerCase() as Prisma.SortOrder;
      }
      needsPostSorting = true;
    } else {
      orderBy[sortBy] = sortOrder.toLowerCase() as Prisma.SortOrder;
    }

    // If we need to apply spam filtering or holdings filtering, we need to fetch all results first
    if ((spamFilter && spamFilter !== SpamFilterType.ALL) || showOnlyHoldings) {
      needsPostFiltering = true;
    }

    const [analysisResults, totalResults] = await Promise.all([
      this.databaseService.getAnalysisResults({
        where,
        orderBy,
        skip: (needsPostSorting || needsPostFiltering) ? 0 : skip, // If post-processing, get all
        take: (needsPostSorting || needsPostFiltering) ? undefined : take, // If post-processing, get all
      }),
      this.databaseService.countAnalysisResults({ where }),
    ]);
    
    if (analysisResults.length === 0) {
      this.logger.debug('No AnalysisResult records found for the given criteria.');
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      };
    }

    const tokenAddresses = analysisResults.map(ar => ar.tokenAddress);
    const tokenInfoMap = await this.getTokenInfoMap(tokenAddresses);
    
    // Fetch SOL price once (cached in Redis with 30s TTL)
    // SOL is too liquid to not have price data - this should never fail
    const estimatedSolPriceUsd = await this.tokenInfoService.getSolPrice();

    // Create the token performance data with calculated ROI and unrealized P&L
    let tokenPerformanceDataList: TokenPerformanceDataDto[] = analysisResults.map(ar => {
      const tokenInfo = tokenInfoMap.get(ar.tokenAddress);
      
      // Fallback to well-known token metadata if database doesn't have it
      const fallbackMetadata = getWellKnownTokenMetadata(ar.tokenAddress);
      
      // Calculate unrealized P&L for current holdings
      const currentUiBalance = ar.currentUiBalance || 0;
      const priceUsd = tokenInfo?.priceUsd ? parseFloat(tokenInfo.priceUsd) : null;
      const totalSolSpent = ar.totalSolSpent || 0;
      const totalAmountIn = ar.totalAmountIn || 0;
      const netSolProfitLoss = ar.netSolProfitLoss || 0;
      
      let currentHoldingsValueUsd: number | null = null;
      let currentHoldingsValueSol: number | null = null;
      let unrealizedPnlUsd: number | null = null;
      let unrealizedPnlSol: number | null = null;
      let totalPnlSol: number | null = null;
      let realizedPnlSol: number | null = null;
      let realizedPnlPercentage: number | null = null;
      let unrealizedPnlPercentage: number | null = null;
      
      // Get basic data for calculations
      const totalAmountOut = ar.totalAmountOut || 0;
      const solReceivedFromSales = ar.totalSolReceived || 0;
      const feesPaid = ar.totalFeesPaidInSol || 0;
      // estimatedSolPriceUsd is already fetched from outer scope
      const avgCostPerToken = totalAmountIn > 0 ? totalSolSpent / totalAmountIn : 0;
      
      if (currentUiBalance > 0 && priceUsd && priceUsd > 0) {
        // We have current holdings AND price data - can calculate full P&L
        currentHoldingsValueUsd = currentUiBalance * priceUsd;
        currentHoldingsValueSol = currentHoldingsValueUsd / estimatedSolPriceUsd;
        
        // ✅ FILTER UNREALISTIC SOL VALUES AND USE CENTRALIZED EXCLUDED MINTS
        const maxReasonableSolValue = 10000; // Max 10k SOL value for any single token holding
        const maxReasonablePriceRatio = 1000; // Token price shouldn't be more than 1000x SOL price
        
        if (currentHoldingsValueSol > maxReasonableSolValue || 
            priceUsd > estimatedSolPriceUsd * maxReasonablePriceRatio ||
            DEFAULT_EXCLUDED_MINTS.includes(ar.tokenAddress)) {
          // Reset to null for unrealistic values or excluded tokens
          currentHoldingsValueUsd = null;
          currentHoldingsValueSol = null;
        }
        
        // Realized P&L: Only from tokens that were actually sold
        const costBasisForSoldTokens = totalAmountOut * avgCostPerToken;
        realizedPnlSol = solReceivedFromSales - costBasisForSoldTokens - feesPaid;
        
        // ✅ Only calculate unrealized PnL if we have valid SOL values
        if (currentHoldingsValueSol !== null && currentHoldingsValueUsd !== null) {
          // Unrealized P&L: Current value vs cost basis of remaining holdings
          const costBasisForCurrentHoldings = currentUiBalance * avgCostPerToken;
          unrealizedPnlUsd = currentHoldingsValueUsd - (costBasisForCurrentHoldings * estimatedSolPriceUsd);
          unrealizedPnlSol = currentHoldingsValueSol - costBasisForCurrentHoldings;
          
          // Calculate percentages
          // Realized PNL % = (Realized PNL / Total SOL Invested) × 100
          realizedPnlPercentage = totalSolSpent > 0 ? (realizedPnlSol / totalSolSpent) * 100 : null;
          
          // Unrealized PNL % = (Unrealized PNL / Cost Basis of Current Holdings) × 100  
          unrealizedPnlPercentage = costBasisForCurrentHoldings > 0 ? (unrealizedPnlSol / costBasisForCurrentHoldings) * 100 : null;
          
          // Total P&L: Simple and clean calculation
          totalPnlSol = realizedPnlSol + unrealizedPnlSol;
        } else {
          // ✅ FILTERED TOKEN: Only show realized PnL
          realizedPnlPercentage = totalSolSpent > 0 ? (realizedPnlSol / totalSolSpent) * 100 : null;
          totalPnlSol = realizedPnlSol; // Only realized PnL for filtered tokens
        }
        
             } else if (currentUiBalance > 0) {
         // We have holdings but no price data - can't calculate unrealized P&L
         // Show realized P&L only and mark total as incomplete
         const costBasisForSoldTokens = totalAmountOut * avgCostPerToken;
         realizedPnlSol = solReceivedFromSales - costBasisForSoldTokens - feesPaid;
        
        // Calculate realized PNL percentage
        realizedPnlPercentage = totalSolSpent > 0 ? (realizedPnlSol / totalSolSpent) * 100 : null;
        
        // Can't calculate unrealized without price data
        unrealizedPnlUsd = null;
        unrealizedPnlSol = null;
        unrealizedPnlPercentage = null;
        
        // Total P&L is incomplete without unrealized component
        totalPnlSol = realizedPnlSol; // This will be incomplete but better than using netSolProfitLoss
        
      } else {
        // No current holdings - everything is realized
        realizedPnlSol = netSolProfitLoss;
        realizedPnlPercentage = totalSolSpent > 0 ? (realizedPnlSol / totalSolSpent) * 100 : null;
        
        totalPnlSol = netSolProfitLoss;
        unrealizedPnlUsd = null;
        unrealizedPnlSol = null;
        unrealizedPnlPercentage = null;
      }
      
      const tokenData: TokenPerformanceDataDto = {
        walletAddress: ar.walletAddress,
        tokenAddress: ar.tokenAddress,
        totalAmountIn: ar.totalAmountIn,
        totalAmountOut: ar.totalAmountOut,
        netAmountChange: ar.netAmountChange,
        totalSolSpent: ar.totalSolSpent,
        totalSolReceived: ar.totalSolReceived,
        totalFeesPaidInSol: ar.totalFeesPaidInSol,
        netSolProfitLoss: ar.netSolProfitLoss,
        transferCountIn: ar.transferCountIn,
        transferCountOut: ar.transferCountOut,
        firstTransferTimestamp: ar.firstTransferTimestamp,
        lastTransferTimestamp: ar.lastTransferTimestamp,
        currentRawBalance: ar.currentRawBalance,
        currentUiBalance: ar.currentUiBalance,
        currentUiBalanceString: ar.currentUiBalanceString,
        balanceDecimals: ar.balanceDecimals,
        balanceFetchedAt: ar.balanceFetchedAt ? ar.balanceFetchedAt.toISOString() : null,
        // Send ALL fields raw - TokenBadge will decide priority (centralized logic)
        // DexScreener fields
        name: tokenInfo?.name || fallbackMetadata?.name,
        symbol: tokenInfo?.symbol || fallbackMetadata?.symbol,
        imageUrl: tokenInfo?.imageUrl,
        websiteUrl: tokenInfo?.websiteUrl,
        twitterUrl: tokenInfo?.twitterUrl,
        telegramUrl: tokenInfo?.telegramUrl,
        // Onchain fields
        onchainName: tokenInfo?.onchainName,
        onchainSymbol: tokenInfo?.onchainSymbol,
        onchainImageUrl: tokenInfo?.onchainImageUrl,
        onchainWebsiteUrl: tokenInfo?.onchainWebsiteUrl,
        onchainTwitterUrl: tokenInfo?.onchainTwitterUrl,
        onchainTelegramUrl: tokenInfo?.onchainTelegramUrl,
        // DexScreener market data
        marketCapUsd: tokenInfo?.marketCapUsd,
        liquidityUsd: tokenInfo?.liquidityUsd,
        pairCreatedAt: tokenInfo?.pairCreatedAt ? Number(tokenInfo.pairCreatedAt) : null,
        fdv: tokenInfo?.fdv,
        volume24h: tokenInfo?.volume24h,
        priceUsd: tokenInfo?.priceUsd,
        dexscreenerUpdatedAt: tokenInfo?.dexscreenerUpdatedAt?.toISOString(),
        // Unrealized P&L calculations
        currentHoldingsValueUsd,
        currentHoldingsValueSol,
        unrealizedPnlUsd,
        unrealizedPnlSol,
        totalPnlSol,
        // PNL percentage indicators
        realizedPnlSol,
        realizedPnlPercentage,
        unrealizedPnlPercentage,
      };

      const spamAnalysis = this.analyzeTokenSpamRisk(tokenData);
      tokenData.spamRiskLevel = spamAnalysis.riskLevel;
      tokenData.spamRiskScore = spamAnalysis.riskScore;
      tokenData.spamRiskReasons = spamAnalysis.reasons;
      tokenData.spamPrimaryReason = spamAnalysis.primaryReason;

      return tokenData;
    });

      // Apply meaningful holdings filter (remove dust positions)
    if (showOnlyHoldings) {
      const originalCount = tokenPerformanceDataList.length;
      tokenPerformanceDataList = tokenPerformanceDataList.filter(token => {
        const currentBalance = token.currentUiBalance || 0;
        const currentValueUsd = token.currentHoldingsValueUsd || 0;
        
        // Must have a token balance
        if (currentBalance <= 0) return false;
        
        // Must have price data (filter out "? SOL" positions)
        if (!currentValueUsd || currentValueUsd <= 0) return false;
        
        // Only show positions worth > 0.01 SOL (minimum meaningful holding size)
        const currentValueSol = currentValueUsd / estimatedSolPriceUsd;
        const hasMinimumSolValue = currentValueSol >= 0.01;
        
        return hasMinimumSolValue;
      });
      
      this.logger.debug(`Holdings filter: Filtered ${originalCount} down to ${tokenPerformanceDataList.length} positions with >0.01 SOL value and price data`);
    }

    // Apply spam filtering if specified
    let isFiltered = false;
    if (spamFilter && spamFilter !== SpamFilterType.ALL) {
      isFiltered = true;
      const originalCount = tokenPerformanceDataList.length;
      
      tokenPerformanceDataList = tokenPerformanceDataList.filter(token => {
        const riskLevel = token.spamRiskLevel ?? this.analyzeTokenSpamRisk(token).riskLevel;
        const isUnknown = !token.name || !token.symbol || token.name === 'Unknown Token';

        switch (spamFilter) {
          case SpamFilterType.SAFE:
            // Include tokens that are either known safe tokens OR unknown tokens that analyze as safe
            return riskLevel === 'safe';
          case SpamFilterType.HIGH_RISK:
            return riskLevel === 'high-risk';
          case SpamFilterType.UNKNOWN:
            return isUnknown;
          default:
            return true;
        }
      });
      
      this.logger.debug(`Spam filtering: ${spamFilter} - Filtered ${originalCount} down to ${tokenPerformanceDataList.length} tokens`);
    }

    // Apply calculated field sorting if needed
    if (needsPostSorting) {
      tokenPerformanceDataList.sort((a, b) => {
        let valueA: number;
        let valueB: number;
        
        switch (sortBy) {
          case 'roi':
            // Fixed ROI calculation: Use totalPnlSol instead of netSolProfitLoss for more accurate ROI
            valueA = a.totalSolSpent && a.totalSolSpent !== 0 
              ? (a.totalPnlSol || 0) / a.totalSolSpent * 100 
              : (a.totalPnlSol || 0) > 0 ? Infinity : (a.totalPnlSol || 0) < 0 ? -Infinity : 0;
            valueB = b.totalSolSpent && b.totalSolSpent !== 0 
              ? (b.totalPnlSol || 0) / b.totalSolSpent * 100 
              : (b.totalPnlSol || 0) > 0 ? Infinity : (b.totalPnlSol || 0) < 0 ? -Infinity : 0;
            break;
          case 'totalPnlSol':
            valueA = a.totalPnlSol || 0;
            valueB = b.totalPnlSol || 0;
            break;
          case 'unrealizedPnlSol':
            valueA = a.unrealizedPnlSol || 0;
            valueB = b.unrealizedPnlSol || 0;
            break;
          case 'currentSolValue':
            // Sort by SOL value of current holdings
            valueA = a.currentHoldingsValueUsd ? a.currentHoldingsValueUsd / estimatedSolPriceUsd : 0;
            valueB = b.currentHoldingsValueUsd ? b.currentHoldingsValueUsd / estimatedSolPriceUsd : 0;
            break;
          default:
            valueA = 0;
            valueB = 0;
        }
        
        return sortOrder === SortOrder.DESC ? valueB - valueA : valueA - valueB;
      });
    }

    // Apply pagination if we did post-processing
    if (needsPostSorting || needsPostFiltering) {
      const totalAfterFiltering = tokenPerformanceDataList.length;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      
      tokenPerformanceDataList = tokenPerformanceDataList.slice(startIndex, endIndex);
      
      return {
        data: tokenPerformanceDataList,
        total: totalAfterFiltering,
        page: page,
        pageSize: pageSize,
        totalPages: Math.ceil(totalAfterFiltering / pageSize),
      };
    }
    
    this.logger.debug(`Pagination: page=${page}, pageSize=${pageSize}, total=${totalResults}, returning ${tokenPerformanceDataList.length} items.`);

    return {
      data: tokenPerformanceDataList,
      total: totalResults,
      page: page,
      pageSize: pageSize,
      totalPages: Math.ceil(totalResults / pageSize),
    };
  }

  async getAllTokenPerformanceForWallet(walletAddress: string): Promise<TokenPerformanceDataDto[]> {
    this.logger.debug(`Fetching all token performance for wallet ${walletAddress} from AnalysisResult.`);
    const analysisResults = await this.databaseService.getAnalysisResults({
      where: { walletAddress },
    });

    if (analysisResults.length === 0) {
      this.logger.debug(`No AnalysisResult records found for wallet ${walletAddress}.`);
      return [];
    }

    const tokenAddresses = analysisResults.map(ar => ar.tokenAddress);
    const tokenInfoMap = await this.getTokenInfoMap(tokenAddresses);

    const tokenPerformanceDataList: TokenPerformanceDataDto[] = analysisResults.map(ar => {
      const tokenInfo = tokenInfoMap.get(ar.tokenAddress);
      const tokenData: TokenPerformanceDataDto = {
        walletAddress: ar.walletAddress,
        tokenAddress: ar.tokenAddress,
        totalAmountIn: ar.totalAmountIn,
        totalAmountOut: ar.totalAmountOut,
        netAmountChange: ar.netAmountChange,
        totalSolSpent: ar.totalSolSpent,
        totalSolReceived: ar.totalSolReceived,
        totalFeesPaidInSol: ar.totalFeesPaidInSol,
        netSolProfitLoss: ar.netSolProfitLoss,
        transferCountIn: ar.transferCountIn,
        transferCountOut: ar.transferCountOut,
        firstTransferTimestamp: ar.firstTransferTimestamp,
        lastTransferTimestamp: ar.lastTransferTimestamp,
        currentRawBalance: ar.currentRawBalance,
        currentUiBalance: ar.currentUiBalance,
        currentUiBalanceString: ar.currentUiBalanceString,
        balanceDecimals: ar.balanceDecimals,
        balanceFetchedAt: ar.balanceFetchedAt ? ar.balanceFetchedAt.toISOString() : null,
        name: tokenInfo?.name,
        symbol: tokenInfo?.symbol,
        imageUrl: tokenInfo?.imageUrl,
        websiteUrl: tokenInfo?.websiteUrl,
        twitterUrl: tokenInfo?.twitterUrl,
        telegramUrl: tokenInfo?.telegramUrl,
      };

      const spamAnalysis = this.analyzeTokenSpamRisk(tokenData);
      tokenData.spamRiskLevel = spamAnalysis.riskLevel;
      tokenData.spamRiskScore = spamAnalysis.riskScore;
      tokenData.spamRiskReasons = spamAnalysis.reasons;
      tokenData.spamPrimaryReason = spamAnalysis.primaryReason;

      return tokenData;
    });

    return tokenPerformanceDataList;
  }

  private async getTokenInfoMap(tokenAddresses: string[]): Promise<Map<string, TokenInfo>> {
    const tokenInfoList = await this.tokenInfoService.findMany(tokenAddresses);
    const tokenInfoMap = new Map<string, TokenInfo>();
    for (const info of tokenInfoList) {
      tokenInfoMap.set(info.tokenAddress, info);
    }
    return tokenInfoMap;
  }

  async getAllTokenAddressesForWallet(walletAddress: string): Promise<string[]> {
    this.logger.debug(
      `Fetching all unique token addresses for wallet ${walletAddress} from AnalysisResult.`,
    );
    const addresses =
      await this.databaseService.getUniqueTokenAddressesFromAnalysisResults(
        walletAddress,
      );
    this.logger.debug(
      `Found ${addresses.length} unique addresses for ${walletAddress}.`,
    );
    return addresses;
  }

  // Enhanced spam detection using DexScreener data and transaction patterns
  private analyzeTokenSpamRisk(token: TokenPerformanceDataDto): {
    riskLevel: 'safe' | 'high-risk';
    riskScore: number;
    reasons: string[];
    primaryReason: string;
  } {
    const reasons: string[] = [];
    let riskScore = 0;

    // Check if this is a well-known legitimate token
    if (isWellKnownToken(token.tokenAddress)) {
      const reason = 'Well-known legitimate token';
      return { riskLevel: 'safe', riskScore: 0, reasons: [reason], primaryReason: reason };
    }
    
    // Additional whitelist for tokens that might not be in our well-known list but are legitimate
    const ADDITIONAL_LEGITIMATE_TOKENS = [
      'BTC', 'ETH', 'WBTC', 'WETH', 'FTT', 'MAPS', 'OXY', 'MEDIA',
      'Bitcoin', 'Ethereum', 'Wrapped Bitcoin', 'FTX Token'
    ];
    
    if (token.symbol && ADDITIONAL_LEGITIMATE_TOKENS.includes(token.symbol)) {
      const reason = 'Whitelisted legitimate token';
      return { riskLevel: 'safe', riskScore: 0, reasons: [reason], primaryReason: reason };
    }
    if (token.name && ADDITIONAL_LEGITIMATE_TOKENS.includes(token.name)) {
      const reason = 'Whitelisted legitimate token';
      return { riskLevel: 'safe', riskScore: 0, reasons: [reason], primaryReason: reason };
    }

    // Check if token has name/symbol (unknown tokens)
    const isUnknown = !token.name || !token.symbol || token.name === 'Unknown Token';
    const totalSpent = token.totalSolSpent || 0;
    const totalReceived = token.totalSolReceived || 0;
    const netPnl = token.netSolProfitLoss || 0;
    const transfersIn = token.transferCountIn || 0;
    const transfersOut = token.transferCountOut || 0;
    const totalTransfers = transfersIn + transfersOut;

    // ULTIMATE SCAM PATTERN: Single transaction with zero SOL movement
    // This is the most obvious scam pattern - likely airdrop scams
    if (totalTransfers === 1 && totalSpent === 0 && totalReceived === 0) {
      riskScore += 85; // Very high score for this obvious pattern
      reasons.push('Single transaction with no SOL movement (likely airdrop scam)');
    }

    // High-frequency micro transactions (potential bot/scam activity)
    if (totalTransfers >= 10 && totalSpent < 0.1 && totalReceived < 0.1) {
      riskScore += 60;
      reasons.push('High frequency micro-transactions (potential bot activity)');
    }
    
    // Unknown token metadata (base risk)
    if (isUnknown) {
      riskScore += 25; // Reduced from 30 since we have better indicators now
      reasons.push('Unknown token metadata');
    }

    // DexScreener market data analysis (when available)
    // Note: These fields are ready in the database but need DexScreener service integration
    // TODO: Implement DexScreener API calls to populate marketCapUsd, liquidityUsd, etc.
    
    // Very small market cap (< $10K) indicates potential scam
    // if (token.marketCapUsd && token.marketCapUsd < 10000) {
    //   riskScore += 30;
    //   reasons.push(`Very low market cap ($${token.marketCapUsd.toLocaleString()})`);
    // }
    
    // Very low liquidity (< $1K) makes it hard to sell
    // if (token.liquidityUsd && token.liquidityUsd < 1000) {
    //   riskScore += 25;
    //   reasons.push(`Very low liquidity ($${token.liquidityUsd.toLocaleString()})`);
    // }

    // Honeypot detection: Only spent SOL, never received SOL from selling
    // This indicates potential honeypot where you can buy but not sell
    if (transfersIn > 0 && transfersOut === 0 && totalSpent > 0.01 && totalReceived === 0) {
      riskScore += 45; // Increased importance
      reasons.push('Only buy transactions (potential honeypot)');
    }

    // Failed exit patterns: Multiple attempts to sell with minimal success
    if (transfersOut >= 3 && totalReceived < (totalSpent * 0.1) && totalSpent > 0.05) {
      riskScore += 35;
      reasons.push('Multiple failed exit attempts');
    }

    // Dust attack pattern: Very small amounts with no real trading activity
    if (totalSpent < 0.001 && totalReceived < 0.001 && totalTransfers > 0) {
      riskScore += 30;
      reasons.push('Dust transaction pattern');
    }

    // No social links or web presence for unknown tokens
    if (isUnknown && !token.websiteUrl && !token.twitterUrl && !token.telegramUrl) {
      riskScore += 20; // Increased importance
      reasons.push('No web presence or social links');
    }

    // Very recent token activity (less than 24 hours) with unknown metadata
    const now = Date.now() / 1000;
    if (isUnknown && token.firstTransferTimestamp && (now - token.firstTransferTimestamp) < (24 * 60 * 60)) {
      riskScore += 15;
      reasons.push('Very recent token activity (<24h)');
    }

    // Pump and dump pattern: Quick buy followed by immediate sell attempt
    if (transfersIn === 1 && transfersOut >= 1 && token.firstTransferTimestamp && token.lastTransferTimestamp) {
      const tradingDuration = token.lastTransferTimestamp - token.firstTransferTimestamp;
      if (tradingDuration < 3600 && totalReceived < (totalSpent * 0.5)) { // Less than 1 hour, big loss
        riskScore += 25;
        reasons.push('Rapid trading with significant loss');
      }
    }

    // Cap risk score at 100 to avoid confusion
    riskScore = Math.min(riskScore, 100);

    // Determine risk level - lowered threshold to catch more scams
    let riskLevel: 'safe' | 'high-risk';
    if (riskScore >= 35) { // Lowered from 40 to catch more scams
      riskLevel = 'high-risk';
    } else {
      riskLevel = 'safe';
    }

    const primaryReason = reasons.length > 0 ? reasons[0] : 'Low risk indicators detected';
    return { riskLevel, riskScore, reasons, primaryReason };
  }


} 
