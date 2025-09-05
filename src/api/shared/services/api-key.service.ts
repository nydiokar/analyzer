import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtDatabaseService } from './jwt-database.service';

export type ApiKeyScope = 'read' | 'report' | 'analysis' | 'admin' | 'full';

export interface ApiKey {
  id: string;
  prefix: string;
  keyHash: string;
  userId: string;
  description: string;
  scopes: ApiKeyScope[];
  isActive: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface CreateApiKeyRequest {
  userId: string;
  description: string;
  scopes: ApiKeyScope[];
  expiresInDays?: number;
}

export interface ApiKeyValidationResult {
  isValid: boolean;
  user?: any;
  scopes?: ApiKeyScope[];
  keyInfo?: Partial<ApiKey>;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly API_KEY_SALT_ROUNDS = 10;

  constructor(
    private readonly databaseService: JwtDatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a new API key with prefix and scope support
   */
  async createApiKey(request: CreateApiKeyRequest): Promise<{ apiKey: string; keyInfo: Omit<ApiKey, 'keyHash'> }> {
    const prefix = this.generatePrefix();
    const secret = this.generateSecret();
    const apiKey = `${prefix}_${secret}`;
    
    // Hash the full key for storage
    const keyHash = await this.hashApiKey(apiKey);
    
    // Calculate expiration if specified
    const expiresAt = request.expiresInDays 
      ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    // Create database record
    const keyRecord = await this.databaseService.createApiKey({
      prefix,
      keyHash,
      userId: request.userId,
      description: request.description,
      scopes: request.scopes,
      isActive: true,
      expiresAt,
    });

    this.logger.log(`Created API key for user ${request.userId}: ${prefix}***`);

    return {
      apiKey,
      keyInfo: {
        id: keyRecord.id,
        prefix,
        userId: keyRecord.userId,
        description: keyRecord.description,
        scopes: keyRecord.scopes,
        isActive: keyRecord.isActive,
        expiresAt: keyRecord.expiresAt,
        createdAt: keyRecord.createdAt,
      }
    };
  }

  /**
   * Validate API key and return user context with scopes
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    if (!apiKey || typeof apiKey !== 'string') {
      return { isValid: false };
    }

    try {
      // Extract prefix for efficient lookup
      const prefix = this.extractPrefix(apiKey);
      if (!prefix) {
        this.logger.warn('API key without valid prefix attempted');
        return { isValid: false };
      }

      // Find key by prefix first (more efficient than checking all keys)
      const keyRecord = await this.databaseService.findApiKeyByPrefix(prefix);
      if (!keyRecord) {
        this.logger.warn(`API key not found for prefix: ${prefix}`);
        return { isValid: false };
      }

      // Check if key is active and not expired
      if (!keyRecord.isActive) {
        this.logger.warn(`Inactive API key attempted: ${prefix}***`);
        return { isValid: false };
      }

      if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
        this.logger.warn(`Expired API key attempted: ${prefix}***`);
        return { isValid: false };
      }

      // Verify the full key hash
      const isValidKey = await this.verifyApiKey(apiKey, keyRecord.keyHash);
      if (!isValidKey) {
        this.logger.warn(`Invalid API key hash for prefix: ${prefix}***`);
        return { isValid: false };
      }

      // Get user information
      const user = await this.databaseService.findActiveUserById(keyRecord.userId);
      if (!user) {
        this.logger.warn(`API key user not found or inactive: ${keyRecord.userId}`);
        return { isValid: false };
      }

      // Update last used timestamp
      await this.databaseService.updateApiKeyLastUsed(keyRecord.id);

      return {
        isValid: true,
        user,
        scopes: keyRecord.scopes,
        keyInfo: {
          id: keyRecord.id,
          prefix: keyRecord.prefix,
          description: keyRecord.description,
          scopes: keyRecord.scopes,
          lastUsedAt: new Date(),
        }
      };

    } catch (error) {
      this.logger.error('Error validating API key:', error);
      return { isValid: false };
    }
  }

  /**
   * Check if API key has required scope
   */
  hasScope(userScopes: ApiKeyScope[] | undefined, requiredScope: ApiKeyScope): boolean {
    if (!userScopes) {
      return false;
    }

    // 'full' and 'admin' scopes grant access to everything
    if (userScopes.includes('full') || userScopes.includes('admin')) {
      return true;
    }

    return userScopes.includes(requiredScope);
  }

  /**
   * List API keys for a user
   */
  async listUserApiKeys(userId: string): Promise<Omit<ApiKey, 'keyHash'>[]> {
    const keys = await this.databaseService.findApiKeysByUserId(userId);
    
    return keys.map(key => ({
      id: key.id,
      prefix: key.prefix,
      keyHash: '[REDACTED]',
      userId: key.userId,
      description: key.description,
      scopes: key.scopes,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    }));
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const keyRecord = await this.databaseService.findApiKeyById(keyId);
    
    if (!keyRecord) {
      throw new NotFoundException('API key not found');
    }

    if (keyRecord.userId !== userId) {
      throw new UnauthorizedException('Cannot revoke API key belonging to another user');
    }

    await this.databaseService.updateApiKeyStatus(keyId, false);
    this.logger.log(`Revoked API key: ${keyRecord.prefix}*** for user ${userId}`);
  }

  /**
   * Update API key metadata
   */
  async updateApiKey(userId: string, keyId: string, updates: { description?: string; scopes?: ApiKeyScope[] }): Promise<void> {
    const keyRecord = await this.databaseService.findApiKeyById(keyId);
    
    if (!keyRecord) {
      throw new NotFoundException('API key not found');
    }

    if (keyRecord.userId !== userId) {
      throw new UnauthorizedException('Cannot update API key belonging to another user');
    }

    await this.databaseService.updateApiKeyMetadata(keyId, updates);
    this.logger.log(`Updated API key: ${keyRecord.prefix}*** for user ${userId}`);
  }

  /**
   * Cleanup expired API keys
   */
  async cleanupExpiredKeys(): Promise<number> {
    const deletedCount = await this.databaseService.deleteExpiredApiKeys();
    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} expired API keys`);
    }
    return deletedCount;
  }

  private generatePrefix(): string {
    const environment = this.configService.get<string>('NODE_ENV') === 'production' ? 'live' : 'test';
    return `ak_${environment}`;
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private extractPrefix(apiKey: string): string | null {
    const parts = apiKey.split('_');
    if (parts.length >= 2 && parts[0] === 'ak') {
      return `${parts[0]}_${parts[1]}`;
    }
    return null;
  }

  private async hashApiKey(apiKey: string): Promise<string> {
    try {
      return await bcrypt.hash(apiKey, this.API_KEY_SALT_ROUNDS);
    } catch (error) {
      this.logger.error('Failed to hash API key', error);
      throw new UnauthorizedException('API key processing failed');
    }
  }

  private async verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(apiKey, hash);
    } catch (error) {
      this.logger.error('Failed to verify API key', error);
      return false;
    }
  }
}