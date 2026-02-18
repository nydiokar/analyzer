import { Controller, Get, Post, Delete, Body, Param, Req, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { WalletHuntService } from '../services/wallet-hunt.service';
import { CreateHuntDto, AddSnapshotDto, HuntListItemDto, HuntDetailDto, AddSnapshotResponseDto } from '../shared/dto/wallet-hunt.dto';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Wallet Hunts')
@Controller('wallet-hunts')
@ApiBearerAuth()
export class WalletHuntController {
  constructor(private readonly walletHuntService: WalletHuntService) {}

  @Get()
  @ApiOperation({ summary: 'List all hunts for the authenticated user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of hunts', type: [HuntListItemDto] })
  async listHunts(@Req() req: AuthenticatedRequest): Promise<HuntListItemDto[]> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    return this.walletHuntService.getHunts(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new wallet hunt' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Hunt created' })
  @HttpCode(HttpStatus.CREATED)
  async createHunt(
    @Body() dto: CreateHuntDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    return this.walletHuntService.createHunt(userId, dto.name);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get hunt detail with snapshots and computed candidates' })
  @ApiParam({ name: 'id', description: 'Hunt ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Hunt detail', type: HuntDetailDto })
  async getHunt(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<HuntDetailDto> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    return this.walletHuntService.getHunt(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a hunt and all its snapshots' })
  @ApiParam({ name: 'id', description: 'Hunt ID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Hunt deleted' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHunt(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    await this.walletHuntService.deleteHunt(id, userId);
  }

  @Post(':id/snapshots')
  @ApiOperation({ summary: 'Add a snapshot to a hunt (captures wallets from token)' })
  @ApiParam({ name: 'id', description: 'Hunt ID' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Snapshot added with updated candidates' })
  @HttpCode(HttpStatus.CREATED)
  async addSnapshot(
    @Param('id') id: string,
    @Body() dto: AddSnapshotDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AddSnapshotResponseDto> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    return this.walletHuntService.addSnapshot(id, userId, dto.tokenMint, dto.sourceType, dto.note);
  }

  @Delete(':id/snapshots/:snapshotId')
  @ApiOperation({ summary: 'Remove a specific snapshot from a hunt' })
  @ApiParam({ name: 'id', description: 'Hunt ID' })
  @ApiParam({ name: 'snapshotId', description: 'Snapshot ID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Snapshot removed' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSnapshot(
    @Param('id') id: string,
    @Param('snapshotId') snapshotId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    await this.walletHuntService.removeSnapshot(id, snapshotId, userId);
  }

  @Post(':id/candidates/:wallet/track')
  @ApiOperation({ summary: 'Save a candidate wallet to tracked wallets (favorites)' })
  @ApiParam({ name: 'id', description: 'Hunt ID' })
  @ApiParam({ name: 'wallet', description: 'Candidate wallet address' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Wallet added to tracked wallets' })
  @HttpCode(HttpStatus.CREATED)
  async trackCandidate(
    @Param('id') id: string,
    @Param('wallet') wallet: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('User not authenticated');
    await this.walletHuntService.trackCandidate(id, userId, wallet);
  }
}
