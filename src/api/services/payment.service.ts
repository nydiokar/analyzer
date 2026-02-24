import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { encodeURL } from '@solana/pay';
import BigNumber from 'bignumber.js';
import QRCode from 'qrcode';
import { prisma } from '../../core/services/database-service';
import { getErrorMessage } from '../../core/utils/error-utils';

export interface CreditPackDto {
  id: string;
  name: string;
  credits: number;
  priceUsdc: number;
}

export interface CheckoutResponseDto {
  id: string;
  solanaPayUrl: string;
  qrCodeDataUrl: string;
  expiresAt: string;
  amountUsdc: number;
  credits: number;
}

export interface PaymentStatusDto {
  status: 'pending' | 'confirmed' | 'expired';
  phase: string;
  message: string;
  confirmedAt?: string;
  txSignature?: string;
}

const INTENT_TTL_MINUTES = 30;
const USDC_DECIMALS = 6;
// Mainnet USDC mint — override via USDC_MINT env var
const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly treasuryWallet: string;
  private readonly usdcMint: string;

  constructor(private readonly configService: ConfigService) {
    const treasury = this.configService.get<string>('TREASURY_WALLET_ADDRESS');
    if (!treasury) {
      this.logger.warn(
        'TREASURY_WALLET_ADDRESS is not set — checkout endpoint will throw until configured',
      );
    }
    this.treasuryWallet = treasury ?? '';
    this.usdcMint = this.configService.get<string>('USDC_MINT') ?? DEFAULT_USDC_MINT;
  }

  async listPacks(): Promise<CreditPackDto[]> {
    const packs = await prisma.creditPack.findMany({
      where: { active: true },
      orderBy: { priceUsdc: 'asc' },
    });
    return packs.map((p) => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      priceUsdc: p.priceUsdc,
    }));
  }

  async checkout(userId: string, packId: string): Promise<CheckoutResponseDto> {
    if (!this.treasuryWallet) {
      throw new BadRequestException(
        'Payment system not configured: TREASURY_WALLET_ADDRESS is missing',
      );
    }

    const pack = await prisma.creditPack.findUnique({ where: { id: packId } });
    if (!pack || !pack.active) {
      throw new NotFoundException(`Credit pack not found: ${packId}`);
    }

    // Each intent gets a unique reference keypair — @solana/pay uses this to find the tx
    const reference = Keypair.generate();
    const referencePublicKey = reference.publicKey.toBase58();

    const recipient = new PublicKey(this.treasuryWallet);
    const splToken = new PublicKey(this.usdcMint);
    const referenceKey = new PublicKey(referencePublicKey);
    const amount = new BigNumber(pack.priceUsdc);
    const memo = `sova:${packId}`;

    const solanaPayUrl = encodeURL({
      recipient,
      amount,
      splToken,
      reference: referenceKey,
      label: 'Sova Intel',
      message: `${pack.name} — ${pack.credits.toLocaleString()} credits`,
      memo,
    }).toString();

    const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60 * 1000);

    const intent = await prisma.paymentIntent.create({
      data: {
        userId,
        packId,
        credits: pack.credits,
        amountUsdc: pack.priceUsdc,
        status: 'pending',
        solanaPayUrl,
        destinationWallet: this.treasuryWallet,
        reference: referencePublicKey,
        expiresAt,
      },
    });

    const qrCodeDataUrl = await QRCode.toDataURL(solanaPayUrl, {
      errorCorrectionLevel: 'M',
      width: 512,
    });

    this.logger.log(
      `checkout: user=${userId} pack=${pack.name} amount=$${pack.priceUsdc} intent=${intent.id}`,
    );

    return {
      id: intent.id,
      solanaPayUrl,
      qrCodeDataUrl,
      expiresAt: expiresAt.toISOString(),
      amountUsdc: pack.priceUsdc,
      credits: pack.credits,
    };
  }

  async getStatus(intentId: string, userId: string): Promise<PaymentStatusDto> {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.userId !== userId) {
      throw new NotFoundException(`Payment intent not found: ${intentId}`);
    }

    // Auto-expire stale pending intents on read
    if (intent.status === 'pending' && intent.expiresAt < new Date()) {
      await prisma.paymentIntent.update({
        where: { id: intentId },
        data: { status: 'expired' },
      }).catch((e) =>
        this.logger.warn(`Failed to mark intent expired: ${getErrorMessage(e)}`),
      );
      return { status: 'expired', phase: 'expired', message: 'Payment window expired — start a new checkout' };
    }

    const STATUS_MAP: Record<string, PaymentStatusDto> = {
      pending:   { status: 'pending',   phase: 'waiting',   message: 'Scan QR code with Phantom or Solflare' },
      confirmed: { status: 'confirmed', phase: 'confirmed', message: 'Payment confirmed — credits added to your account', confirmedAt: intent.confirmedAt?.toISOString(), txSignature: intent.txSignature ?? undefined },
      expired:   { status: 'expired',   phase: 'expired',   message: 'Payment window expired — start a new checkout' },
    };

    return STATUS_MAP[intent.status] ?? { status: 'pending', phase: 'waiting', message: 'Scan QR code with Phantom or Solflare' };
  }
}
