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

  // Delegate API key validation to the existing service
  async validateApiKey(apiKey: string): Promise<User | null> {
    return await this.databaseService.validateApiKey(apiKey);
  }
}