import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Prisma, SwapAnalysisInput } from '@prisma/client';
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
    this.logger.debug(`Getting paginated token performance for ${walletAddress} with DTO: ${JSON.stringify(queryDto)}`);
    const {
        page = 1,
        pageSize = 20,
        sortBy = TokenPerformanceSortBy.NET_SOL_PROFIT_LOSS,
        sortOrder = SortOrder.DESC,
        startDate, // ISO Date String
        endDate,   // ISO Date String
    } = queryDto;

    const timeRange: SwapInputTimeRange = {};
    if (startDate) {
      timeRange.startTs = Math.floor(new Date(startDate).getTime() / 1000);
    }
    if (endDate) {
      timeRange.endTs = Math.floor(new Date(endDate).getTime() / 1000);
    }

    // Use the existing DatabaseService method
    const swapInputs: SwapAnalysisInput[] = await this.databaseService.getSwapAnalysisInputs(
      walletAddress,
      (timeRange.startTs || timeRange.endTs) ? timeRange : undefined // Pass undefined if no time filter
    );
    
    // Order by timestamp client-side if service doesn't guarantee it (though it should for PNL)
    // The getSwapAnalysisInputs from schema examination seems to do `orderBy: { timestamp: 'asc' }`
    // so this client-side sort might be redundant but harmless.
    swapInputs.sort((a, b) => a.timestamp - b.timestamp);

    if (swapInputs.length === 0) {
      this.logger.debug('No swap inputs found for the given criteria.');
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      };
    }

    // STEP 1: Group swaps by tokenAddress (mint)
    const swapsByToken = swapInputs.reduce((acc, swap) => {
      const tokenMint = swap.mint;
      if (!acc[tokenMint]) {
        acc[tokenMint] = [];
      }
      acc[tokenMint].push(swap);
      return acc;
    }, {} as Record<string, SwapAnalysisInput[]>);

    this.logger.debug(`Grouped ${swapInputs.length} swaps into ${Object.keys(swapsByToken).length} tokens.`);

    // STEP 2: Calculate performance for each token
    let tokenPerformanceDataList: TokenPerformanceDataDto[] = Object.entries(swapsByToken).map(([tokenMint, tokenSwaps]) => {
        let totalSolSpentForToken = 0;
        let totalSolReceivedForToken = 0;
        let totalTokenAmountIn = 0;
        let totalTokenAmountOut = 0;
        let transferCountInForToken = 0;
        let transferCountOutForToken = 0;
        let firstTs: number | undefined = undefined;
        let lastTs: number | undefined = undefined;
        let totalFeesPaidInSolForToken = 0;

        tokenSwaps.forEach(swap => {
          if (firstTs === undefined || swap.timestamp < firstTs) {
            firstTs = swap.timestamp;
          }
          if (lastTs === undefined || swap.timestamp > lastTs) {
            lastTs = swap.timestamp;
          }

          if (swap.feeAmount) {
            totalFeesPaidInSolForToken += swap.feeAmount;
          }

          if (swap.direction === 'in') {
            totalTokenAmountIn += swap.amount;
            transferCountInForToken++;
            totalSolSpentForToken += swap.associatedSolValue;
          } else if (swap.direction === 'out') {
            totalTokenAmountOut += swap.amount;
            transferCountOutForToken++;
            totalSolReceivedForToken += swap.associatedSolValue;
          }
        });

        const netTokenAmountChange = totalTokenAmountIn - totalTokenAmountOut;
        const fees = totalFeesPaidInSolForToken || 0;
        const netSolProfitLossForToken = totalSolReceivedForToken - totalSolSpentForToken - fees;

        return {
          walletAddress: walletAddress,
          tokenAddress: tokenMint,
          totalAmountIn: totalTokenAmountIn,
          totalAmountOut: totalTokenAmountOut,
          netAmountChange: netTokenAmountChange,
          totalSolSpent: totalSolSpentForToken,
          totalSolReceived: totalSolReceivedForToken,
          totalFeesPaidInSol: totalFeesPaidInSolForToken,
          netSolProfitLoss: netSolProfitLossForToken,
          transferCountIn: transferCountInForToken,
          transferCountOut: transferCountOutForToken,
          firstTransferTimestamp: firstTs,
          lastTransferTimestamp: lastTs,
        };
      });
    
    this.logger.debug(`Calculated performance for ${tokenPerformanceDataList.length} tokens.`);

    // STEP 3: Sort the calculated data
    tokenPerformanceDataList.sort((a, b) => {
      // Make sure sortBy is a valid key of TokenPerformanceDataDto
      const key = sortBy as keyof TokenPerformanceDataDto;
      
      let valA = a[key];
      let valB = b[key];

      // Handle undefined for optional fields like timestamps
      if (valA === undefined || valA === null) valA = 0; // or handle as per desired sort order for undefined
      if (valB === undefined || valB === null) valB = 0;


      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === SortOrder.ASC ? valA - valB : valB - valA;
      }
      // Add string comparison if any sortable fields are strings
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === SortOrder.ASC ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return 0; // Default no change if types are mixed or not comparable
    });

    this.logger.debug(`Sorted token performance data by ${sortBy} ${sortOrder}.`);

    // STEP 4: Paginate the sorted data
    const totalResults = tokenPerformanceDataList.length;
    const paginatedData = tokenPerformanceDataList.slice((page - 1) * pageSize, page * pageSize);

    this.logger.debug(`Pagination: page=${page}, pageSize=${pageSize}, total=${totalResults}, returning ${paginatedData.length} items.`);

    return {
      data: paginatedData,
      total: totalResults,
      page: page,
      pageSize: pageSize,
      totalPages: Math.ceil(totalResults / pageSize),
    };
  }
} 