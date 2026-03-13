import {
  Controller,
  Get,
  Query,
  BadRequestException,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SigBuyersService } from '../services/sig-buyers.service';
import { SigBuyersQueryDto, SigBuyersResponseDto } from '../shared/dto/sig-buyers.dto';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';

@ApiTags('Significant Buyers')
@Controller('sig-buyers')
@ApiBearerAuth()
export class SigBuyersController {
  private readonly logger = new Logger(SigBuyersController.name);

  constructor(private readonly sigBuyersService: SigBuyersService) {}

  @Get()
  @ApiOperation({ summary: 'Find significant buyers for a token within a time window' })
  @ApiResponse({ status: 200, description: 'List of wallets ranked by SOL spent' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async findBuyers(@Query() query: SigBuyersQueryDto): Promise<SigBuyersResponseDto> {
    if (!isValidSolanaAddress(query.mint)) {
      throw new BadRequestException('Invalid token mint address');
    }
    if (query.endTime <= query.startTime) {
      throw new BadRequestException('endTime must be greater than startTime');
    }
    const windowSeconds = query.endTime - query.startTime;
    if (windowSeconds > 86400) {
      throw new BadRequestException('Time window cannot exceed 24 hours');
    }

    this.logger.log(
      `sig-buyers: mint=${query.mint} window=${new Date(query.startTime * 1000).toISOString()}–${new Date(query.endTime * 1000).toISOString()} minSol=${query.minSolSpent ?? 0.5}`,
    );

    return this.sigBuyersService.findSignificantBuyers(
      query.mint,
      query.startTime,
      query.endTime,
      query.minSolSpent ?? 0.5,
      query.maxTransactions ?? 10000,
    );
  }
}
