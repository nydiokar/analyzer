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
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user?: User;
  creditCost?: number; // Set by CreditGuard
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

  constructor(private readonly creditsService: CreditsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const creditCost = request.creditCost;

    // If no credit cost or no user, just pass through
    if (!creditCost || !user) {
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
