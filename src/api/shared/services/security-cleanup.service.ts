import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtDatabaseService } from './jwt-database.service';
import { AdvancedThrottlerService } from './advanced-throttler.service';
import { CompositeAuthGuard } from '../guards/composite-auth.guard';

@Injectable()
export class SecurityCleanupService implements OnModuleInit {
  private readonly logger = new Logger(SecurityCleanupService.name);
  private compositeAuthGuard: CompositeAuthGuard | null = null;

  constructor(
    private readonly jwtDatabaseService: JwtDatabaseService,
    private readonly advancedThrottlerService: AdvancedThrottlerService,
  ) {}

  onModuleInit() {
    this.logger.log('Security cleanup service initialized');
  }

  // Set the composite auth guard reference (called from module initialization)
  setCompositeAuthGuard(guard: CompositeAuthGuard) {
    this.compositeAuthGuard = guard;
  }

  // Clean up expired email verification tokens every hour
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredTokens() {
    try {
      await this.jwtDatabaseService.cleanupExpiredVerificationTokens();
    } catch (error) {
      this.logger.error('Failed to cleanup expired verification tokens', error);
    }
  }

  // Clean authentication caches and throttler data every 30 minutes
  @Cron('0 */30 * * * *') // Every 30 minutes
  async cleanupAuthCaches() {
    try {
      if (this.compositeAuthGuard) {
        // The composite guard now has automatic cache cleanup on access
        this.logger.debug('Authentication caches are cleaned automatically on access');
      }
      
      // Clean up advanced throttler data
      this.advancedThrottlerService.cleanup();
    } catch (error) {
      this.logger.error('Failed to cleanup auth caches', error);
    }
  }

  // Security audit log - track cache performance (every 6 hours)
  @Cron('0 0 */6 * * *') // Every 6 hours
  async logSecurityMetrics() {
    try {
      this.logger.log('Security cleanup service is running periodic maintenance');
      
      // Log throttler security stats
      const stats = this.advancedThrottlerService.getSecurityStats();
      this.logger.log(`Security stats: ${stats.blockedIps} blocked IPs, ${stats.recentEvents} recent events`, {
        topViolatingIps: stats.topViolatingIps,
      });
    } catch (error) {
      this.logger.error('Failed to log security metrics', error);
    }
  }

  // Emergency method to clear all caches (can be called via API endpoint)
  async emergencyClearAllCaches() {
    try {
      if (this.compositeAuthGuard) {
        this.compositeAuthGuard.clearAllCaches();
        this.logger.warn('SECURITY: All authentication caches cleared via emergency action');
      }
    } catch (error) {
      this.logger.error('Failed to emergency clear caches', error);
      throw error;
    }
  }
}