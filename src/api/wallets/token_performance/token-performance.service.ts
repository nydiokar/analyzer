import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service'; // Adjusted path
import { AnalysisResult, Prisma } from '@prisma/client';
import { TokenPerformanceQueryDto, SortOrder, TokenPerformanceSortBy } from './token-performance-query.dto'; // Adjusted path if DTO is in the same folder
import { ApiProperty } from '@nestjs/swagger'; // Added for Swagger
import { TokenPerformanceDataDto } from './token-performance-data.dto'; // Import the new DTO

export class PaginatedTokenPerformanceResponse {
  @ApiProperty({ type: () => [TokenPerformanceDataDto], description: 'Array of token performance records' })
  data: TokenPerformanceDataDto[]; // Use the new DTO

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
  constructor(private databaseService: DatabaseService) {} // Inject DatabaseService

  async getPaginatedTokenPerformance(
    walletAddress: string,
    queryDto: TokenPerformanceQueryDto,
  ): Promise<PaginatedTokenPerformanceResponse> {
    const { 
        page = 1, 
        pageSize = 20, 
        sortBy = TokenPerformanceSortBy.NET_SOL_PROFIT_LOSS, 
        sortOrder = SortOrder.DESC 
    } = queryDto;

    // The sortBy from DTO needs to be cast to keyof AnalysisResult for the database service method
    const validSortBy = sortBy as keyof AnalysisResult;
    const validSortOrder = sortOrder.toLowerCase() as Prisma.SortOrder;

    const { data, total } = await this.databaseService.getPaginatedAnalysisResults(
      walletAddress,
      page,
      pageSize,
      validSortBy,
      validSortOrder,
    );

    // Prisma's AnalysisResult[] should be structurally compatible with TokenPerformanceDataDto[]
    // if TokenPerformanceDataDto mirrors its fields (excluding id, which is fine for a DTO).
    // Explicit mapping could be done here if transformations were needed.
    return {
      data: data as TokenPerformanceDataDto[], // Cast to ensure type alignment for the response
      total: total,
      page: page,
      pageSize: pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
} 