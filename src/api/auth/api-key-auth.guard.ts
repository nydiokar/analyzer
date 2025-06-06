import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);
  private readonly demoApiKey: string;
  private readonly demoWallets: string[];

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService, // Inject ConfigService
  ) {
    // Load demo configuration from environment variables via ConfigService
    this.demoApiKey = this.configService.get<string>('DEMO_API_KEY');
    const demoWalletsFromEnv = this.configService.get<string>('DEMO_WALLETS');

    if (demoWalletsFromEnv) {
      this.demoWallets = demoWalletsFromEnv.split(',').map(w => w.trim());
    } else {
      this.demoWallets = []; // No hardcoded fallback for wallets
    }

    if (this.demoApiKey) {
      this.logger.log('Successfully loaded Demo API Key.');
    } else {
      this.logger.warn('DEMO_API_KEY is not set in environment variables. Demo access will be disabled.');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing.');
    }

    // --- Demo Key Logic ---
    if (this.demoApiKey && apiKey === this.demoApiKey) {
      const walletAddress = request.params.walletAddress;

      // RULE 1: Demo key CANNOT be used to trigger a new analysis.
      if (request.path.includes('/trigger-analysis') || request.method === 'POST') {
          this.logger.warn(`Demo key blocked from attempting a write/trigger action on path: ${request.path}`);
          throw new ForbiddenException('The demo API key is read-only and cannot trigger new analyses.');
      }

      // RULE 2: If the request targets a specific wallet, it MUST be a demo wallet.
      if (walletAddress && !this.demoWallets.includes(walletAddress)) {
        this.logger.warn(`Demo key used for non-demo wallet attempt: ${walletAddress}`);
        throw new ForbiddenException('This API key can only be used with demo wallets.');
      }
      
      this.logger.verbose(`Demo access granted for wallet: ${walletAddress || 'general endpoint'}`);
      request.user = { id: 'demo-user', isDemo: true };
      return true;
    }

    // --- Standard Key Logic ---
    try {
      const user = await this.databaseService.validateApiKey(apiKey);
      if (!user) {
        this.logger.warn(`Invalid or inactive API key used: ${apiKey.substring(0, 5)}...`);
        throw new UnauthorizedException('Invalid or inactive API key.');
      }
      request.user = user;
      this.logger.verbose(`User ${user.id} authenticated successfully.`);
      return true;
    } catch (error) {
      this.logger.error('Error during standard API key validation:', error);
      // Re-throw the original error if it's a known HTTP exception
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      // Otherwise, throw a generic one
      throw new UnauthorizedException('An error occurred during authentication.');
    }
  }
} 