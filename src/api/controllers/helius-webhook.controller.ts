import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../shared/decorators/public.decorator';
import { MintParticipantsJobsQueue } from '../../queues/queues/mint-participants.queue';
import { DEFAULT_EXCLUDED_MINTS } from '../../config/constants';

interface EnhancedWebhookTx {
  signature: string;
  timestamp?: number;
  tokenTransfers?: Array<{
    mint: string;
    fromUserAccount?: string;
    toUserAccount?: string;
    tokenAmount?: number;
  }>;
  source?: string;
}

@Controller('integrations/helius')
export class HeliusWebhookController {
  private readonly logger = new Logger(HeliusWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jobsQueue: MintParticipantsJobsQueue,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Headers() headers: Record<string, string>, @Body() payload: any) {
    const secret = this.configService.get<string>('HELIUS_WEBHOOK_SECRET');
    if (secret) {
      const incoming = headers['x-helius-signature'] || headers['x-signature'] || headers['authorization'] || '';
      if (!incoming || incoming !== secret) {
        this.logger.warn('Invalid webhook signature');
        return { ok: true };
      }
    }

    const trackedWallet = (this.configService.get<string>('MINT_PARTICIPANTS_TRACKED_WALLET') || '').trim();
    const body = Array.isArray(payload) ? payload : (payload?.events || payload?.transactions || [payload]);
    if (!Array.isArray(body)) return { ok: true };

    for (const evt of body as EnhancedWebhookTx[]) {
      const ts = evt.timestamp || Math.floor(Date.now() / 1000);
      const buys = (evt.tokenTransfers || []).filter(tr => tr.toUserAccount === trackedWallet && typeof tr.tokenAmount === 'number' && (tr.tokenAmount as number) > 0);
      if (buys.length === 0) continue;
      for (const tr of buys) {
        const mint = tr.mint;
        
        // IMPORTANT: Excluded tokens are filtered from mint-participants analysis
        // This includes SOL/WSOL, USDC, USDT and other common tokens as defined in DEFAULT_EXCLUDED_MINTS
        // Mint-participants analysis only works with SPL tokens, not system/native tokens
        // If you need to support these tokens in the future, update DEFAULT_EXCLUDED_MINTS in constants.ts
        if (DEFAULT_EXCLUDED_MINTS.includes(mint)) {
          this.logger.debug(`Skipping mint-participants analysis for excluded token: ${mint}`);
          continue; // Skip excluded tokens at the source
        }
        
        await this.jobsQueue.enqueueRun({
          mint,
          cutoffTs: ts,
          signature: evt.signature,
        });
      }
    }

    return { ok: true };
  }
}


