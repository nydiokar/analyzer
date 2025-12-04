import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { User } from '@prisma/client';
import { DatabaseService } from '../../services/database.service';

@Injectable()
export class JwtDatabaseService {
  private readonly logger = new Logger(JwtDatabaseService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async findUserByEmail(email: string): Promise<User | null> {
    try {
      return await (this.databaseService as any).prismaClient.user.findUnique({
        where: { email },
      });
    } catch (error) {
      this.logger.debug(`Database query failed for email lookup: ${email}`);
      return null;
    }
  }

  async findUserByDisplayName(displayName: string): Promise<User | null> {
    try {
      return await (this.databaseService as any).prismaClient.user.findUnique({
        where: { displayName },
      });
    } catch (error) {
      this.logger.debug(`Database query failed for display name lookup: ${displayName}`);
      return null;
    }
  }

  async findActiveUserById(userId: string): Promise<User | null> {
    try {
      // Use findFirst with filter on isActive; Prisma findUnique cannot include non-unique fields
      return await (this.databaseService as any).prismaClient.user.findFirst({
        where: {
          id: userId,
          isActive: true,
        },
      });
    } catch (error) {
      this.logger.debug(`Database query failed for active user lookup: ${userId}`);
      return null;
    }
  }

  async createUserWithJWT(userData: {
    email: string;
    passwordHash: string;
    apiKey: string;
    description?: string;
    isDemo: boolean;
    emailVerified: boolean;
    isActive: boolean;
    displayName?: string;
  }): Promise<User> {
    return await (this.databaseService as any).prismaClient.user.create({
      data: userData,
    });
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    await (this.databaseService as any).prismaClient.user.update({
      where: { id: userId },
      data: { 
        lastLoginAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  }

  async updateUserLastSeen(userId: string): Promise<void> {
    await (this.databaseService as any).prismaClient.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  }

  async findUserById(userId: string): Promise<User | null> {
    try {
      return await (this.databaseService as any).prismaClient.user.findUnique({
        where: { id: userId },
      });
    } catch (error) {
      this.logger.debug(`Database query failed for user ID lookup: ${userId}`);
      return null;
    }
  }

  async updateUserEmailVerification(userId: string, emailVerified: boolean): Promise<void> {
    await (this.databaseService as any).prismaClient.user.update({
      where: { id: userId },
      data: { emailVerified },
    });
  }

  // Delegate API key validation to the existing service
  async validateApiKey(apiKey: string): Promise<User | null> {
    return await this.databaseService.validateApiKey(apiKey);
  }

  // Email verification token methods
  async createVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    await (this.databaseService as any).prismaClient.emailVerificationToken.create({
      data: {
        userId,
        token: hashed,
        expiresAt,
      },
    });
  }

  async findValidVerificationToken(userId: string, token: string): Promise<any> {
    try {
      const hashed = crypto.createHash('sha256').update(token).digest('hex');
      return await (this.databaseService as any).prismaClient.emailVerificationToken.findFirst({
        where: {
          userId,
          token: hashed,
          used: false,
          expiresAt: {
            gt: new Date(),
          },
        },
      });
    } catch (error) {
      this.logger.debug(`Database query failed for verification token lookup: ${userId}`);
      return null;
    }
  }

  async markVerificationTokenAsUsed(tokenId: string): Promise<void> {
    await (this.databaseService as any).prismaClient.emailVerificationToken.update({
      where: { id: tokenId },
      data: { used: true },
    });
  }

  async invalidateExistingVerificationTokens(userId: string): Promise<void> {
    await (this.databaseService as any).prismaClient.emailVerificationToken.updateMany({
      where: {
        userId,
        used: false,
      },
      data: { used: true },
    });
  }

  // Cleanup expired tokens (should be called periodically)
  async cleanupExpiredVerificationTokens(): Promise<void> {
    try {
      const deletedCount = await (this.databaseService as any).prismaClient.emailVerificationToken.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      if (deletedCount.count > 0) {
        this.logger.log(`Cleaned up ${deletedCount.count} expired verification tokens`);
      }
    } catch (error) {
      // Silently skip if table doesn't exist or other DB issues
      throw error; // Re-throw to let caller handle it
    }
  }

  // Update user password
  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await (this.databaseService as any).prismaClient.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // Update user email
  async updateUserEmail(userId: string, email: string): Promise<void> {
    await (this.databaseService as any).prismaClient.user.update({
      where: { id: userId },
      data: { email },
    });
  }

  // Password reset token methods
  async createPasswordResetToken(userId: string, hashedToken: string, expiresAt: Date): Promise<void> {
    await (this.databaseService as any).prismaClient.passwordResetToken.create({
      data: {
        userId,
        token: hashedToken,
        expiresAt,
      },
    });
  }

  async findValidPasswordResetToken(userId: string, hashedToken: string): Promise<any> {
    try {
      return await (this.databaseService as any).prismaClient.passwordResetToken.findFirst({
        where: {
          userId,
          token: hashedToken,
          used: false,
          expiresAt: {
            gt: new Date(),
          },
        },
      });
    } catch (error) {
      this.logger.debug(`Database query failed for password reset token lookup: ${userId}`);
      return null;
    }
  }

  async markPasswordResetTokenAsUsed(tokenId: string): Promise<void> {
    await (this.databaseService as any).prismaClient.passwordResetToken.update({
      where: { id: tokenId },
      data: { used: true },
    });
  }

  async invalidateExistingPasswordResetTokens(userId: string): Promise<void> {
    await (this.databaseService as any).prismaClient.passwordResetToken.updateMany({
      where: {
        userId,
        used: false,
      },
      data: { used: true },
    });
  }

  // Email change token methods removed (feature dropped)

  // Cleanup expired tokens (should be called periodically)
  async cleanupExpiredPasswordResetTokens(): Promise<void> {
    try {
      const deletedCount = await (this.databaseService as any).prismaClient.passwordResetToken.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      if (deletedCount.count > 0) {
        this.logger.log(`Cleaned up ${deletedCount.count} expired password reset tokens`);
      }
    } catch (error) {
      // Silently skip if table doesn't exist or other DB issues
      throw error; // Re-throw to let caller handle it
    }
  }

  // cleanupExpiredEmailChangeTokens removed (feature dropped)

  // ========================================================================
  // API KEY METHODS REMOVED (2025-12-04)
  // ========================================================================
  // All API key methods have been moved to ApiKeyDatabaseService
  // for proper separation of concerns and domain-driven design.
  //
  // This service now only handles:
  // - User authentication and management
  // - Email verification
  // - Password reset
  //
  // For API key operations, use ApiKeyDatabaseService instead.
  // ========================================================================
}