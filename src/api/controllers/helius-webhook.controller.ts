import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../shared/decorators/public.decorator';
import { MintParticipantsJobsQueue } from '../../queues/queues/mint-participants.queue';
import { PaymentConfirmationService } from '../services/payment-confirmation.service';

interface EnhancedWebhookTx {
  signature: string;
  timestamp?: number;
  tokenTransfers?: Array<{
    mint: string;
    fromUserAccount?: string;
    toUserAccount?: string;
    tokenAmount?: number;
  }>;
  accountData?: Array<{ account: string }>;
  source?: string;
}

@Controller('integrations/helius')
export class HeliusWebhookController {
  private readonly logger = new Logger(HeliusWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jobsQueue: MintParticipantsJobsQueue,
    private readonly paymentConfirmationService: PaymentConfirmationService,
  ) {}

  // NOTE: mint-participants processing is disabled. Handler is kept as a no-op so any
  // registered Helius webhook doesn't 404. Re-enable by restoring the body when needed.
  @Public()
  @Post('webhook')
  @HttpCode(200)
  handleWebhook() {
    return { ok: true };
  }

  @Public()
  @Post('payment-webhook')
  @HttpCode(200)
  async handlePaymentWebhook(
    @Headers() headers: Record<string, string>,
    @Body() payload: any,
  ) {
    const secret = this.configService.get<string>('HELIUS_PAYMENT_WEBHOOK_SECRET');
    if (secret) {
      const incoming =
        headers['x-helius-signature'] ||
        headers['x-signature'] ||
        headers['authorization'] ||
        '';
      if (!incoming || incoming !== secret) {
        this.logger.warn('payment-webhook: invalid signature — ignoring');
        return { ok: true };
      }
    }

    const txs: EnhancedWebhookTx[] = Array.isArray(payload)
      ? payload
      : payload?.events || payload?.transactions || [payload];

    if (!Array.isArray(txs)) return { ok: true };

    for (const tx of txs) {
      if (!tx.signature) continue;

      // Collect all account keys present in the transaction.
      // Helius Enhanced Transactions expose them in `accountData[].account`.
      const accounts: string[] = (tx.accountData ?? []).map(
        (a: { account: string }) => a.account,
      );

      await this.paymentConfirmationService
        .tryConfirmByAccounts(tx.signature, accounts, tx.tokenTransfers ?? [])
        .catch((e) =>
          this.logger.warn(`payment-webhook: confirm failed for ${tx.signature}: ${e.message}`),
        );
    }

    return { ok: true };
  }
}


