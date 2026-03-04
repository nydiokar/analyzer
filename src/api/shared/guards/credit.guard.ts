import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { CREDITS_REQUIRED_KEY } from '../decorators/require-credits.decorator';
import { CreditsService } from '../../services/credits.service';
import { X402VerificationService } from '../../services/x402-verification.service';
import { User } from '@prisma/client';

const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_PER_CREDIT = 0.015;
const USDC_DECIMALS = 6;
const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

interface AuthenticatedRequest extends Request {
  user?: User;
  creditCost?: number;
  x402Paid?: boolean;
}

/**
 * CreditGuard checks if a user has enough credits to execute the endpoint.
 *
 * Extended to support X402 autonomous agent payments (x402 v2):
 * - PAYMENT-SIGNATURE header present → verify on-chain tx via X402VerificationService
 * - PAYMENT-SIGNATURE absent + insufficient credits → return 402 with PAYMENT-REQUIRED header
 * - PAYMENT-SIGNATURE absent + sufficient credits → existing behavior (store creditCost on request)
 *
 * Must be used together with CreditInterceptor for post-deduction.
 */
@Injectable()
export class CreditGuard implements CanActivate {
  private readonly logger = new Logger(CreditGuard.name);
  private readonly usdcMint: string;
  private readonly treasury: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly creditsService: CreditsService,
    private readonly x402VerificationService: X402VerificationService,
    configService: ConfigService,
  ) {
    this.usdcMint = configService.get<string>('USDC_MINT') ?? DEFAULT_USDC_MINT;
    this.treasury = configService.get<string>('TREASURY_WALLET_ADDRESS') ?? '';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredCredits = this.reflector.getAllAndOverride<number | undefined>(
      CREDITS_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequireCredits decorator → allow through
    if (requiredCredits === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    const headers = request.headers as unknown as Record<string, string>;
    const paymentHeader = headers['payment-signature'] ?? headers['x-payment'];

    // No user = unauthenticated x402 discovery request (CompositeAuthGuard allowed it through).
    // Return the 402 with PAYMENT-REQUIRED header so the agent knows what to pay.
    if (!user && !paymentHeader) {
      return this.throwPaymentRequired(requiredCredits, (request as any).url, context);
    }

    if (!user) {
      // Payment header present but CompositeAuthGuard somehow didn't set user — shouldn't happen
      this.logger.warn('CreditGuard: payment header present but no user on request');
      throw new HttpException('Authentication required', HttpStatus.UNAUTHORIZED);
    }

    // --- X402 path: agent supplied a signed transaction ---
    if (paymentHeader) {
      const txSig = await this.x402VerificationService.verify(
        paymentHeader,
        requiredCredits,
        user.id,
        (request as any).url,
      );
      request.x402Paid = true;
      request.creditCost = requiredCredits;
      const response = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
      response.setHeader('X-Payment-Response', txSig);
      this.logger.log(`x402 payment verified: user=${user.id} credits=${requiredCredits}`);
      return true;
    }

    // --- Standard path: check credit balance ---
    const { credits: currentBalance } = await this.creditsService.getBalance(user.id);

    if (currentBalance < requiredCredits) {
      this.logger.warn(
        `Insufficient credits: user=${user.id} has ${currentBalance}, needs ${requiredCredits}`,
      );
      return this.throwPaymentRequired(requiredCredits, (request as any).url, context);
    }

    // Sufficient credits — store cost for interceptor
    request.creditCost = requiredCredits;

    this.logger.debug(
      `Credit check passed: user=${user.id} balance=${currentBalance} required=${requiredCredits}`,
    );
    return true;
  }

  private throwPaymentRequired(requiredCredits: number, resourceUrl: string, context: ExecutionContext): never {
    const amountBaseUnits = Math.ceil(
      requiredCredits * USDC_PER_CREDIT * Math.pow(10, USDC_DECIMALS),
    );
    const paymentRequired = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: SOLANA_MAINNET_CAIP2,
          asset: this.usdcMint,
          amount: String(amountBaseUnits),
          payTo: this.treasury,
          maxTimeoutSeconds: 60,
          resource: resourceUrl,
          description: 'Sova Intel API',
          mimeType: 'application/json',
          extra: {},
        },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
    const response = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
    response.setHeader('PAYMENT-REQUIRED', encoded);
    throw new HttpException(
      { error: 'Payment required', required: requiredCredits },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
