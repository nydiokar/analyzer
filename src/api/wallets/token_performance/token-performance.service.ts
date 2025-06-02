import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Prisma, AnalysisResult as PrismaAnalysisResult } from '@prisma/client';
import { TokenPerformanceQueryDto, SortOrder, TokenPerformanceSortBy } from './token-performance-query.dto';
import { ApiProperty } from '@nestjs/swagger';
import { TokenPerformanceDataDto } from './token-performance-data.dto';

interface SwapInputTimeRange {
    startTs?: number;
    endTs?: number;
}

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
export class TokenPerformanceService {
  private readonly logger = new Logger(TokenPerformanceService.name);

  constructor(
    private databaseService: DatabaseService,
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
    } = queryDto;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.AnalysisResultWhereInput = {
      walletAddress: walletAddress,
    };

    if (showOnlyHoldings) { // Use the destructured variable
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

    const orderBy: Prisma.AnalysisResultOrderByWithRelationInput = {};
    // Map DTO sortBy to Prisma field names if they differ, or use directly if same
    // Assuming TokenPerformanceSortBy enum values match Prisma AnalysisResult field names for simplicity here.
    // If not, a mapping object would be needed.
    orderBy[sortBy] = sortOrder.toLowerCase() as Prisma.SortOrder;


    const analysisResults: PrismaAnalysisResult[] = await this.databaseService.getAnalysisResults({
        where,
        orderBy,
        skip,
        take,
    });
    
    const totalResults = await this.databaseService.countAnalysisResults({ where });

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

    const tokenPerformanceDataList: TokenPerformanceDataDto[] = analysisResults.map(ar => ({
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
      // Map new balance fields
      currentRawBalance: ar.currentRawBalance,
      currentUiBalance: ar.currentUiBalance,
      currentUiBalanceString: ar.currentUiBalanceString,
      balanceDecimals: ar.balanceDecimals,
      balanceFetchedAt: ar.balanceFetchedAt ? ar.balanceFetchedAt.toISOString() : null,
    }));
    
    this.logger.debug(`Pagination: page=${page}, pageSize=${pageSize}, total=${totalResults}, returning ${tokenPerformanceDataList.length} items.`);

    return {
      data: tokenPerformanceDataList,
      total: totalResults,
      page: page,
      pageSize: pageSize,
      totalPages: Math.ceil(totalResults / pageSize),
    };
  }
} 