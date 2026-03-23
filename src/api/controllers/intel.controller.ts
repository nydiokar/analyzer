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
  Inject,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { IsArray, IsString, ArrayMaxSize, ArrayMinSize, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';

import { RequireCredits } from '../shared/decorators/require-credits.decorator';
import { WalletHudService } from '../services/wallet-hud.service';
import { DatabaseService } from '../services/database.service';
import { BehaviorService } from '../services/behavior.service';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { TokenPerformanceService } from '../services/token-performance.service';
import { TokenPerformanceQueryDto } from '../shared/dto/token-performance-query.dto';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { RedisLockService } from '../../queues/services/redis-lock.service';
import {
  AnalyzeHolderProfilesJobData,
  ComprehensiveSimilarityFlowData,
  DashboardWalletAnalysisJobData,
} from '../../queues/jobs/types';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG, WALLET_CLASSIFICATIONS } from '../../config/constants';
import { JobPriority, QueueNames } from '../../queues/config/queue.config';
import { JobEventsBridgeService } from '../../queues/services/job-events-bridge.service';
import { getKnownWallet, isAnalysisBlockingType } from '../../config/known-wallets';
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
  // wallets[] removed — server discovers holders from Helius during holder-profiles job
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
 * - status "queued" → 202  → throw HttpException → interceptor skips → 0cr           ✓ timeout fallback only
 * - status "queued" → 202  → handler returns    → interceptor fires → Ncr deducted  ✓ POST endpoints: pay on acceptance
 * - status "skipped"→ 422  → throw HttpException → interceptor skips → 0cr           ✓ known wallet, nothing to do
 * - invalid address → 400  → throw BadRequest   → interceptor skips → 0cr           ✓ guard or handler rejects
 *
 * GET /intel/wallet/:addr synchronous hold: connection is held open up to 30s awaiting the flash
 * analysis. On completion a 200 is returned and credits are charged once. A 202 is only thrown
 * if the analysis exceeds 30s — the prepaidJobId in the response allows one free re-call.
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
    private readonly jobEventsBridgeService: JobEventsBridgeService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  private awaitJob(job: Job): Promise<'completed' | 'failed' | 'timeout'> {
    return this.jobEventsBridgeService.waitForJob(job, QueueNames.ANALYSIS_OPERATIONS);
  }

  /**
   * Returns the prepaid marker value to store in Redis.
   * 'x402' = agent paid on-chain; CreditInterceptor must NOT deduct on re-call.
   * Anything else = standard credit user; CreditInterceptor MUST deduct on re-call.
   */
  private prepaidMarkerValue(req: Request & { user?: User }): string {
    const isX402 =
      (req as any).x402Paid === true ||
      (req as any).x402PendingTxBytes != null;
    return isX402 ? 'x402' : (req.user?.id ?? 'unknown');
  }

  private buildIntelResponse(
    addr: string,
    summary: NonNullable<Awaited<ReturnType<DatabaseService['getWalletPnlSummaryWithRelations']>>>,
    hud: any,
    pnlOverview: any,
    behavior: any,
  ) {
    const kol = summary.wallet?.kolProfile ?? null;
    return {
      status: 'ok' as const,
      walletAddress: addr,
      summary: {
        lastAnalyzedAt: summary.updatedAt.toISOString(),
        realizedPnl: summary.realizedPnl ?? 0,
        profitableTradesCount: summary.profitableTradesCount ?? 0,
        totalTradesCount: summary.totalIndividualTradesCount ?? 0,
        currentSolBalance: summary.currentSolBalance ?? null,
        knownType: summary.wallet?.knownType ?? null,
        knownLabel: summary.wallet?.knownLabel ?? null,
      },
      // Present when this wallet belongs to a known KOL
      kol: kol
        ? {
            name: kol.name,
            twitter: kol.twitter ?? null,
            telegram: kol.telegram ?? null,
          }
        : null,
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

**HTTP 200 — status "ok":** Data returned immediately (or after synchronous wait). 5cr charged.
**HTTP 202 — status "queued":** Analysis timed out (>30s). 0cr charged. Poll \`monitoringUrl\` for completion, then call again with \`X-Prepaid-Job-Id: {prepaidJobId}\` header — no second payment required.
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

    // Prepaid re-call: CreditGuard already consumed the marker and set x402Paid/creditCost.
    // The analysis just ran — serve whatever is in DB regardless of freshness timestamp.
    const isPrepaidRecall = !!(req.headers as any)['x-prepaid-job-id'];

    // Freshness check: same 30-minute window the dashboard uses to decide whether
    // to auto-trigger a re-analysis (WalletProfileLayout.tsx shouldAutoTriggerFlash).
    const FRESHNESS_MS = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash.freshnessMinutes * 60 * 1000;
    const isFresh = isPrepaidRecall
      ? summary !== null  // prepaid re-call: skip staleness gate — analysis just ran
      : summary !== null && (Date.now() - summary.updatedAt.getTime()) < FRESHNESS_MS;

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
      return this.buildIntelResponse(addr, summary!, hud, pnlOverview, behavior);
    }

    // Data is missing or stale (older than 30 min) — run pre-queue checks then queue.
    if (summary) {
      const ageMin = Math.round((Date.now() - summary.updatedAt.getTime()) / 60000);
      this.logger.log(`Intel wallet ${addr}: data is stale (${ageMin}min old), auto-queuing refresh`);
    } else {
      this.logger.log(`Intel wallet ${addr}: no data found, auto-queuing flash analysis`);
    }

    try {
      const scope = 'deep' as const;
      const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
      const requestId = `intel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Known-wallet check — KOL wallets (knownType='KOL') are NOT skipped; they are
      // named traders and should be analyzed normally. Only blocking types are skipped.
      const registryEntry = getKnownWallet(addr);
      const walletRecord = await this.databaseService.getWallet(addr);
      const isKnownWallet =
        (!!registryEntry && isAnalysisBlockingType(registryEntry.type)) ||
        (!!walletRecord?.knownType && isAnalysisBlockingType(walletRecord.knownType as any)) ||
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
        this.logger.log(`Intel wallet ${addr}: job already in queue: ${jobId} — awaiting completion`);
        const outcome = await this.awaitJob(matchingJob);
        if (outcome === 'completed') {
          const freshSummary = await this.databaseService.getWalletPnlSummaryWithRelations(addr);
          if (freshSummary) {
            const [hud, pnlOverview, behavior] = await Promise.all([
              this.walletHudService.getHud(addr).catch(() => null),
              this.pnlOverviewService.getPnlOverview(addr).catch(() => null),
              this.behaviorService.getWalletBehavior(addr, this.behaviorService.getDefaultBehaviorAnalysisConfig()).catch(() => null),
            ]);
            return this.buildIntelResponse(addr, freshSummary, hud, pnlOverview, behavior);
          }
        }
        // Write prepaid marker for timeout OR failed — agent already cleared payment gate
        if (jobId) {
          await this.redisClient.set(`intel:prepaid:${jobId}`, this.prepaidMarkerValue(req), 'EX', 300);
        }
        throw new HttpException(
          { status: 'queued', walletAddress: addr, jobId, prepaidJobId: jobId, monitoringUrl: jobId ? `/api/v1/jobs/${jobId}` : null, message: 'Analysis already queued. Poll monitoringUrl for completion, then call this endpoint again.' },
          HttpStatus.ACCEPTED,
        );
      }

      // Redis lock check — job is actively executing in the processor
      const lockKey = RedisLockService.createWalletLockKey(addr, 'dashboard-analysis');
      const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
      if (existingLockJobId) {
        this.logger.log(`Intel wallet ${addr}: analysis already running via job ${existingLockJobId} — awaiting completion`);
        const existingJob = await queue.getJob(existingLockJobId);
        if (existingJob) {
          const outcome = await this.awaitJob(existingJob);
          if (outcome === 'completed') {
            const freshSummary = await this.databaseService.getWalletPnlSummaryWithRelations(addr);
            if (freshSummary) {
              const [hud, pnlOverview, behavior] = await Promise.all([
                this.walletHudService.getHud(addr).catch(() => null),
                this.pnlOverviewService.getPnlOverview(addr).catch(() => null),
                this.behaviorService.getWalletBehavior(addr, this.behaviorService.getDefaultBehaviorAnalysisConfig()).catch(() => null),
              ]);
              return this.buildIntelResponse(addr, freshSummary, hud, pnlOverview, behavior);
            }
          }
          // Write prepaid marker for timeout OR failed — agent already cleared payment gate
          await this.redisClient.set(`intel:prepaid:${existingLockJobId}`, this.prepaidMarkerValue(req), 'EX', 300);
        } else {
          // Job was evicted from BullMQ (removeOnComplete) but lock still present — job already
          // finished. Try to serve from DB directly; if data is there we're done.
          const freshSummary = await this.databaseService.getWalletPnlSummaryWithRelations(addr);
          if (freshSummary) {
            const [hud, pnlOverview, behavior] = await Promise.all([
              this.walletHudService.getHud(addr).catch(() => null),
              this.pnlOverviewService.getPnlOverview(addr).catch(() => null),
              this.behaviorService.getWalletBehavior(addr, this.behaviorService.getDefaultBehaviorAnalysisConfig()).catch(() => null),
            ]);
            return this.buildIntelResponse(addr, freshSummary, hud, pnlOverview, behavior);
          }
          // Data still not in DB — write prepaid marker and fall through to 202
          await this.redisClient.set(`intel:prepaid:${existingLockJobId}`, this.prepaidMarkerValue(req), 'EX', 300);
        }
        throw new HttpException(
          { status: 'queued', walletAddress: addr, jobId: existingLockJobId, prepaidJobId: existingLockJobId, monitoringUrl: `/api/v1/jobs/${existingLockJobId}`, message: 'Analysis already in progress. Poll monitoringUrl for completion, then call this endpoint again.' },
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
        queueWorkingAfter: false,
        queueDeepAfter: false,
        failureThreshold: 0.8,
        timeoutMinutes: scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES,
      };

      const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
        priority: JobPriority.CRITICAL,
      });

      this.logger.log(`Intel wallet ${addr}: queued deep analysis job ${job.id} — awaiting completion`);

      const outcome = await this.awaitJob(job);
      if (outcome === 'completed') {
        const freshSummary = await this.databaseService.getWalletPnlSummaryWithRelations(addr);
        if (freshSummary) {
          const [hud, pnlOverview, behavior] = await Promise.all([
            this.walletHudService.getHud(addr).catch(() => null),
            this.pnlOverviewService.getPnlOverview(addr).catch(() => null),
            this.behaviorService.getWalletBehavior(addr, this.behaviorService.getDefaultBehaviorAnalysisConfig()).catch(() => null),
          ]);
          return this.buildIntelResponse(addr, freshSummary, hud, pnlOverview, behavior);
        }
      }

      // Timed out or failed — write prepaid marker so re-call skips CreditGuard payment
      if (job.id) {
        await this.redisClient.set(`intel:prepaid:${job.id}`, this.prepaidMarkerValue(req), 'EX', 300);
      }
      throw new HttpException(
        {
          status: 'queued',
          walletAddress: addr,
          jobId: job.id,
          prepaidJobId: job.id,
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
   * If missing: holds connection, runs flash analysis synchronously (up to 30s),
   * returns 200 + HUD on completion (1cr charged). Only falls back to 202 if >30s.
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
  async getWalletHud(@Param('addr') addr: string, @Req() req: Request & { user?: User }) {
    this.logger.log(`Intel HUD request: ${addr}`);
    const hud = await this.walletHudService.getHud(addr);

    if (hud) return hud;

    // HUD missing — auto-queue flash analysis, same logic as getWalletIntel.
    this.logger.log(`Intel HUD ${addr}: no data, auto-queuing flash analysis`);

    try {
      const registryEntry = getKnownWallet(addr);
      const walletRecord = await this.databaseService.getWallet(addr);
      const isKnownWallet =
        (!!registryEntry && isAnalysisBlockingType(registryEntry.type)) ||
        (!!walletRecord?.knownType && isAnalysisBlockingType(walletRecord.knownType as any)) ||
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
      const matchingHudJob = existingJobs.find((job) => {
        const jobData = job?.data as DashboardWalletAnalysisJobData | undefined;
        return jobData?.walletAddress === addr && (jobData?.analysisScope ?? 'deep') === 'deep';
      });

      if (matchingHudJob) {
        this.logger.log(`Intel HUD ${addr}: job already in queue: ${matchingHudJob.id} — awaiting completion`);
        const outcome = await this.awaitJob(matchingHudJob);
        if (outcome === 'completed') {
          const freshHud = await this.walletHudService.getHud(addr);
          if (freshHud) return freshHud;
        }
        // Write prepaid marker for timeout OR failed — agent already cleared payment gate
        if (matchingHudJob.id) {
          await this.redisClient.set(`intel:prepaid-hud:${matchingHudJob.id}`, this.prepaidMarkerValue(req), 'EX', 300);
        }
        throw new HttpException(
          { status: 'queued', walletAddress: addr, jobId: matchingHudJob.id, prepaidJobId: matchingHudJob.id, monitoringUrl: `/api/v1/jobs/${matchingHudJob.id}`, message: 'Analysis already queued. Poll monitoringUrl then call again.' },
          HttpStatus.ACCEPTED,
        );
      }

      const lockKey = RedisLockService.createWalletLockKey(addr, 'dashboard-analysis');
      const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
      if (existingLockJobId) {
        this.logger.log(`Intel HUD ${addr}: analysis already running via job ${existingLockJobId} — awaiting completion`);
        const existingHudJob = await queue.getJob(existingLockJobId);
        if (existingHudJob) {
          const outcome = await this.awaitJob(existingHudJob);
          if (outcome === 'completed') {
            const freshHud = await this.walletHudService.getHud(addr);
            if (freshHud) return freshHud;
          }
          // Write prepaid marker for timeout OR failed — agent already cleared payment gate
          await this.redisClient.set(`intel:prepaid-hud:${existingLockJobId}`, this.prepaidMarkerValue(req), 'EX', 300);
        } else {
          // Job evicted from BullMQ (removeOnComplete) but lock still present — already done.
          const freshHud = await this.walletHudService.getHud(addr);
          if (freshHud) return freshHud;
          await this.redisClient.set(`intel:prepaid-hud:${existingLockJobId}`, this.prepaidMarkerValue(req), 'EX', 300);
        }
        throw new HttpException(
          { status: 'queued', walletAddress: addr, jobId: existingLockJobId, prepaidJobId: existingLockJobId, monitoringUrl: `/api/v1/jobs/${existingLockJobId}`, message: 'Analysis already running. Poll monitoringUrl then call again.' },
          HttpStatus.ACCEPTED,
        );
      }

      const scope = 'deep' as const;
      const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
      const requestId = `intel-hud-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
        queueWorkingAfter: false,
        queueDeepAfter: false,
        failureThreshold: 0.8,
        timeoutMinutes: scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES,
      };
      const hudJob = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
        priority: JobPriority.CRITICAL,
      });

      this.logger.log(`Intel HUD ${addr}: queued flash analysis job ${hudJob.id} — awaiting completion`);

      const hudOutcome = await this.awaitJob(hudJob);
      if (hudOutcome === 'completed') {
        const freshHud = await this.walletHudService.getHud(addr);
        if (freshHud) return freshHud;
      }

      if (hudJob.id) {
        await this.redisClient.set(`intel:prepaid-hud:${hudJob.id}`, this.prepaidMarkerValue(req), 'EX', 300);
      }
      throw new HttpException(
        { status: 'queued', walletAddress: addr, jobId: hudJob.id, prepaidJobId: hudJob.id, monitoringUrl: `/api/v1/jobs/${hudJob.id}`, message: 'Wallet analysis queued. Poll monitoringUrl for completion, then call this endpoint again.' },
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
    summary: 'Bundled holder-profiles + similarity analysis (35cr)',
    description: `Queues a holder-profiles job for the token mint. Once holder-profiles completes, the processor automatically chains a similarity job using the discovered holder addresses — no round-trip needed.

Returns both \`holderProfiles\` and \`similarity\` identifiers upfront. Poll the holder-profiles job first, then poll \`similarity.resultKey\` until the similarity result appears.

35cr per call (vs 40cr for the manual two-step flow).`,
  })
  @ApiParam({ name: 'mint', description: 'Solana token mint address' })
  @ApiResponse({ status: 202, description: 'Holder-profiles + chained similarity queued — poll both result keys' })
  @ApiResponse({ status: 400, description: 'Invalid mint address or topN out of range' })
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

    const holderProfilesRequestId = `intel-holders-deep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const chainedSimilarityRequestId = `intel-holders-deep-sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const holderProfilesJobData: AnalyzeHolderProfilesJobData = {
      mode: 'token',
      userId: req.user?.id,
      tokenMint: mint,
      topN,
      requestId: holderProfilesRequestId,
      chainSimilarity: true,
      chainSimilarityRequestId: chainedSimilarityRequestId,
    };

    let holderProfilesJob: Awaited<ReturnType<typeof this.analysisOperationsQueue.addHolderProfilesJob>>;
    try {
      holderProfilesJob = await this.analysisOperationsQueue.addHolderProfilesJob(holderProfilesJobData, {
        priority: JobPriority.HIGH,
        delay: 0,
      });
    } catch (queueError) {
      this.logger.error(`Intel deep: failed to queue holder-profiles job for ${mint}: ${queueError}`);
      throw new InternalServerErrorException('Failed to queue holder-profiles job');
    }

    this.logger.log(`Intel deep: queued job ${holderProfilesJob.id} for mint=${mint} topN=${topN} chainedSim=${chainedSimilarityRequestId}`);

    return {
      status: 'queued' as const,
      tokenMint: mint,
      topN,
      holderProfiles: {
        jobId: holderProfilesJob.id,
        requestId: holderProfilesRequestId,
        monitoringUrl: `/api/v1/jobs/${holderProfilesJob.id}`,
      },
      similarity: {
        jobId: null,
        requestId: chainedSimilarityRequestId,
        resultKey: `similarity:result:${chainedSimilarityRequestId}`,
        message: 'Similarity job will be queued automatically after holder-profiles completes. Poll resultKey for result.',
      },
      message: 'Bundled holder-profiles + similarity queued. Poll holderProfiles.monitoringUrl until completed, then poll similarity.resultKey.',
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
        // Known-wallet check first — KOL type is NOT blocking (analyzed normally)
        const registryEntry = getKnownWallet(addr);
        const walletRecord = await this.databaseService.getWallet(addr);
        const isKnownWallet =
          (!!registryEntry && isAnalysisBlockingType(registryEntry.type)) ||
          (!!walletRecord?.knownType && isAnalysisBlockingType(walletRecord.knownType as any)) ||
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
          return d?.walletAddress === addr && (d?.analysisScope ?? 'deep') === 'deep';
        });
        if (matchingJob) {
          return { addr, type: 'queued' as const, jobId: matchingJob.id ?? '' };
        }

        const lockKey = RedisLockService.createWalletLockKey(addr, 'dashboard-analysis');
        const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
        if (existingLockJobId) {
          return { addr, type: 'queued' as const, jobId: existingLockJobId };
        }

        // Queue deep analysis
        const requestId = `intel-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.deep;
        const jobData: DashboardWalletAnalysisJobData = {
          walletAddress: addr,
          userId: req.user?.id,
          requestId,
          analysisScope: 'deep',
          triggerSource: 'auto',
          historyWindowDays: scopeDefaults.historyWindowDays ?? undefined,
          targetSignatureCount: scopeDefaults.targetSignatureCount ?? undefined,
          forceRefresh: false,
          enrichMetadata: false,
          queueWorkingAfter: false,
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
