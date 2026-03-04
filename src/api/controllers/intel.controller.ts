import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  Param,
  Query,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  HttpException,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { IsArray, IsString, ArrayMaxSize, ArrayMinSize, IsOptional, IsInt, Min, Max } from 'class-validator';

import { RequireCredits } from '../shared/decorators/require-credits.decorator';
import { WalletHudService } from '../services/wallet-hud.service';
import { DatabaseService } from '../services/database.service';
import { BehaviorService } from '../services/behavior.service';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { TokenPerformanceService } from '../services/token-performance.service';
import { TokenPerformanceQueryDto } from '../shared/dto/token-performance-query.dto';
import { BatchWalletHudResponseDto } from '../shared/dto/wallet-hud.dto';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { RedisLockService } from '../../queues/services/redis-lock.service';
import {
  AnalyzeHolderProfilesJobData,
  ComprehensiveSimilarityFlowData,
  DashboardWalletAnalysisJobData,
} from '../../queues/jobs/types';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG, WALLET_CLASSIFICATIONS } from '../../config/constants';
import { JobPriority } from '../../queues/config/queue.config';
import { getKnownWallet } from '../../config/known-wallets';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';

class BatchHudRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  wallets: string[];
}

class IntelTokenHoldersRequestDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topN?: number;
}

class IntelWalletSimilarityRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  wallets: string[];
}

class IntelTokenHoldersDeepRequestDto extends IntelTokenHoldersRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  wallets: string[];
}

/**
 * IntelController — external product API for developers and agents.
 *
 * Design principles:
 * - Static @RequireCredits on every endpoint → X402 works automatically
 * - Thin orchestration only — all business logic lives in existing services
 * - Same service calls as /wallets/* and /analyses/* — zero logic duplication
 * - Stable contracts: these paths are public-facing; don't rename them
 * - We are responsible for delivery: if data is missing we queue it and
 *   return a jobId. The agent pays once — on the call that delivers data.
 *
 * Credit charging contract (CreditInterceptor fires on handler `return`, skips on `throw`):
 * - status "ok"     → 200  → handler returns    → interceptor fires → Ncr deducted  ✓ data delivered
 * - status "queued" → 202  → throw HttpException → interceptor skips → 0cr           ✓ GET endpoints: pay on delivery
 * - status "queued" → 202  → handler returns    → interceptor fires → Ncr deducted  ✓ POST endpoints: pay on acceptance
 * - status "skipped"→ 422  → throw HttpException → interceptor skips → 0cr           ✓ known wallet, nothing to do
 * - invalid address → 400  → throw BadRequest   → interceptor skips → 0cr           ✓ guard or handler rejects
 *
 * GET /intel/wallet/:addr "pay on delivery": agent is NOT charged for queuing a flash analysis.
 * They call again after the job completes, get a 200, and pay then. One charge per data delivery.
 */
@ApiTags('Intel')
@Controller('intel')
export class IntelController {
  private readonly logger = new Logger(IntelController.name);

  constructor(
    private readonly walletHudService: WalletHudService,
    private readonly databaseService: DatabaseService,
    private readonly behaviorService: BehaviorService,
    private readonly pnlOverviewService: PnlOverviewService,
    private readonly tokenPerformanceService: TokenPerformanceService,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly redisLockService: RedisLockService,
  ) {}

  /**
   * GET /intel/wallet/:addr
   * 5 credits — aggregated wallet intel (summary + HUD + behavior + PnL).
   *
   * If data exists in DB: returns it immediately (status: "ok", HTTP 200).
   * If missing/not analyzed: auto-queues flash analysis (status: "queued", HTTP 202).
   *   → Poll GET /api/v1/jobs/:jobId, then call this endpoint again.
   * If known system wallet: returns HTTP 422, no credits charged.
   *
   * Credits are charged on "ok" (data delivered, handler returns 200).
   * 202 uses throw → interceptor skips → 0cr. Agent pays on the 200 re-call.
   * Never charged on 4xx or 422.
   */
  @Get('wallet/:addr')
  @RequireCredits(5)
  @ApiOperation({
    summary: 'Aggregated wallet intel (5cr)',
    description: `Returns aggregated wallet intel (summary + HUD + behavior + PnL).

**HTTP 200 — status "ok":** Data returned immediately. 5cr charged.
**HTTP 202 — status "queued":** Wallet not yet analyzed. Flash analysis queued. 5cr charged. Poll \`monitoringUrl\` for completion, then call this endpoint again.
**HTTP 422 — status "skipped":** Known system/program wallet, not eligible for analysis. 0cr charged.`,
  })
  @ApiParam({ name: 'addr', description: 'Solana wallet address' })
  @ApiResponse({ status: 200, description: 'Aggregated wallet intel' })
  @ApiResponse({ status: 202, description: 'Analysis queued — poll monitoringUrl then call again' })
  @ApiResponse({ status: 400, description: 'Invalid Solana address' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  @ApiResponse({ status: 422, description: 'Known system wallet — not eligible for analysis, 0cr charged' })
  async getWalletIntel(
    @Param('addr') addr: string,
    @Req() req: Request & { user?: User },
  ) {
    // Validate address before any DB work — same as AnalysesController
    if (!isValidSolanaAddress(addr)) {
      throw new BadRequestException(`Invalid Solana address: ${addr}`);
    }

    this.logger.log(`Intel wallet request: ${addr}`);

    // Check PnL summary — same gate as GET /wallets/:addr/summary.
    const summary = await this.databaseService.getWalletPnlSummaryWithRelations(addr);

    // Freshness check: same 30-minute window the dashboard uses to decide whether
    // to auto-trigger a re-analysis (WalletProfileLayout.tsx shouldAutoTriggerFlash).
    const FRESHNESS_MS = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash.freshnessMinutes * 60 * 1000;
    const isFresh = summary !== null && (Date.now() - summary.updatedAt.getTime()) < FRESHNESS_MS;

    if (isFresh) {
      // Data is fresh — fetch remaining fields in parallel and return immediately.
      // Exact same service calls + config as WalletsController / WalletHudController.
      const [hud, pnlOverview, behavior] = await Promise.all([
        this.walletHudService.getHud(addr).catch(() => null),
        this.pnlOverviewService.getPnlOverview(addr).catch(() => null),
        this.behaviorService
          .getWalletBehavior(addr, this.behaviorService.getDefaultBehaviorAnalysisConfig())
          .catch(() => null),
      ]);

      // HTTP 200 — CreditInterceptor fires, 5cr deducted. Data delivered.
      return {
        status: 'ok' as const,
        walletAddress: addr,
        summary: {
          lastAnalyzedAt: summary!.updatedAt.toISOString(),
          // realizedPnl is stable (closed trades only) — safe to serve from DB snapshot
          realizedPnl: summary!.realizedPnl ?? 0,
          profitableTradesCount: summary!.profitableTradesCount ?? 0,
          totalTradesCount: summary!.totalIndividualTradesCount ?? 0,
          currentSolBalance: summary!.currentSolBalance ?? null,
          knownType: summary!.wallet?.knownType ?? null,
          knownLabel: summary!.wallet?.knownLabel ?? null,
          // unrealizedPnl and netPnl are intentionally omitted here —
          // they require live token prices (DexScreener). See pnl.allTime below.
        },
        hud: hud ?? null,
        behavior: behavior
          ? {
              tradingStyle: behavior.tradingStyle ?? null,
              speedCategory: behavior.speedCategory ?? null,
              avgHoldTimeHours: behavior.averageFlipDurationHours ?? null,
              medianHoldTimeHours: behavior.medianHoldTime ?? null,
              buySellRatio: behavior.buySellRatio ?? null,
              exitPattern: behavior.historicalPattern?.exitPattern ?? null,
            }
          : null,
        pnl: pnlOverview
          ? {
              allTime: pnlOverview.allTimeData ?? null,
              period: pnlOverview.periodData ?? null,
            }
          : null,
      };
    }

    // Data is missing or stale (older than 30 min) — run pre-queue checks then queue.
    if (summary) {
      const ageMin = Math.round((Date.now() - summary.updatedAt.getTime()) / 60000);
      this.logger.log(`Intel wallet ${addr}: data is stale (${ageMin}min old), auto-queuing refresh`);
    } else {
      this.logger.log(`Intel wallet ${addr}: no data found, auto-queuing flash analysis`);
    }

    try {
      const scope = 'flash' as const;
      const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
      const requestId = `intel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Known-wallet check — identical to AnalysesController (all four conditions)
      const registryEntry = getKnownWallet(addr);
      const walletRecord = await this.databaseService.getWallet(addr);
      const isKnownWallet =
        !!registryEntry ||
        !!walletRecord?.knownType ||
        walletRecord?.classification === WALLET_CLASSIFICATIONS.SYSTEM ||
        walletRecord?.classification === 'INVALID';

      if (isKnownWallet) {
        const skipReason = registryEntry?.type ?? walletRecord?.knownType ?? 'known-wallet';
        this.logger.debug(`Intel wallet ${addr}: skipping — ${skipReason}`);
        // HTTP 422 — CreditInterceptor does NOT fire. 0cr charged.
        throw new HttpException(
          {
            status: 'skipped',
            walletAddress: addr,
            skipReason,
            message: 'This wallet is a known system/program wallet and is not eligible for analysis.',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // BullMQ queue scan — check for waiting/active/delayed jobs before the lock.
      // Identical to AnalysesController. The lock is only set once the processor
      // starts executing — a queued-but-not-started job has no lock yet.
      const queue = this.analysisOperationsQueue.getQueue();
      const existingJobs = await queue.getJobs(['active', 'waiting', 'delayed']);
      const matchingJob = existingJobs.find((job) => {
        const jobData = job?.data as DashboardWalletAnalysisJobData | undefined;
        if (!jobData) return false;
        return jobData.walletAddress === addr && (jobData.analysisScope ?? 'deep') === scope;
      });

      if (matchingJob) {
        const jobId = matchingJob.id ?? null;
        this.logger.log(`Intel wallet ${addr}: job already in queue: ${jobId}`);
        // HTTP 202 — throw skips CreditInterceptor → 0cr. Agent pays on the 200 re-call.
        throw new HttpException(
          {
            status: 'queued',
            walletAddress: addr,
            jobId,
            monitoringUrl: jobId ? `/api/v1/jobs/${jobId}` : null,
            message: 'Analysis already queued. Poll monitoringUrl for completion, then call this endpoint again.',
          },
          HttpStatus.ACCEPTED,
        );
      }

      // Redis lock check — job is actively executing in the processor
      const lockKey = RedisLockService.createWalletLockKey(addr, 'dashboard-analysis');
      const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
      if (existingLockJobId) {
        this.logger.log(`Intel wallet ${addr}: analysis already running via job ${existingLockJobId}`);
        // HTTP 202 — throw skips CreditInterceptor → 0cr. Agent pays on the 200 re-call.
        throw new HttpException(
          {
            status: 'queued',
            walletAddress: addr,
            jobId: existingLockJobId,
            monitoringUrl: `/api/v1/jobs/${existingLockJobId}`,
            message: 'Analysis already in progress. Poll monitoringUrl for completion, then call this endpoint again.',
          },
          HttpStatus.ACCEPTED,
        );
      }

      // Queue the job — identical job data shape to AnalysesController
      const jobData: DashboardWalletAnalysisJobData = {
        walletAddress: addr,
        userId: req.user?.id,
        requestId,
        analysisScope: scope,
        triggerSource: 'auto',
        historyWindowDays: scopeDefaults.historyWindowDays ?? undefined,
        targetSignatureCount: scopeDefaults.targetSignatureCount ?? undefined,
        forceRefresh: false,
        enrichMetadata: false,
        queueWorkingAfter: true,  // Same default as dashboard auto-trigger
        queueDeepAfter: false,
        failureThreshold: 0.8,
        timeoutMinutes: scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES,
      };

      const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
        priority: JobPriority.CRITICAL,
      });

      this.logger.log(`Intel wallet ${addr}: queued flash analysis job ${job.id}`);

      // HTTP 202 — throw skips CreditInterceptor → 0cr. Agent pays on the 200 re-call.
      throw new HttpException(
        {
          status: 'queued',
          walletAddress: addr,
          jobId: job.id,
          monitoringUrl: `/api/v1/jobs/${job.id}`,
          message: 'Wallet analysis queued. Poll monitoringUrl for completion, then call this endpoint again to retrieve data.',
        },
        HttpStatus.ACCEPTED,
      );
    } catch (error) {
      // Re-throw HttpExceptions (our own 202/422 responses above)
      if (error instanceof HttpException) throw error;
      this.logger.error(`Intel wallet ${addr}: failed to queue analysis: ${error}`);
      throw new InternalServerErrorException('Failed to queue wallet analysis');
    }
  }

  /**
   * GET /intel/wallet/:addr/tokens
   * 3 credits — paginated token performance list.
   */
  @Get('wallet/:addr/tokens')
  @RequireCredits(3)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Wallet token performance list (3cr)',
    description: 'Paginated token-level performance data for a wallet. Supports sorting by PnL, win-rate, volume, or percentage-gain.',
  })
  @ApiParam({ name: 'addr', description: 'Solana wallet address' })
  @ApiResponse({ status: 200, description: 'Paginated token performance data' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  @ApiResponse({ status: 404, description: 'No token data — call GET /intel/wallet/:addr first to trigger analysis' })
  async getWalletTokens(
    @Param('addr') addr: string,
    @Query() queryDto: TokenPerformanceQueryDto,
  ) {
    this.logger.log(`Intel tokens request: ${addr}`);
    const result = await this.tokenPerformanceService.getPaginatedTokenPerformance(addr, queryDto);

    if (result.total === 0) {
      throw new NotFoundException(
        `No token performance data found for wallet ${addr}. ` +
          'Call GET /api/v1/intel/wallet/:addr first — it will auto-queue analysis if the wallet is missing.',
      );
    }

    return result;
  }

  /**
   * GET /intel/wallet/:addr/hud
   * 1 credit — compact HUD metrics only.
   *
   * If HUD data exists: returns it immediately (1cr charged).
   * If missing: auto-queues flash analysis (0cr), returns 202.
   *   → Poll GET /api/v1/jobs/:jobId, then call this endpoint again (1cr on 200).
   */
  @Get('wallet/:addr/hud')
  @RequireCredits(1)
  @ApiOperation({
    summary: 'Wallet HUD metrics (1cr)',
    description: 'Returns compact heads-up-display metrics. Auto-queues flash analysis if wallet is unknown — returns 202, poll monitoringUrl, then call again.',
  })
  @ApiParam({ name: 'addr', description: 'Solana wallet address' })
  @ApiResponse({ status: 200, description: 'Wallet HUD metrics' })
  @ApiResponse({ status: 202, description: 'Analysis queued — poll monitoringUrl then call again' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  @ApiResponse({ status: 422, description: 'Known system wallet — not eligible for analysis' })
  async getWalletHud(@Param('addr') addr: string) {
    this.logger.log(`Intel HUD request: ${addr}`);
    const hud = await this.walletHudService.getHud(addr);

    if (hud) return hud;

    // HUD missing — auto-queue flash analysis, same logic as getWalletIntel.
    this.logger.log(`Intel HUD ${addr}: no data, auto-queuing flash analysis`);

    try {
      const registryEntry = getKnownWallet(addr);
      const walletRecord = await this.databaseService.getWallet(addr);
      const isKnownWallet =
        !!registryEntry ||
        !!walletRecord?.knownType ||
        walletRecord?.classification === WALLET_CLASSIFICATIONS.SYSTEM ||
        walletRecord?.classification === 'INVALID';

      if (isKnownWallet) {
        throw new HttpException(
          { status: 'skipped', walletAddress: addr, message: 'Known system wallet — not eligible for analysis.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // Check for already-queued/running job
      const queue = this.analysisOperationsQueue.getQueue();
      const existingJobs = await queue.getJobs(['active', 'waiting', 'delayed']);
      const matchingJob = existingJobs.find((job) => {
        const jobData = job?.data as DashboardWalletAnalysisJobData | undefined;
        return jobData?.walletAddress === addr && (jobData?.analysisScope ?? 'deep') === 'flash';
      });

      if (matchingJob) {
        throw new HttpException(
          { status: 'queued', walletAddress: addr, jobId: matchingJob.id, monitoringUrl: `/api/v1/jobs/${matchingJob.id}`, message: 'Analysis already queued. Poll monitoringUrl then call again.' },
          HttpStatus.ACCEPTED,
        );
      }

      const lockKey = RedisLockService.createWalletLockKey(addr, 'dashboard-analysis');
      const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
      if (existingLockJobId) {
        throw new HttpException(
          { status: 'queued', walletAddress: addr, jobId: existingLockJobId, monitoringUrl: `/api/v1/jobs/${existingLockJobId}`, message: 'Analysis already running. Poll monitoringUrl then call again.' },
          HttpStatus.ACCEPTED,
        );
      }

      const scope = 'flash' as const;
      const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
      const requestId = `intel-hud-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const jobData: DashboardWalletAnalysisJobData = {
        walletAddress: addr,
        userId: 'system',
        requestId,
        analysisScope: scope,
        triggerSource: 'auto',
        historyWindowDays: scopeDefaults.historyWindowDays ?? undefined,
        targetSignatureCount: scopeDefaults.targetSignatureCount ?? undefined,
        forceRefresh: false,
        enrichMetadata: false,
        queueWorkingAfter: false, // HUD call — no need to chain working analysis
        queueDeepAfter: false,
        failureThreshold: 0.8,
        timeoutMinutes: scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES,
      };
      const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
        priority: JobPriority.CRITICAL,
      });

      this.logger.log(`Intel HUD ${addr}: queued flash analysis job ${job.id}`);
      throw new HttpException(
        { status: 'queued', walletAddress: addr, jobId: job.id, monitoringUrl: `/api/v1/jobs/${job.id}`, message: 'Wallet analysis queued. Poll monitoringUrl for completion, then call this endpoint again.' },
        HttpStatus.ACCEPTED,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Intel HUD ${addr}: failed to queue analysis: ${error}`);
      throw new InternalServerErrorException('Failed to queue wallet analysis');
    }
  }

  /**
   * POST /intel/token/:mint/holders
   * 20 credits — queue holder-profiles analysis for a token's top holders.
   *
   * Queues an analyze-holder-profiles job (mode: 'token') via the same AnalysisOperationsQueue
   * and processor as POST /analyses/holder-profiles. Fetches top N holders from Helius,
   * runs wallet analysis on each, stores profiles in Redis under holder-profiles:result:{jobId}.
   * Similarity is NOT auto-chained by the processor — poll the job, then fire
   * POST /intel/wallets/batch-hud or POST /analyses/similarity/queue separately.
   *
   * Static @RequireCredits(20) → X402 works automatically for autonomous agents.
   *
   * Credit contract: handler always returns (never throws on success path) → HTTP 202
   * with @HttpCode(202) → CreditInterceptor fires → 20cr deducted on job acceptance.
   */
  @Post('token/:mint/holders')
  @RequireCredits(20)
  @HttpCode(202)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Queue holder-profiles analysis for a token (20cr)',
    description: `Queues holder-profiles analysis for the top N holders of a token mint.

**Always returns HTTP 202** — the job runs asynchronously. Poll \`monitoringUrl\` for completion. Job result is stored in Redis under \`holder-profiles:result:{jobId}\` (15-min TTL), retrievable via \`GET /api/v1/jobs/result/by-key\`.

20cr deducted on job acceptance. No charge if the mint address is invalid (400).`,
  })
  @ApiParam({ name: 'mint', description: 'Solana token mint address' })
  @ApiBody({ type: IntelTokenHoldersRequestDto })
  @ApiResponse({ status: 202, description: 'Holder-profiles job accepted — poll monitoringUrl for completion' })
  @ApiResponse({ status: 400, description: 'Invalid token mint address or topN out of range' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  async queueTokenHolders(
    @Param('mint') mint: string,
    @Req() req: Request & { user?: User },
    @Body() body: IntelTokenHoldersRequestDto,
  ) {
    if (!isValidSolanaAddress(mint)) {
      throw new BadRequestException(`Invalid token mint address: ${mint}`);
    }

    const topN = body.topN ?? 20;
    if (topN < 1 || topN > 50) {
      throw new BadRequestException('topN must be between 1 and 50');
    }

    this.logger.log(`Intel holder-profiles request: mint=${mint} topN=${topN}`);

    const requestId = `intel-holders-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const jobData: AnalyzeHolderProfilesJobData = {
      mode: 'token',
      userId: req.user?.id,
      tokenMint: mint,
      topN,
      requestId,
    };

    let job: Awaited<ReturnType<typeof this.analysisOperationsQueue.addHolderProfilesJob>>;
    try {
      job = await this.analysisOperationsQueue.addHolderProfilesJob(jobData, {
        priority: JobPriority.HIGH,
        delay: 0,
      });
    } catch (queueError) {
      this.logger.error(`Intel holder-profiles: failed to queue job for ${mint}: ${queueError}`);
      throw new InternalServerErrorException('Failed to queue holder-profiles job');
    }

    this.logger.log(`Intel holder-profiles: queued job ${job.id} for mint=${mint} topN=${topN}`);

    // HTTP 202 — CreditInterceptor fires on return → 20cr deducted.
    return {
      status: 'queued' as const,
      tokenMint: mint,
      topN,
      jobId: job.id,
      requestId,
      monitoringUrl: `/api/v1/jobs/${job.id}`,
      message: 'Holder-profiles analysis queued. Poll monitoringUrl for completion.',
    };
  }

  @Post('wallets/similarity')
  @RequireCredits(20)
  @HttpCode(202)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Queue standalone similarity analysis (20cr)',
    description: 'Queues similarity analysis for 2-30 wallet addresses. Always returns HTTP 202 with a job ID for async polling.',
  })
  @ApiBody({ type: IntelWalletSimilarityRequestDto })
  @ApiResponse({ status: 202, description: 'Similarity job accepted - poll monitoringUrl for completion' })
  @ApiResponse({ status: 400, description: 'Invalid wallet list or invalid wallet address' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  async queueWalletSimilarity(
    @Req() req: Request & { user?: User },
    @Body() body: IntelWalletSimilarityRequestDto,
  ) {
    const invalidWallets = body.wallets.filter((wallet) => !isValidSolanaAddress(wallet));
    if (invalidWallets.length > 0) {
      throw new BadRequestException(
        `Invalid Solana address(es) provided: ${invalidWallets.slice(0, 5).join(', ')}${invalidWallets.length > 5 ? ` ... (+${invalidWallets.length - 5} more)` : ''}`,
      );
    }

    const similarity = await this.queueSimilarityJob(req, body.wallets, 'intel-similarity');

    return {
      status: 'queued' as const,
      jobId: similarity.jobId,
      requestId: similarity.requestId,
      walletCount: body.wallets.length,
      monitoringUrl: `/api/v1/jobs/${similarity.jobId}`,
      message: 'Similarity analysis queued. Poll monitoringUrl for completion.',
    };
  }

  @Post('token/:mint/holders/deep')
  @RequireCredits(35)
  @HttpCode(202)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Queue bundled holder-profiles + similarity analysis (35cr)',
    description: `Queues two jobs in one request:
- holder-profiles for token top holders (token mint + topN)
- similarity analysis for provided wallets[]

Always returns HTTP 202 with both job IDs.`,
  })
  @ApiParam({ name: 'mint', description: 'Solana token mint address' })
  @ApiBody({ type: IntelTokenHoldersDeepRequestDto })
  @ApiResponse({ status: 202, description: 'Bundled jobs accepted - poll both monitoring URLs for completion' })
  @ApiResponse({ status: 206, description: 'Partial acceptance — holder-profiles queued but similarity failed; 0cr charged' })
  @ApiResponse({ status: 400, description: 'Invalid token mint, topN, or wallets payload' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  async queueTokenHoldersDeep(
    @Param('mint') mint: string,
    @Req() req: Request & { user?: User },
    @Body() body: IntelTokenHoldersDeepRequestDto,
  ) {
    if (!isValidSolanaAddress(mint)) {
      throw new BadRequestException(`Invalid token mint address: ${mint}`);
    }

    const topN = body.topN ?? 20;
    if (topN < 1 || topN > 50) {
      throw new BadRequestException('topN must be between 1 and 50');
    }

    const invalidWallets = body.wallets.filter((wallet) => !isValidSolanaAddress(wallet));
    if (invalidWallets.length > 0) {
      throw new BadRequestException(
        `Invalid Solana address(es) provided: ${invalidWallets.slice(0, 5).join(', ')}${invalidWallets.length > 5 ? ` ... (+${invalidWallets.length - 5} more)` : ''}`,
      );
    }

    const holderProfilesRequestId = `intel-holders-deep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const holderProfilesJobData: AnalyzeHolderProfilesJobData = {
      mode: 'token',
      userId: req.user?.id,
      tokenMint: mint,
      topN,
      requestId: holderProfilesRequestId,
    };

    let holderProfilesJob: Awaited<ReturnType<typeof this.analysisOperationsQueue.addHolderProfilesJob>>;
    try {
      holderProfilesJob = await this.analysisOperationsQueue.addHolderProfilesJob(holderProfilesJobData, {
        priority: JobPriority.HIGH,
        delay: 0,
      });
    } catch (queueError) {
      this.logger.error(`Intel deep holder-profiles: failed to queue job for ${mint}: ${queueError}`);
      throw new InternalServerErrorException('Failed to queue holder-profiles job');
    }

    let similarity: { requestId: string; jobId: string };
    try {
      similarity = await this.queueSimilarityJob(req, body.wallets, 'intel-holders-deep');
    } catch (similarityError) {
      // Holder-profiles job is already in BullMQ — return its ID so the caller
      // can track it. Throw (not return) so CreditInterceptor skips and 35cr
      // are NOT charged for a partial acceptance.
      this.logger.error(
        `Intel deep: similarity queue failed after holder-profiles job ${holderProfilesJob.id} was accepted: ${similarityError}`,
      );
      throw new HttpException(
        {
          status: 'partial' as const,
          tokenMint: mint,
          topN,
          holderProfiles: {
            jobId: holderProfilesJob.id,
            requestId: holderProfilesRequestId,
            monitoringUrl: `/api/v1/jobs/${holderProfilesJob.id}`,
          },
          similarity: null,
          message:
            'Holder-profiles job was queued successfully but the similarity job could not be accepted. ' +
            'No credits were charged. You may retry the full request or call POST /intel/wallets/similarity separately.',
        },
        HttpStatus.PARTIAL_CONTENT,
      );
    }

    return {
      status: 'queued' as const,
      tokenMint: mint,
      topN,
      walletsCount: body.wallets.length,
      holderProfiles: {
        jobId: holderProfilesJob.id,
        requestId: holderProfilesRequestId,
        monitoringUrl: `/api/v1/jobs/${holderProfilesJob.id}`,
      },
      similarity: {
        jobId: similarity.jobId,
        requestId: similarity.requestId,
        monitoringUrl: `/api/v1/jobs/${similarity.jobId}`,
      },
      message: 'Bundled holder-profiles and similarity analyses queued. Poll both monitoring URLs for completion.',
    };
  }

  /**
   * POST /intel/wallets/batch-hud
   * 5 credits — batch HUD for up to 30 wallets. Same freshness logic as GET /intel/wallet/:addr
   * but applied per-wallet in parallel.
   *
   * For each wallet:
   *   - HUD in Redis cache (fresh) → returned immediately in `huds` map
   *   - HUD missing or wallet not analyzed → auto-queues flash analysis → jobId in `queued`
   *   - Known system wallet → listed in `skipped`
   *
   * 5cr charged once for the whole batch regardless of how many wallets are ready.
   * Agent calls again after queued jobs complete to get the remaining HUDs.
   */
  @Post('wallets/batch-hud')
  @RequireCredits(5)
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Batch HUD for up to 30 wallets (5cr)',
    description: `Returns HUD metrics for each wallet. Missing or stale wallets are auto-queued for flash analysis.

**Response shape:**
- \`huds\`: map of address → HUD for wallets with fresh data
- \`queued\`: array of \`{walletAddress, jobId, monitoringUrl}\` for wallets that needed analysis
- \`skipped\`: known system/program wallets (no analysis possible)

5cr per call. Call again after queued jobs complete to get the remaining HUDs. Max 30 wallets.`,
  })
  @ApiBody({ type: BatchHudRequestDto })
  @ApiResponse({ status: 200, description: 'Batch HUD — huds map + queued jobs + skipped list' })
  @ApiResponse({ status: 400, description: 'Invalid request — empty array, >30 wallets, or invalid addresses' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  async batchWalletHud(
    @Req() req: Request & { user?: User },
    @Body() body: BatchHudRequestDto,
  ) {
    const { wallets } = body;

    const invalidAddresses = wallets.filter((w) => !isValidSolanaAddress(w));
    if (invalidAddresses.length > 0) {
      throw new BadRequestException(
        `Invalid Solana address(es): ${invalidAddresses.slice(0, 5).join(', ')}${invalidAddresses.length > 5 ? ` … (+${invalidAddresses.length - 5} more)` : ''}`,
      );
    }

    this.logger.log(`Intel batch-hud request: ${wallets.length} wallets`);

    const FRESHNESS_MS = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash.freshnessMinutes * 60 * 1000;

    // Process each wallet in parallel — same logic as GET /intel/wallet/:addr per wallet
    const results = await Promise.all(wallets.map(async (addr) => {
      try {
        // Known-wallet check first — identical 4-condition check
        const registryEntry = getKnownWallet(addr);
        const walletRecord = await this.databaseService.getWallet(addr);
        const isKnownWallet =
          !!registryEntry ||
          !!walletRecord?.knownType ||
          walletRecord?.classification === WALLET_CLASSIFICATIONS.SYSTEM ||
          walletRecord?.classification === 'INVALID';

        if (isKnownWallet) {
          return { addr, type: 'skipped' as const };
        }

        // Check freshness via PnL summary — same gate as GET /intel/wallet/:addr
        const summary = await this.databaseService.getWalletPnlSummaryWithRelations(addr);
        const isFresh = summary !== null && (Date.now() - summary.updatedAt.getTime()) < FRESHNESS_MS;

        if (isFresh) {
          const hud = await this.walletHudService.getHud(addr).catch(() => null);
          if (hud) {
            return { addr, type: 'ready' as const, hud };
          }
          // Summary is fresh but HUD not built yet — fall through to queue
        }

        // Missing or stale — check dedup before queuing (BullMQ scan + Redis lock)
        const queue = this.analysisOperationsQueue.getQueue();
        const existingJobs = await queue.getJobs(['active', 'waiting', 'delayed']);
        const matchingJob = existingJobs.find((job) => {
          const d = job?.data as DashboardWalletAnalysisJobData | undefined;
          return d?.walletAddress === addr && (d?.analysisScope ?? 'deep') === 'flash';
        });
        if (matchingJob) {
          return { addr, type: 'queued' as const, jobId: matchingJob.id ?? '' };
        }

        const lockKey = RedisLockService.createWalletLockKey(addr, 'dashboard-analysis');
        const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
        if (existingLockJobId) {
          return { addr, type: 'queued' as const, jobId: existingLockJobId };
        }

        // Queue flash analysis
        const requestId = `intel-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash;
        const jobData: DashboardWalletAnalysisJobData = {
          walletAddress: addr,
          userId: req.user?.id,
          requestId,
          analysisScope: 'flash',
          triggerSource: 'auto',
          historyWindowDays: scopeDefaults.historyWindowDays ?? undefined,
          targetSignatureCount: scopeDefaults.targetSignatureCount ?? undefined,
          forceRefresh: false,
          enrichMetadata: false,
          queueWorkingAfter: true,
          queueDeepAfter: false,
          failureThreshold: 0.8,
          timeoutMinutes: scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES,
        };
        const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
          priority: JobPriority.CRITICAL,
        });
        return { addr, type: 'queued' as const, jobId: job.id ?? '' };

      } catch (err) {
        this.logger.warn(`Intel batch-hud: error processing ${addr}: ${err}`);
        return { addr, type: 'error' as const };
      }
    }));

    // Shape the response
    const huds: Record<string, any> = {};
    const queued: Array<{ walletAddress: string; jobId: string; monitoringUrl: string }> = [];
    const skipped: string[] = [];

    for (const r of results) {
      if (r.type === 'ready') huds[r.addr] = r.hud;
      else if (r.type === 'queued') queued.push({ walletAddress: r.addr, jobId: r.jobId, monitoringUrl: `/api/v1/jobs/${r.jobId}` });
      else if (r.type === 'skipped') skipped.push(r.addr);
    }

    return { huds, queued, skipped, calculatedAt: new Date() };
  }

  private async queueSimilarityJob(
    req: Request & { user?: User },
    wallets: string[],
    prefix: string,
  ): Promise<{ requestId: string; jobId: string }> {
    const requestId = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const walletStatuses = await this.databaseService.getWalletsStatus(wallets);
    const walletsNeedingSync = walletStatuses.statuses
      .filter((status) => status.status === 'STALE' || status.status === 'MISSING')
      .map((status) => status.walletAddress);

    const jobData: ComprehensiveSimilarityFlowData = {
      walletAddresses: wallets,
      userId: req.user?.id,
      requestId,
      walletsNeedingSync,
      enrichMetadata: false,
      includeBalances: false,
      includeVectors: false,
      failureThreshold: 0.8,
      timeoutMinutes: walletsNeedingSync.length > 0 ? 45 : 15,
      similarityConfig: {
        vectorType: 'capital',
      },
    };

    let job: Awaited<ReturnType<typeof this.similarityOperationsQueue.addSimilarityAnalysisFlow>>;
    try {
      job = await this.similarityOperationsQueue.addSimilarityAnalysisFlow(jobData, {
        priority: JobPriority.NORMAL,
        delay: 0,
      });
    } catch (queueError) {
      this.logger.error(`Intel similarity: failed to queue job for request ${requestId}: ${queueError}`);
      throw new InternalServerErrorException('Failed to queue similarity analysis job');
    }

    return {
      requestId,
      jobId: String(job.id),
    };
  }
}
