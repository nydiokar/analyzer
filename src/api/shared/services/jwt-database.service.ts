import { Injectable, Logger } from '@nestjs/common';
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
      this.logger.error(`Failed to find user by email: ${email}`, error);
      return null;
    }
  }

  async findActiveUserById(userId: string): Promise<User | null> {
    try {
      return await (this.databaseService as any).prismaClient.user.findUnique({
        where: { 
          id: userId,
          isActive: true,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to find active user by ID: ${userId}`, error);
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
      this.logger.error(`Failed to find user by ID: ${userId}`, error);
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
    await (this.databaseService as any).prismaClient.emailVerificationToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });
  }

  async findValidVerificationToken(userId: string, token: string): Promise<any> {
    try {
      return await (this.databaseService as any).prismaClient.emailVerificationToken.findFirst({
        where: {
          userId,
          token,
          used: false,
          expiresAt: {
            gt: new Date(),
          },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to find verification token for user: ${userId}`, error);
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
    const deletedCount = await (this.databaseService as any).prismaClient.emailVerificationToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    this.logger.log(`Cleaned up ${deletedCount.count} expired verification tokens`);
  }

  // Update user password
  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await (this.databaseService as any).prismaClient.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}