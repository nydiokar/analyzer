import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CREDITS_REQUIRED_KEY } from '../decorators/require-credits.decorator';
import { CreditsService } from '../../services/credits.service';
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user?: User;
  creditCost?: number; // Store for interceptor
}

/**
 * CreditGuard checks if a user has enough credits to execute the endpoint.
 *
 * - Runs BEFORE the handler executes
 * - Reads @RequireCredits metadata
 * - Checks user's credit balance
 * - Throws HTTP 402 if insufficient
 * - Does NOT deduct yet — the interceptor deducts after success
 *
 * Must be used together with CreditInterceptor for post-deduction.
 */
@Injectable()
export class CreditGuard implements CanActivate {
  private readonly logger = new Logger(CreditGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly creditsService: CreditsService,
  ) {}

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

    if (!user) {
      this.logger.warn(
        'CreditGuard: No user found on request (auth guard should have run first)',
      );
      throw new HttpException(
        'Authentication required for credit-gated endpoints',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Check balance
    const { credits: currentBalance } = await this.creditsService.getBalance(user.id);

    if (currentBalance < requiredCredits) {
      this.logger.warn(
        `Insufficient credits: user=${user.id} has ${currentBalance}, needs ${requiredCredits}`,
      );
      throw new HttpException(
        {
          error: 'insufficient_credits',
          balance: currentBalance,
          required: requiredCredits,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Store the cost on the request for the interceptor to deduct later
    request.creditCost = requiredCredits;

    this.logger.debug(
      `Credit check passed: user=${user.id} balance=${currentBalance} required=${requiredCredits}`,
    );
    return true;
  }
}
