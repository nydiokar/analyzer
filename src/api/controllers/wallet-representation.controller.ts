import {
  Controller,
  Post,
  Body,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiProperty,
} from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, IsString } from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseService } from '../services/database.service';
import { WalletRepresentationSummary, CohortCoordination } from '../../core/services/database-service';
import { Public } from '../shared/decorators/public.decorator';

class BatchRepresentationRequestDto {
  @ApiProperty({
    description: 'Wallet addresses (representation batch caps at 200; cohort coordination at 300)',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsString({ each: true })
  walletAddresses: string[];
}

/**
 * WalletRepresentationController — dashboard-internal (JWT / API-key) batched
 * read for the SPEC-001/002 representation layer (SURFACE-1).
 *
 * This deliberately lives OFF the credit-gated /intel surface: it is the same
 * public posture as /wallets/hud/batch (dashboard consumers, no per-call credit
 * charge), so it does not touch the /intel contract and never triggers
 * intel:audit:strict. It returns only audit-independent signals — DB-wide
 * behavioral siblings, stored coordination-cluster membership, and a best-effort
 * drift flag — never raw vector dimensions or any per-dimension score.
 */
@ApiTags('Wallet Representation')
@Controller('wallets')
@Public()
export class WalletRepresentationController {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Batched representation signals for a bounded holder page.
   *
   * Single call for up to 200 addresses → one map keyed by address. Every signal
   * is null/absent when a wallet has no vector (zero-swap shell) or no cluster
   * (~99% of wallets); absence is the normal "no representation yet" state, not
   * an error. This is the N+1 guard for the holder-profiles inline chips.
   */
  @Post('representation/batch')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 600000 } })
  @ApiOperation({
    summary: 'Batched representation-layer signals for multiple wallets',
    description:
      'Returns DB-wide behavioral siblings, coordination-cluster membership, and a best-effort drift flag for up to 200 wallets in one call. Signals are absent for wallets with no vector or no cluster — that is the expected default, not an error.',
  })
  @ApiBody({ type: BatchRepresentationRequestDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Representation signals keyed by wallet address' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid request (empty or oversized array)' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  async getRepresentationBatch(
    @Body() body: BatchRepresentationRequestDto,
  ): Promise<{ representations: Record<string, WalletRepresentationSummary>; calculatedAt: string }> {
    const { walletAddresses } = body;
    if (!walletAddresses || walletAddresses.length === 0) {
      return { representations: {}, calculatedAt: new Date().toISOString() };
    }

    const MAX_WALLETS_PER_REQUEST = 200;
    if (walletAddresses.length > MAX_WALLETS_PER_REQUEST) {
      throw new BadRequestException(
        `Too many wallets requested. Maximum ${MAX_WALLETS_PER_REQUEST} per request. Requested: ${walletAddresses.length}`,
      );
    }

    const batch = await this.databaseService.getWalletRepresentationBatch(walletAddresses);
    const representations: Record<string, WalletRepresentationSummary> = {};
    for (const [address, summary] of batch) {
      representations[address] = summary;
    }
    return { representations, calculatedAt: new Date().toISOString() };
  }

  /**
   * Cohort coordination from the persisted engine (SURFACE-1 engine swap).
   *
   * Given a holder cohort, returns the materialized-graph coordination verdict —
   * DB-wide rings that ≥2 cohort members share + the coordination edges internal
   * to the cohort. This is the persisted-engine replacement for the old
   * client-side `analyzeSimilarityGraph` cluster recompute: same question ("who
   * here is coordinated"), stored/materialized answer, higher confidence,
   * DB-wide corroboration, no raw-transaction refetch.
   */
  @Post('representation/cohort')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 600000 } })
  @ApiOperation({
    summary: 'Persisted-engine coordination verdict for a holder cohort',
    description:
      'Returns DB-wide coordination rings that ≥2 of the cohort share, plus materialized coordination edges internal to the cohort. Empty is the normal state — most cohorts have no coordinated members.',
  })
  @ApiBody({ type: BatchRepresentationRequestDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Cohort coordination verdict' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid request (empty or oversized array)' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded' })
  async getCohortCoordination(
    @Body() body: BatchRepresentationRequestDto,
  ): Promise<CohortCoordination & { calculatedAt: string }> {
    const { walletAddresses } = body;
    if (!walletAddresses || walletAddresses.length === 0) {
      return { clusters: [], edges: [], refreshedAt: null, calculatedAt: new Date().toISOString() };
    }

    const MAX_WALLETS_PER_REQUEST = 300;
    if (walletAddresses.length > MAX_WALLETS_PER_REQUEST) {
      throw new BadRequestException(
        `Too many wallets requested. Maximum ${MAX_WALLETS_PER_REQUEST} per request. Requested: ${walletAddresses.length}`,
      );
    }

    const coordination = await this.databaseService.getCohortCoordination(walletAddresses);
    return { ...coordination, calculatedAt: new Date().toISOString() };
  }
}
