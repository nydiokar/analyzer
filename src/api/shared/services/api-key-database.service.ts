import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../services/database.service';

/**
 * Pure data access layer for API keys
 *
 * Responsibilities:
 * - Database CRUD operations for API keys
 * - JSON serialization/deserialization for scopes
 * - NO business logic (validation, hashing, etc.)
 *
 * Design Principles:
 * - Single Responsibility: Only handles database operations
 * - Separation of Concerns: Business logic stays in ApiKeyService
 * - Domain-Driven Design: Clear boundary between API key and JWT domains
 */
@Injectable()
export class ApiKeyDatabaseService {
  private readonly logger = new Logger(ApiKeyDatabaseService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new API key record in the database
   */
  async createApiKey(data: {
    prefix: string;
    keyHash: string;
    userId: string;
    description: string;
    scopes: string[];
    isActive: boolean;
    expiresAt?: Date;
  }): Promise<any> {
    this.logger.debug(`Creating API key with prefix: ${data.prefix} for user: ${data.userId}`);

    const record = await (this.databaseService as any).prismaClient.apiKey.create({
      data: {
        prefix: data.prefix,
        keyHash: data.keyHash,
        userId: data.userId,
        description: data.description,
        scopes: JSON.stringify(data.scopes),
        isActive: data.isActive,
        expiresAt: data.expiresAt,
      },
    });

    // Parse scopes back to array for return
    return {
      ...record,
      scopes: JSON.parse(record.scopes || '[]'),
    };
  }

  /**
   * Find API key by prefix (used during authentication)
   */
  async findApiKeyByPrefix(prefix: string): Promise<any | null> {
    this.logger.debug(`Looking up API key by prefix: ${prefix}`);

    const key = await (this.databaseService as any).prismaClient.apiKey.findFirst({
      where: { prefix },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            isDemo: true,
            isActive: true,
          },
        },
      },
    });

    if (!key) {
      return null;
    }

    return {
      ...key,
      scopes: JSON.parse(key.scopes || '[]'),
    };
  }

  /**
   * Find API key by ID
   */
  async findApiKeyById(keyId: string): Promise<any | null> {
    this.logger.debug(`Looking up API key by ID: ${keyId}`);

    const key = await (this.databaseService as any).prismaClient.apiKey.findUnique({
      where: { id: keyId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            description: true,
          },
        },
      },
    });

    if (!key) {
      return null;
    }

    return {
      ...key,
      scopes: JSON.parse(key.scopes || '[]'),
    };
  }

  /**
   * Find all API keys for a specific user
   */
  async findApiKeysByUserId(userId: string): Promise<any[]> {
    this.logger.debug(`Fetching API keys for user: ${userId}`);

    const keys = await (this.databaseService as any).prismaClient.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map(key => ({
      ...key,
      scopes: JSON.parse(key.scopes || '[]'),
    }));
  }

  /**
   * Find all API keys with user information (admin operation)
   */
  async findAllApiKeysWithUsers(): Promise<any[]> {
    this.logger.debug('Fetching all API keys with user information');

    const keys = await (this.databaseService as any).prismaClient.apiKey.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map(key => ({
      ...key,
      scopes: JSON.parse(key.scopes || '[]'),
      userEmail: key.user?.email,
      userDescription: key.user?.description,
    }));
  }

  /**
   * Update the last used timestamp for an API key
   */
  async updateApiKeyLastUsed(keyId: string): Promise<void> {
    this.logger.debug(`Updating last used timestamp for API key: ${keyId}`);

    await (this.databaseService as any).prismaClient.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Update API key active status (revoke/reactivate)
   */
  async updateApiKeyStatus(keyId: string, isActive: boolean): Promise<void> {
    this.logger.debug(`Updating API key ${keyId} status to: ${isActive ? 'active' : 'revoked'}`);

    await (this.databaseService as any).prismaClient.apiKey.update({
      where: { id: keyId },
      data: { isActive },
    });
  }

  /**
   * Update API key metadata (description and/or scopes)
   */
  async updateApiKeyMetadata(
    keyId: string,
    updates: { description?: string; scopes?: string[] }
  ): Promise<void> {
    this.logger.debug(`Updating API key ${keyId} metadata`);

    const updateData: any = {};

    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }

    if (updates.scopes !== undefined) {
      updateData.scopes = JSON.stringify(updates.scopes);
    }

    await (this.databaseService as any).prismaClient.apiKey.update({
      where: { id: keyId },
      data: updateData,
    });
  }

  /**
   * Delete an API key permanently
   */
  async deleteApiKeyById(keyId: string): Promise<any> {
    this.logger.log(`Permanently deleting API key: ${keyId}`);

    const deletedKey = await (this.databaseService as any).prismaClient.apiKey.delete({
      where: { id: keyId },
    });

    return {
      ...deletedKey,
      scopes: JSON.parse(deletedKey.scopes || '[]'),
    };
  }

  /**
   * Delete all expired API keys (maintenance operation)
   */
  async deleteExpiredApiKeys(): Promise<number> {
    this.logger.log('Deleting expired API keys');

    const result = await (this.databaseService as any).prismaClient.apiKey.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    this.logger.log(`Deleted ${result.count} expired API keys`);
    return result.count;
  }

  /**
   * Count active API keys for a user
   */
  async countActiveApiKeysByUserId(userId: string): Promise<number> {
    return await (this.databaseService as any).prismaClient.apiKey.count({
      where: {
        userId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
  }
}
