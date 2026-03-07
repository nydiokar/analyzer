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
  private readonly MIN_MEANINGFUL_SOL = 0.01;

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
        tokenAddresses: tokenAddressesFilter, // NEW: Filter by specific token addresses (renamed to avoid conflict)
    } = queryDto;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.AnalysisResultWhereInput = {
      walletAddress: walletAddress,
    };
    const andFilters: Prisma.AnalysisResultWhereInput[] = [];
    const addAndFilter = (filter: Prisma.AnalysisResultWhereInput) => {
      andFilters.push(filter);
    };

    // Default exclusion: stablecoins and wrapped/native tokens
    addAndFilter({ tokenAddress: { notIn: DEFAULT_EXCLUDED_MINTS } });

    if (showOnlyHoldings) { // Use the destructured variable
      // Only show meaningful holdings (not dust)
      // This will be further filtered post-processing to ensure positions are worth > $1 USD or have meaningful token amounts
      addAndFilter({ currentUiBalance: { gt: 0 } });
    }

    // Filter by specific token addresses if provided
    if (tokenAddressesFilter) {
      const addressArray = tokenAddressesFilter.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
      if (addressArray.length > 0) {
        addAndFilter({ tokenAddress: { in: addressArray } });
      }
    }

    // Add search term filtering (only if tokenAddressesFilter not provided, as they conflict)
    if (searchTerm && !tokenAddressesFilter) {
      const searchFilter: Prisma.AnalysisResultWhereInput = {
        tokenAddress: {
          contains: searchTerm,
          // mode: 'insensitive', // Removed earlier, ensure DB collation handles case-insensitivity if needed
        },
      };
      addAndFilter(searchFilter);
    }

    // Apply PNL condition
    if (pnlConditionOperator && typeof pnlConditionValue === 'number') {
      const op = pnlConditionOperator.toLowerCase();
      if (op === 'gt' || op === 'lt' || op === 'gte' || op === 'lte') {
        where.totalPnlSol = { [op]: pnlConditionValue } as Prisma.FloatFilter;
      } else if (op === 'eq') { // DTO enum uses 'eq', Prisma uses 'equals' for numbers
        where.totalPnlSol = { equals: pnlConditionValue } as Prisma.FloatFilter;
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

        addAndFilter(minTradesCondition);
      } else {
        // For other minTrades values, if a simpler sum isn't directly possible, this might need raw SQL
        // or a broader interpretation e.g. (transferCountIn >= minTrades OR transferCountOut >= minTrades)
        // For now, only minTrades = 2 is explicitly handled with the sum logic.
        this.logger.warn(`Min trades filter currently only implements specific logic for value 2. Received: ${minTrades}`);
      }
    }

    // Exclude noise tokens with zero activity and no meaningful holdings.
    const meaningfulActivityFilter: Prisma.AnalysisResultWhereInput = {
      OR: [
        { totalSolSpent: { gte: this.MIN_MEANINGFUL_SOL } },
        { totalSolReceived: { gte: this.MIN_MEANINGFUL_SOL } },
        { realizedPnlSol: { gte: this.MIN_MEANINGFUL_SOL } },
        { realizedPnlSol: { lte: -this.MIN_MEANINGFUL_SOL } },
        { unrealizedPnlSol: { gte: this.MIN_MEANINGFUL_SOL } },
        { unrealizedPnlSol: { lte: -this.MIN_MEANINGFUL_SOL } },
        { totalPnlSol: { gte: this.MIN_MEANINGFUL_SOL } },
        { totalPnlSol: { lte: -this.MIN_MEANINGFUL_SOL } },
        { currentHoldingsValueSol: { gte: this.MIN_MEANINGFUL_SOL } },
      ],
    };
    addAndFilter(meaningfulActivityFilter);

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    // CHANGED: Store time filter separately instead of applying to WHERE clause
    // This ensures all tokens (including current holdings) are fetched regardless of time filter
    // Time filter will be used post-query to mark which tokens had activity in the period
    const hasTimeFilter = !!(startDate || endDate);
    const timeFilterStart = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : undefined;
    const timeFilterEnd = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : undefined;

    // DO NOT apply time filter to WHERE clause - we want to fetch ALL tokens
    // including current holdings that may not have traded in the filtered period

    // Handle calculated fields that need post-processing
    const orderBy: Prisma.AnalysisResultOrderByWithRelationInput = {};
    let needsPostSorting = false;
    let needsPostFiltering = false;
    
    // These fields are calculated after data fetch, so they need post-processing
    const calculatedFields = ['roi', 'totalPnlSol', 'realizedPnlSol', 'unrealizedPnlSol', 'currentSolValue'];
    
    if (calculatedFields.includes(sortBy)) {
      // For calculated fields, we'll sort by a related field for now and apply post-processing
      if (sortBy === 'roi' || sortBy === 'totalPnlSol' || sortBy === 'realizedPnlSol') {
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
      const rawTotalAmountIn = ar.totalAmountIn || 0;
      const rawTotalAmountOut = ar.totalAmountOut || 0;
      const totalAmountIn = Math.abs(rawTotalAmountIn);
      const totalAmountOut = Math.abs(rawTotalAmountOut);
      const netAmountChange = totalAmountIn - totalAmountOut;
      const dbCurrentUiBalance = ar.currentUiBalance;
      const derivedBalanceFromNetAmount = (dbCurrentUiBalance === null || dbCurrentUiBalance === undefined) && netAmountChange > 0
        ? netAmountChange
        : null;
      
      const currentUiBalance = derivedBalanceFromNetAmount ?? (dbCurrentUiBalance || 0);
      const hasCurrentHoldings = currentUiBalance > 0;
      const effectiveCurrentUiBalanceString = ar.currentUiBalanceString ?? (derivedBalanceFromNetAmount !== null ? derivedBalanceFromNetAmount.toString() : null);
      const priceUsd = tokenInfo?.priceUsd ? parseFloat(tokenInfo.priceUsd) : null;
      const totalSolSpent = ar.totalSolSpent || 0;
      const realizedPnlSolFromDb = ar.realizedPnlSol ?? null;
      const totalPnlSolFromDb = ar.totalPnlSol ?? null;
      const hasIncompleteHistory = ar.hasIncompleteHistory ?? false;
      const fifoHoldingsCostBasisSol = ar.currentHoldingsCostBasisSol ?? null;
      
      let currentHoldingsValueUsd: number | null = null;
      let currentHoldingsValueSol: number | null = null;
      let unrealizedPnlUsd: number | null = null;
      let unrealizedPnlSol: number | null = null;
      let totalPnlSol: number | null = null;
      let realizedPnlSol: number | null = null;
      let realizedPnlPercentage: number | null = null;
      let unrealizedPnlPercentage: number | null = null;
      
      // Get basic data for calculations
      
      const solReceivedFromSales = ar.totalSolReceived || 0;
      const feesPaid = ar.totalFeesPaidInSol || 0;
      // estimatedSolPriceUsd is already fetched from outer scope
      if (hasCurrentHoldings && priceUsd && priceUsd > 0) {
        // We have current holdings AND price data - can calculate full P&L
        currentHoldingsValueUsd = currentUiBalance * priceUsd;
        currentHoldingsValueSol = currentHoldingsValueUsd / estimatedSolPriceUsd;

        // Exclude stablecoins and wrapped tokens from PnL display
        if (DEFAULT_EXCLUDED_MINTS.includes(ar.tokenAddress)) {
          currentHoldingsValueUsd = null;
          currentHoldingsValueSol = null;
        }

        realizedPnlSol = realizedPnlSolFromDb;

        if (currentHoldingsValueSol !== null && currentHoldingsValueUsd !== null && fifoHoldingsCostBasisSol !== null) {
          unrealizedPnlUsd = currentHoldingsValueUsd - (fifoHoldingsCostBasisSol * estimatedSolPriceUsd);
          unrealizedPnlSol = currentHoldingsValueSol - fifoHoldingsCostBasisSol;

        const realizedPnlExcludingFees = realizedPnlSol !== null ? realizedPnlSol + feesPaid : null;
        realizedPnlPercentage = totalSolSpent > 0 && realizedPnlExcludingFees !== null
          ? (realizedPnlExcludingFees / totalSolSpent) * 100
          : null;
          unrealizedPnlPercentage = fifoHoldingsCostBasisSol > 0 ? (unrealizedPnlSol / fifoHoldingsCostBasisSol) * 100 : null;

          totalPnlSol = (realizedPnlSol ?? 0) + (unrealizedPnlSol ?? 0);
        } else {
          realizedPnlPercentage = totalSolSpent > 0 ? (realizedPnlSol ?? 0) / totalSolSpent * 100 : null;
          totalPnlSol = realizedPnlSol;
        }

             } else if (hasCurrentHoldings) {
         // We have holdings but no price data - can't calculate unrealized P&L
         // Show realized P&L only and mark total as incomplete

         realizedPnlSol = realizedPnlSolFromDb;

        const realizedPnlExcludingFees = realizedPnlSol !== null ? realizedPnlSol + feesPaid : null;
        realizedPnlPercentage = totalSolSpent > 0 && realizedPnlExcludingFees !== null
          ? (realizedPnlExcludingFees / totalSolSpent) * 100
          : null;

        // Can't calculate unrealized without price data
        unrealizedPnlUsd = null;
        unrealizedPnlSol = null;
        unrealizedPnlPercentage = null;

        // Total P&L is incomplete without unrealized component
        totalPnlSol = realizedPnlSol;

      } else {
        // No current holdings - everything is realized
        realizedPnlSol = realizedPnlSolFromDb;
        const realizedPnlExcludingFees = realizedPnlSol !== null ? realizedPnlSol + feesPaid : null;
        realizedPnlPercentage = totalSolSpent > 0 && realizedPnlExcludingFees !== null
          ? (realizedPnlExcludingFees / totalSolSpent) * 100
          : null;

        totalPnlSol = realizedPnlSol;
        unrealizedPnlUsd = null;
        unrealizedPnlSol = null;
        unrealizedPnlPercentage = null;
      }

      // Determine if token had activity in the filtered time period
      let hasActivityInPeriod: boolean | null = null;
      if (hasTimeFilter) {
        const lastTransferTs = ar.lastTransferTimestamp;
        const firstTransferTs = ar.firstTransferTimestamp;

        if (lastTransferTs !== null && lastTransferTs !== undefined) {
          // Check if any activity falls within the time range
          const isAfterStart = timeFilterStart === undefined || lastTransferTs >= timeFilterStart;
          const isBeforeEnd = timeFilterEnd === undefined || (firstTransferTs !== null && firstTransferTs !== undefined ? firstTransferTs <= timeFilterEnd : lastTransferTs <= timeFilterEnd);
          hasActivityInPeriod = isAfterStart && isBeforeEnd;
        } else {
          hasActivityInPeriod = false; // No timestamp means no activity
        }
      } else {
        // No time filter applied - mark as true if token has any transactions
        hasActivityInPeriod = (ar.transferCountIn || 0) + (ar.transferCountOut || 0) > 0;
      }

      const tokenData: TokenPerformanceDataDto = {
        walletAddress: ar.walletAddress,
        tokenAddress: ar.tokenAddress,
        totalAmountIn: totalAmountIn,
        totalAmountOut: totalAmountOut,
        netAmountChange: netAmountChange,
        totalSolSpent: ar.totalSolSpent,
        totalSolReceived: ar.totalSolReceived,
        totalFeesPaidInSol: ar.totalFeesPaidInSol,
        netSolProfitLoss: ar.netSolProfitLoss,
        hasIncompleteHistory,
        transferCountIn: ar.transferCountIn,
        transferCountOut: ar.transferCountOut,
        firstTransferTimestamp: ar.firstTransferTimestamp,
        lastTransferTimestamp: ar.lastTransferTimestamp,
        hasActivityInPeriod: hasActivityInPeriod,
        currentRawBalance: ar.currentRawBalance,
        currentUiBalance: hasCurrentHoldings ? currentUiBalance : ar.currentUiBalance,
        currentUiBalanceString: effectiveCurrentUiBalanceString,
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
        totalPnlSol: totalPnlSol ?? totalPnlSolFromDb,
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
        const hasName = !!(token.name && token.name !== 'Unknown Token') || !!token.onchainName;
        const hasSymbol = !!(token.symbol && token.symbol !== 'Unknown Token') || !!token.onchainSymbol;
        const isUnknown = !hasName || !hasSymbol;

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
      const compareNullable = (valueA: number | null | undefined, valueB: number | null | undefined) => {
        const aNull = valueA === null || valueA === undefined || Number.isNaN(valueA);
        const bNull = valueB === null || valueB === undefined || Number.isNaN(valueB);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        return sortOrder === SortOrder.DESC ? (valueB as number) - (valueA as number) : (valueA as number) - (valueB as number);
      };

      tokenPerformanceDataList.sort((a, b) => {
        let valueA: number | null = null;
        let valueB: number | null = null;
        
        switch (sortBy) {
          case 'roi': {
            if (a.totalPnlSol === null || a.totalPnlSol === undefined) {
              valueA = null;
            } else if (a.totalSolSpent && a.totalSolSpent !== 0) {
              valueA = (a.totalPnlSol / a.totalSolSpent) * 100;
            } else {
              valueA = a.totalPnlSol > 0 ? Infinity : a.totalPnlSol < 0 ? -Infinity : 0;
            }

            if (b.totalPnlSol === null || b.totalPnlSol === undefined) {
              valueB = null;
            } else if (b.totalSolSpent && b.totalSolSpent !== 0) {
              valueB = (b.totalPnlSol / b.totalSolSpent) * 100;
            } else {
              valueB = b.totalPnlSol > 0 ? Infinity : b.totalPnlSol < 0 ? -Infinity : 0;
            }
            break;
          }
          case 'totalPnlSol':
            valueA = a.totalPnlSol ?? null;
            valueB = b.totalPnlSol ?? null;
            break;
          case 'realizedPnlSol':
            valueA = a.realizedPnlSol ?? null;
            valueB = b.realizedPnlSol ?? null;
            break;
          case 'unrealizedPnlSol':
            valueA = a.unrealizedPnlSol ?? null;
            valueB = b.unrealizedPnlSol ?? null;
            break;
          case 'currentSolValue':
            valueA = a.currentHoldingsValueUsd !== null && a.currentHoldingsValueUsd !== undefined
              ? a.currentHoldingsValueUsd / estimatedSolPriceUsd
              : null;
            valueB = b.currentHoldingsValueUsd !== null && b.currentHoldingsValueUsd !== undefined
              ? b.currentHoldingsValueUsd / estimatedSolPriceUsd
              : null;
            break;
          default:
            valueA = 0;
            valueB = 0;
        }
        
        return compareNullable(valueA, valueB);
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
    const meaningfulActivityFilter: Prisma.AnalysisResultWhereInput = {
      OR: [
        { totalSolSpent: { gte: this.MIN_MEANINGFUL_SOL } },
        { totalSolReceived: { gte: this.MIN_MEANINGFUL_SOL } },
        { realizedPnlSol: { gte: this.MIN_MEANINGFUL_SOL } },
        { realizedPnlSol: { lte: -this.MIN_MEANINGFUL_SOL } },
        { unrealizedPnlSol: { gte: this.MIN_MEANINGFUL_SOL } },
        { unrealizedPnlSol: { lte: -this.MIN_MEANINGFUL_SOL } },
        { totalPnlSol: { gte: this.MIN_MEANINGFUL_SOL } },
        { totalPnlSol: { lte: -this.MIN_MEANINGFUL_SOL } },
        { currentHoldingsValueSol: { gte: this.MIN_MEANINGFUL_SOL } },
      ],
    };
    const analysisResults = await this.databaseService.getAnalysisResults({
      where: {
        walletAddress,
        AND: [
          { tokenAddress: { notIn: DEFAULT_EXCLUDED_MINTS } },
          meaningfulActivityFilter,
        ],
      },
    });

    if (analysisResults.length === 0) {
      this.logger.debug(`No AnalysisResult records found for wallet ${walletAddress}.`);
      return [];
    }

    const tokenAddresses = analysisResults.map(ar => ar.tokenAddress);
    const tokenInfoMap = await this.getTokenInfoMap(tokenAddresses);

    const tokenPerformanceDataList: TokenPerformanceDataDto[] = analysisResults.map(ar => {
      const tokenInfo = tokenInfoMap.get(ar.tokenAddress);

      // No time filter in this method - mark all tokens as having activity
      const hasActivityInPeriod = (ar.transferCountIn || 0) + (ar.transferCountOut || 0) > 0;

      const fallbackMetadata = getWellKnownTokenMetadata(ar.tokenAddress);
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
        hasActivityInPeriod: hasActivityInPeriod,
        currentRawBalance: ar.currentRawBalance,
        currentUiBalance: ar.currentUiBalance,
        currentUiBalanceString: ar.currentUiBalanceString,
        balanceDecimals: ar.balanceDecimals,
        balanceFetchedAt: ar.balanceFetchedAt ? ar.balanceFetchedAt.toISOString() : null,
        name: tokenInfo?.name || fallbackMetadata?.name,
        symbol: tokenInfo?.symbol || fallbackMetadata?.symbol,
        imageUrl: tokenInfo?.imageUrl,
        websiteUrl: tokenInfo?.websiteUrl,
        twitterUrl: tokenInfo?.twitterUrl,
        telegramUrl: tokenInfo?.telegramUrl,
        onchainName: tokenInfo?.onchainName,
        onchainSymbol: tokenInfo?.onchainSymbol,
        onchainImageUrl: tokenInfo?.onchainImageUrl,
        onchainWebsiteUrl: tokenInfo?.onchainWebsiteUrl,
        onchainTwitterUrl: tokenInfo?.onchainTwitterUrl,
        onchainTelegramUrl: tokenInfo?.onchainTelegramUrl,
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
    const hasName = !!(token.name && token.name !== 'Unknown Token') || !!token.onchainName;
    const hasSymbol = !!(token.symbol && token.symbol !== 'Unknown Token') || !!token.onchainSymbol;
    const isUnknown = !hasName || !hasSymbol;
    const totalSpent = token.totalSolSpent || 0;
    const totalReceived = token.totalSolReceived || 0;
    const netPnl = token.totalPnlSol ?? token.netSolProfitLoss ?? 0;
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
