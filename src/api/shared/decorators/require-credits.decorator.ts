import { SetMetadata } from '@nestjs/common';

export const CREDITS_REQUIRED_KEY = 'creditsRequired';

/**
 * Decorator to specify how many credits are required for an endpoint.
 *
 * Usage:
 *   @RequireCredits(5)
 *   async getBehaviorAnalysis() { ... }
 *
 * The CreditGuard will check balance before execution and deduct after success.
 * Failed requests do NOT consume credits.
 */
export const RequireCredits = (amount: number) => SetMetadata(CREDITS_REQUIRED_KEY, amount);
