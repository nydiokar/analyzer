import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentService } from '../services/payment.service';
import { Public } from '../shared/decorators/public.decorator';

const USDC_PER_CREDIT = 0.015;
const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

type PricingCategory = 'intel';

interface PricingEndpoint {
  path: string;
  method: 'GET' | 'POST';
  credits: number;
  usdEquivalent: number;
  description: string;
  category: PricingCategory;
  status: 'active' | 'planned';
  changedFromCredits?: number;
}

@ApiTags('Pricing')
@Controller()
export class PricingController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('pricing')
  @Public()
  @ApiOperation({ summary: 'Public pricing map for external Intel API endpoints' })
  @ApiResponse({ status: 200, description: 'Pricing metadata' })
  async getPricing() {
    const endpoints: PricingEndpoint[] = [
      {
        path: '/intel/wallet/:addr',
        method: 'GET',
        credits: 5,
        usdEquivalent: this.toUsd(5),
        description: 'Aggregated wallet intel response (summary + HUD + behavior + PnL).',
        category: 'intel',
        status: 'active',
      },
      {
        path: '/intel/wallet/:addr/tokens',
        method: 'GET',
        credits: 3,
        usdEquivalent: this.toUsd(3),
        description: 'Paginated token-level wallet performance data.',
        category: 'intel',
        status: 'active',
      },
      {
        path: '/intel/token/:mint/holders',
        method: 'POST',
        credits: 20,
        usdEquivalent: this.toUsd(20),
        description: 'Holder-profiles only endpoint for top token holders (no bundled similarity).',
        category: 'intel',
        status: 'active',
        changedFromCredits: 35,
      },
      {
        path: '/intel/wallets/similarity',
        method: 'POST',
        credits: 20,
        usdEquivalent: this.toUsd(20),
        description: 'Standalone wallet similarity endpoint for 2-30 wallets.',
        category: 'intel',
        status: 'active',
      },
      {
        path: '/intel/token/:mint/holders/deep',
        method: 'POST',
        credits: 35,
        usdEquivalent: this.toUsd(35),
        description: 'Bundled holders + similarity queueing endpoint (discounted vs separate calls).',
        category: 'intel',
        status: 'active',
      },
      {
        path: '/intel/wallet/:addr/hud',
        method: 'GET',
        credits: 1,
        usdEquivalent: this.toUsd(1),
        description: 'Lightweight HUD-only wallet endpoint.',
        category: 'intel',
        status: 'active',
      },
      {
        path: '/intel/wallets/batch-hud',
        method: 'POST',
        credits: 5,
        usdEquivalent: this.toUsd(5),
        description: 'Batch HUD endpoint for up to 30 wallets.',
        category: 'intel',
        status: 'active',
      },
    ];

    const packs = await this.paymentService
      .listPacks()
      .then((rows) =>
        rows.map((pack) => ({
          name: pack.name,
          credits: pack.credits,
          priceUsdc: pack.priceUsdc,
          perCreditUsdc: Number((pack.priceUsdc / pack.credits).toFixed(6)),
        })),
      )
      .catch(() => [
        { name: 'Starter', credits: 1000, priceUsdc: 15, perCreditUsdc: 0.015 },
        { name: 'Builder', credits: 10000, priceUsdc: 120, perCreditUsdc: 0.012 },
        { name: 'Pro', credits: 100000, priceUsdc: 900, perCreditUsdc: 0.009 },
      ]);

    return {
      version: 'v1',
      generatedAt: new Date().toISOString(),
      endpoints,
      packs,
      x402: {
        usdcPerCredit: USDC_PER_CREDIT,
        usdcMint: process.env.USDC_MINT ?? DEFAULT_USDC_MINT,
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      },
    };
  }

  private toUsd(credits: number): number {
    return Number((credits * USDC_PER_CREDIT).toFixed(3));
  }
}
