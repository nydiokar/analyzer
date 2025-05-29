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
    } = queryDto;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.AnalysisResultWhereInput = {
      walletAddress: walletAddress,
    };

    if (queryDto.showOnlyHoldings) {
      where.currentUiBalance = { gt: 0 };
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