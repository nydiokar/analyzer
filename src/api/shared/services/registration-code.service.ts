import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegistrationCode } from '@prisma/client';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { prisma } from '../../../core/services/database-service';
import { REDIS_CLIENT } from '../../../queues/config/redis.provider';

export interface CreateRegistrationCodeDto {
  description?: string;
  maxUses?: number;
  expiresAt?: Date;
  createdBy?: string;
}

export interface RegistrationCodeStats {
  total: number;
  active: number;
  used: number;
  revoked: number;
  expired: number;
}

@Injectable()
export class RegistrationCodeService {
  private readonly logger = new Logger(RegistrationCodeService.name);
  private readonly KILL_SWITCH_KEY = 'registration:kill-switch';
  private readonly CODE_LENGTH = 16;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a cryptographically secure registration code
   */
  private generateCode(): string {
    const bytes = crypto.randomBytes(this.CODE_LENGTH);
    return bytes.toString('base64url').substring(0, this.CODE_LENGTH);
  }

  /**
   * Create a new registration code
   */
  async createCode(dto: CreateRegistrationCodeDto): Promise<RegistrationCode> {
    const code = this.generateCode();

    try {
      const registrationCode = await prisma.registrationCode.create({
        data: {
          code,
          description: dto.description,
          maxUses: dto.maxUses || 1,
          expiresAt: dto.expiresAt,
          createdBy: dto.createdBy,
        },
      });

      this.logger.log(`Created registration code ${code} (max uses: ${registrationCode.maxUses})`);
      return registrationCode;
    } catch (error) {
      this.logger.error('Failed to create registration code', error);
      throw new ConflictException('Failed to create registration code');
    }
  }

  /**
   * Create multiple registration codes at once
   */
  async createBulkCodes(count: number, dto: CreateRegistrationCodeDto): Promise<RegistrationCode[]> {
    if (count < 1 || count > 100) {
      throw new BadRequestException('Count must be between 1 and 100');
    }

    const codes: RegistrationCode[] = [];

    for (let i = 0; i < count; i++) {
      const code = await this.createCode(dto);
      codes.push(code);
    }

    this.logger.log(`Created ${count} registration codes in bulk`);
    return codes;
  }

  /**
   * Private helper: Validate code business rules (DRY - single source of truth)
   */
  private validateCodeRules(registrationCode: RegistrationCode): void {
    if (registrationCode.status !== 'active') {
      throw new BadRequestException('Registration code is no longer active');
    }

    if (registrationCode.usedCount >= registrationCode.maxUses) {
      throw new BadRequestException('Registration code has already been used');
    }

    if (registrationCode.expiresAt && new Date() > registrationCode.expiresAt) {
      throw new BadRequestException('Registration code has expired');
    }
  }

  /**
   * Validate and atomically mark a registration code as used
   * This is the ONLY method that should be called during registration
   */
  async consumeCode(code: string, userId: string): Promise<void> {
    const registrationCode = await prisma.registrationCode.findUnique({
      where: { code },
    });

    if (!registrationCode) {
      throw new BadRequestException('Invalid registration code');
    }

    // Validate business rules
    this.validateCodeRules(registrationCode);

    // Mark as used (atomic increment)
    try {
      await prisma.registrationCode.update({
        where: { id: registrationCode.id },
        data: {
          usedCount: { increment: 1 },
          usedByUserId: registrationCode.maxUses === 1 ? userId : undefined,
          usedAt: registrationCode.maxUses === 1 ? new Date() : undefined,
          status: registrationCode.usedCount + 1 >= registrationCode.maxUses ? 'used' : 'active',
        },
      });

      this.logger.log(`Registration code ${code} consumed by user ${userId} (${registrationCode.usedCount + 1}/${registrationCode.maxUses})`);
    } catch (error) {
      this.logger.error('Failed to consume registration code', error);
      throw new ConflictException('Failed to process registration code');
    }
  }

  /**
   * Revoke a registration code
   */
  async revokeCode(code: string): Promise<void> {
    const registrationCode = await prisma.registrationCode.findUnique({
      where: { code },
    });

    if (!registrationCode) {
      throw new NotFoundException('Registration code not found');
    }

    await prisma.registrationCode.update({
      where: { id: registrationCode.id },
      data: { status: 'revoked' },
    });

    this.logger.log(`Revoked registration code ${code}`);
  }

  /**
   * Get all registration codes with optional filters
   */
  async listCodes(status?: string, limit: number = 100): Promise<RegistrationCode[]> {
    return prisma.registrationCode.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 1000),
      include: {
        usedBy: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });
  }

  /**
   * Get registration code statistics
   */
  async getStats(): Promise<RegistrationCodeStats> {
    const [total, active, used, revoked] = await Promise.all([
      prisma.registrationCode.count(),
      prisma.registrationCode.count({ where: { status: 'active' } }),
      prisma.registrationCode.count({ where: { status: 'used' } }),
      prisma.registrationCode.count({ where: { status: 'revoked' } }),
    ]);

    // Count expired codes (active but past expiration date)
    const expired = await prisma.registrationCode.count({
      where: {
        status: 'active',
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return { total, active, used, revoked, expired };
  }

  /**
   * Delete a registration code permanently
   */
  async deleteCode(code: string): Promise<void> {
    try {
      await prisma.registrationCode.delete({
        where: { code },
      });
      this.logger.log(`Deleted registration code ${code}`);
    } catch (error) {
      throw new NotFoundException('Registration code not found');
    }
  }

  // ========================================
  // KILL-SWITCH METHODS
  // ========================================

  /**
   * Enable the registration kill-switch (halt all new registrations)
   */
  async enableKillSwitch(): Promise<void> {
    await this.redisClient.set(this.KILL_SWITCH_KEY, '1');
    this.logger.warn('🚨 REGISTRATION KILL-SWITCH ENABLED - New registrations are now blocked');
  }

  /**
   * Disable the registration kill-switch (allow registrations)
   */
  async disableKillSwitch(): Promise<void> {
    await this.redisClient.del(this.KILL_SWITCH_KEY);
    this.logger.log('✅ Registration kill-switch disabled - Registrations are now allowed');
  }

  /**
   * Check if the registration kill-switch is active
   */
  async isKillSwitchActive(): Promise<boolean> {
    const value = await this.redisClient.get(this.KILL_SWITCH_KEY);
    return value === '1';
  }

  /**
   * Get kill-switch status with metadata
   */
  async getKillSwitchStatus(): Promise<{ active: boolean; message: string }> {
    const active = await this.isKillSwitchActive();
    return {
      active,
      message: active
        ? 'Registrations are currently disabled by administrator'
        : 'Registrations are enabled',
    };
  }
}
