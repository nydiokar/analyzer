import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CreditsService } from '../../services/credits.service';
import { X402VerificationService } from '../../services/x402-verification.service';
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user?: User;
  creditCost?: number; // Set by CreditGuard
  x402Paid?: boolean; // Set by CreditGuard when prepaid re-call (marker was 'x402')
  x402PendingTxBytes?: Buffer; // Set by CreditGuard for fresh x402 calls awaiting confirm
  x402PendingTxSig?: string; // Broadcast signature set by guard — set header sync, then confirm async
}

/**
 * CreditInterceptor deducts credits AFTER a successful response.
 *
 * - Runs AFTER the handler executes successfully
 * - Reads creditCost from request (set by CreditGuard)
 * - Deducts credits from user's balance
 * - Failed requests (errors thrown) do NOT trigger deduction
 *
 * Must be used together with CreditGuard for pre-check.
 */
@Injectable()
export class CreditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CreditInterceptor.name);

  constructor(
    private readonly creditsService: CreditsService,
    private readonly x402VerificationService: X402VerificationService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const creditCost = request.creditCost;

    // If no credit cost or no user, just pass through
    if (!creditCost || !user) {
      return next.handle();
    }

    // Fresh x402 call — sig was broadcast in the guard; set header synchronously, then
    // fire confirm+record async (response is already flushed by the time tap runs).
    const pendingTxSig = request.x402PendingTxSig;
    if (pendingTxSig) {
      const response = context.switchToHttp()
        .getResponse<{ setHeader: (k: string, v: string) => void }>();
      // Set the header NOW — before next.handle() so it is included in the response.
      response.setHeader('X-Payment-Response', pendingTxSig);
      return next.handle().pipe(
        tap({
          next: () => {
            // Fire-and-forget: confirm on-chain + replay-protect + record ledger
            this.x402VerificationService
              .confirmAndRecord(pendingTxSig, creditCost, user.id, (request as any).url)
              .catch((err) => {
                this.logger.error(
                  `x402 confirm failed post-handler: user=${user.id} sig=${pendingTxSig} err=${(err as Error).message}`,
                );
              });
            this.logger.log(
              `x402 payment response set: user=${user.id} credits=${creditCost} sig=${pendingTxSig}`,
            );
          },
        }),
      );
    }

    // Prepaid re-call — already confirmed in original call's interceptor, skip deduction
    if (request.x402Paid) {
      return next.handle();
    }

    // Execute the handler and deduct credits on success
    return next.handle().pipe(
      tap({
        next: () => {
          // Success path — deduct credits asynchronously (don't block the response)
          const route = context.getClass().name + '.' + context.getHandler().name;
          this.creditsService
            .deduct(user.id, creditCost, `endpoint:${route}`)
            .then(() => {
              this.logger.log(
                `Credits deducted: user=${user.id} -${creditCost} (${route})`,
              );
            })
            .catch((error) => {
              // This should rarely happen (guard already checked balance)
              // But log it if it does (race condition or concurrent requests)
              this.logger.error(
                `Failed to deduct credits after successful response: user=${user.id} cost=${creditCost} error=${error.message}`,
              );
            });
        },
        // On error, the tap's error callback is NOT called — we only tap 'next'
        // So failed requests will NOT deduct credits
      }),
    );
  }
}
