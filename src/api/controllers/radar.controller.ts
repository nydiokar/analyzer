import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { IsAnalyst } from '../shared/decorators/analyst.decorator';
import { RadarSnapshotService } from '../services/radar-snapshot.service';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { prisma } from '../../core/services/database-service';

class AddRadarWalletDto {
  @IsString()
  address: string;

  @IsOptional()
  @IsString()
  label?: string;
}

class ReviewStatusDto {
  @IsString()
  @IsIn(['unreviewed', 'reviewed', 'ignored'])
  status: string;
}

@Controller('analyst/radar')
@IsAnalyst()
export class RadarController {
  private readonly logger = new Logger(RadarController.name);

  constructor(private readonly radarSnapshotService: RadarSnapshotService) {}

  // GET /analyst/radar — list radar wallets
  @Get()
  async listWallets() {
    return prisma.radarWallet.findMany({
      where: { isActive: true },
      orderBy: { addedAt: 'desc' },
    });
  }

  // POST /analyst/radar — add wallet
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addWallet(@Body(ValidationPipe) dto: AddRadarWalletDto) {
    if (!isValidSolanaAddress(dto.address)) {
      throw new BadRequestException('Invalid Solana address');
    }

    const existing = await prisma.radarWallet.findUnique({ where: { wallet: dto.address } });
    if (existing) {
      if (!existing.isActive) {
        // Reactivate
        return prisma.radarWallet.update({
          where: { wallet: dto.address },
          data: { isActive: true, label: dto.label ?? existing.label },
        });
      }
      return existing;
    }

    return prisma.radarWallet.create({
      data: { wallet: dto.address, label: dto.label ?? null },
    });
  }

  // DELETE /analyst/radar/:address — deactivate wallet
  @Delete(':address')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeWallet(@Param('address') address: string) {
    const existing = await prisma.radarWallet.findUnique({ where: { wallet: address } });
    if (!existing) throw new NotFoundException('Wallet not found on radar');

    await prisma.radarWallet.update({
      where: { wallet: address },
      data: { isActive: false },
    });
  }

  // POST /analyst/radar/:address/snapshot — run snapshot
  @Post(':address/snapshot')
  async runSnapshot(@Param('address') address: string) {
    if (!isValidSolanaAddress(address)) {
      throw new BadRequestException('Invalid Solana address');
    }
    return this.radarSnapshotService.runSnapshot(address);
  }

  // GET /analyst/radar/feed — event feed across all wallets (must be before :address routes)
  @Get('feed')
  async getFeed() {
    return prisma.radarHolding.findMany({
      where: {
        reviewStatus: { not: 'ignored' },
      },
      orderBy: [
        // unreviewed last alphabetically (desc puts "unreviewed" first: u > r > i)
        { reviewStatus: 'desc' },
        { firstSeenAt: 'desc' },
      ],
    });
  }

  // GET /analyst/radar/:address/holdings — current holdings for one wallet
  @Get(':address/holdings')
  async getHoldings(@Param('address') address: string) {
    return prisma.radarHolding.findMany({
      where: { wallet: address, isActiveHolding: true },
      orderBy: { usdValue: 'desc' },
    });
  }

  // PATCH /analyst/radar/holdings/:id/review — update review status
  @Patch('holdings/:id/review')
  async updateReview(@Param('id') id: string, @Body(ValidationPipe) dto: ReviewStatusDto) {
    const existing = await prisma.radarHolding.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Holding not found');

    return prisma.radarHolding.update({
      where: { id },
      data: {
        reviewStatus: dto.status,
        reviewedAt: dto.status !== 'unreviewed' ? new Date() : null,
      },
    });
  }
}
