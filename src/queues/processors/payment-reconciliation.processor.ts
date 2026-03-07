import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Queue } from 'bullmq';
import { redisConnection } from '../config/redis.config';
import { prisma } from '../../core/services/database-service';
import { PaymentConfirmationService } from '../../api/services/payment-confirmation.service';
import { getErrorMessage } from '../../core/utils/error-utils';

const QUEUE_NAME = 'payment-reconciliation';
const JOB_NAME = 'reconcile';
/** Intents must be at least this old before the reconciler checks them (gives webhook time to arrive). */
const MIN_AGE_MINUTES = 2;
/** How often the reconciliation job runs. */
const REPEAT_EVERY_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class PaymentReconciliationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);
  private readonly queue: Queue;
  private readonly worker: Worker;

  constructor(
    private readonly paymentConfirmationService: PaymentConfirmationService,
  ) {
    this.queue = new Queue(QUEUE_NAME, { connection: redisConnection });

    this.worker = new Worker(
      QUEUE_NAME,
      async () => this.runReconciliation(),
      {
        connection: redisConnection,
        concurrency: 1,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`reconciliation job ${job?.id} failed: ${getErrorMessage(err)}`);
    });

    this.worker.on('error', (err) => {
      this.logger.error(`reconciliation worker error: ${getErrorMessage(err)}`);
    });
  }

  async onModuleInit(): Promise<void> {
    // Upsert the scheduler so there is exactly one repeating job regardless of restarts.
    await this.queue.upsertJobScheduler(
      'payment-reconciliation-scheduler',
      { every: REPEAT_EVERY_MS },
      { name: JOB_NAME },
    );
    this.logger.log('PaymentReconciliationProcessor: scheduler registered (every 5 min)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }

  private async runReconciliation(): Promise<void> {
    const now = new Date();
    const minAge = new Date(now.getTime() - MIN_AGE_MINUTES * 60 * 1000);

    const pendingIntents = await prisma.paymentIntent.findMany({
      where: {
        status: 'pending',
        createdAt: { lte: minAge },
      },
      select: { id: true, expiresAt: true },
    });

    if (pendingIntents.length === 0) return;

    this.logger.log(`reconciliation: checking ${pendingIntents.length} pending intent(s)`);

    for (const intent of pendingIntents) {
      try {
        // Expire intents past their TTL without hitting the RPC
        if (intent.expiresAt < now) {
          await this.paymentConfirmationService.expireIntent(intent.id);
          continue;
        }

        await this.paymentConfirmationService.tryConfirmByReference(intent.id);
      } catch (e) {
        this.logger.warn(
          `reconciliation: error processing intent ${intent.id}: ${getErrorMessage(e)}`,
        );
      }
    }
  }
}
