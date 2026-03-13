import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Logger,
  UsePipes,
  ValidationPipe,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SigBuyersQueryDto } from '../shared/dto/sig-buyers.dto';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import * as crypto from 'crypto';

@ApiTags('Significant Buyers')
@Controller('sig-buyers')
@ApiBearerAuth()
export class SigBuyersController {
  private readonly logger = new Logger(SigBuyersController.name);

  constructor(private readonly analysisQueue: AnalysisOperationsQueue) {}

  @Post()
  @ApiOperation({ summary: 'Queue a significant buyers job and return jobId' })
  @ApiResponse({ status: 201, description: 'Job queued — poll via WebSocket or GET /jobs/:id' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async queueBuyers(@Body() body: SigBuyersQueryDto, @Request() req: any): Promise<{ jobId: string }> {
    if (!isValidSolanaAddress(body.mint)) {
      throw new BadRequestException('Invalid token mint address');
    }
    if (body.endTime <= body.startTime) {
      throw new BadRequestException('endTime must be greater than startTime');
    }
    if (body.endTime - body.startTime > 86400) {
      throw new BadRequestException('Time window cannot exceed 24 hours');
    }

    const requestId = crypto.randomBytes(8).toString('hex');
    const userId: string | undefined = req?.user?.id;

    this.logger.log(
      `sig-buyers queue: mint=${body.mint} window=${new Date(body.startTime * 1000).toISOString()}–${new Date(body.endTime * 1000).toISOString()} minSol=${body.minSolSpent ?? 0.5} user=${userId ?? 'anon'}`,
    );

    const job = await this.analysisQueue.addSigBuyersJob({
      mint: body.mint,
      startTime: body.startTime,
      endTime: body.endTime,
      minSolSpent: body.minSolSpent ?? 0.5,
      maxTransactions: body.maxTransactions ?? 10000,
      userId,
      requestId,
    });

    return { jobId: job.id as string };
  }
}
