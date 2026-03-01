import {
  Controller,
  Get,
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
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';

import { RequireCredits } from '../shared/decorators/require-credits.decorator';
import { WalletHudService } from '../services/wallet-hud.service';
import { DatabaseService } from '../services/database.service';
import { BehaviorService } from '../services/behavior.service';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { TokenPerformanceService } from '../services/token-performance.service';
import { TokenPerformanceQueryDto } from '../shared/dto/token-performance-query.dto';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { RedisLockService } from '../../queues/services/redis-lock.service';
import { DashboardWalletAnalysisJobData } from '../../queues/jobs/types';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG, WALLET_CLASSIFICATIONS } from '../../config/constants';
import { JobPriority } from '../../queues/config/queue.config';
import { getKnownWallet } from '../../config/known-wallets';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';

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
 * Credit charging contract:
 * - status "ok"     → 200  → CreditInterceptor fires → 5cr deducted  ✓ data delivered
 * - status "queued" → 202  → CreditInterceptor fires → 5cr deducted  ✓ job queued, poll jobId
 * - status "skipped"→ 422  → CreditInterceptor skips → 0cr           ✓ known wallet, nothing to do
 * - already running → 202  → CreditInterceptor fires → 5cr deducted  ✓ job already in flight, poll jobId
 * - invalid address → 400  → guard rejects before handler             ✓ 0cr
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
   * Credits are charged on "ok" (data delivered) and "queued" (job accepted).
   * Never charged when returning 4xx.
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
        // HTTP 202 — CreditInterceptor fires, 5cr deducted. Job already in flight.
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
        // HTTP 202 — CreditInterceptor fires, 5cr deducted. Job already running.
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

      // HTTP 202 — CreditInterceptor fires, 5cr deducted. Job accepted.
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
   */
  @Get('wallet/:addr/hud')
  @RequireCredits(1)
  @ApiOperation({
    summary: 'Wallet HUD metrics (1cr)',
    description: 'Returns compact heads-up-display metrics: PnL signals, behavior code, win rate, data quality tier, and conditional badges (bot/whale). Backed by a 24-hour Redis cache.',
  })
  @ApiParam({ name: 'addr', description: 'Solana wallet address' })
  @ApiResponse({ status: 200, description: 'Wallet HUD metrics' })
  @ApiResponse({ status: 402, description: 'Insufficient credits or X402 payment required' })
  @ApiResponse({ status: 404, description: 'No HUD data — call GET /intel/wallet/:addr first to trigger analysis' })
  async getWalletHud(@Param('addr') addr: string) {
    this.logger.log(`Intel HUD request: ${addr}`);
    const hud = await this.walletHudService.getHud(addr);

    if (!hud) {
      throw new NotFoundException(
        `No HUD data found for wallet ${addr}. ` +
          'Call GET /api/v1/intel/wallet/:addr first — it will auto-queue analysis if the wallet is missing.',
      );
    }

    return hud;
  }
}
