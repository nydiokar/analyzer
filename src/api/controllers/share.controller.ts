import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  BadRequestException,
  NotFoundException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { Public } from '../shared/decorators/public.decorator';
import { HolderProfileShareService } from '../services/holder-profile-share.service';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { CreateHolderProfileShareDto } from './dto/create-holder-profile-share.dto';

@ApiTags('Share')
@Controller('share')
@UseGuards(CompositeAuthGuard)
export class ShareController {
  constructor(private readonly shareService: HolderProfileShareService) {}

  /**
   * POST /api/v1/share/hp
   * Auth required. Freezes a specific persisted holder-profiles snapshot run for public sharing.
   */
  @Post('hp')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create a shareable holder-profiles link',
    description:
      'Creates a frozen public share from a specific persisted holder-profiles snapshot run (jobId). Returns shareId and public URL.',
  })
  @ApiBody({ type: CreateHolderProfileShareDto })
  @ApiResponse({ status: 201, description: 'Share created — { shareId, url }' })
  @ApiResponse({ status: 400, description: 'Invalid mint address' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Snapshot run not found' })
  async createShare(
    @Req() req: Request & { user: User },
    @Body() body: CreateHolderProfileShareDto,
  ) {
    if (!isValidSolanaAddress(body.tokenMint)) {
      throw new BadRequestException(`Invalid token mint address: ${body.tokenMint}`);
    }
    return this.shareService.createShare({
      tokenMint: body.tokenMint,
      jobId: body.jobId,
      userId: req.user.id,
      similaritySnapshot: body.similaritySnapshot,
    });
  }

  /**
   * GET /api/v1/share/hp/:id
   * Public — no auth required. Returns the frozen snapshot JSON and increments view count.
   */
  @Get('hp/:id')
  @Public()
  @ApiOperation({
    summary: 'Fetch a shared holder-profiles snapshot (public)',
    description: 'Returns the frozen snapshot for the given shareId. No authentication required. Increments view count.',
  })
  @ApiParam({ name: 'id', description: 'Share ID (cuid)' })
  @ApiResponse({ status: 200, description: 'Share record with snapshot JSON' })
  @ApiResponse({ status: 404, description: 'Share not found or expired' })
  async getShare(@Param('id') id: string) {
    return this.shareService.getShare(id);
  }

  /**
   * GET /api/v1/share/hp/:id/raw
   * Public — no auth required. Returns the snapshot without incrementing view count.
   * Intended for server-side rendering (OG images, metadata) to avoid polluting analytics.
   */
  @Get('hp/:id/raw')
  @Public()
  @ApiOperation({
    summary: 'Fetch a shared holder-profiles snapshot without incrementing view count',
    description: 'Used by OG image and SSR metadata paths. Does not count as a view.',
  })
  @ApiParam({ name: 'id', description: 'Share ID (cuid)' })
  @ApiResponse({ status: 200, description: 'Share record with snapshot JSON' })
  @ApiResponse({ status: 404, description: 'Share not found or expired' })
  async getShareRaw(@Param('id') id: string) {
    const record = await this.shareService.getShareRaw(id);
    if (!record) {
      throw new NotFoundException(`Share not found: ${id}`);
    }
    return record;
  }
}
