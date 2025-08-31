import { Injectable, UnauthorizedException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtDatabaseService } from './jwt-database.service';
import { SecurityLoggerService } from './security-logger.service';

export interface RegisterDto {
  email: string;
  password: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    isDemo: boolean;
    emailVerified: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  
  // Different security levels for different data types
  private readonly PASSWORD_SALT_ROUNDS = 12;  // Higher security for passwords
  private readonly API_KEY_SALT_ROUNDS = 10;   // Lower rounds for API keys (used more frequently)
  private readonly passwordPepper: string;

  constructor(
    private readonly databaseService: JwtDatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // Security logger will be injected via method calls to avoid circular dependency
  ) {
    // Load password pepper from environment
    this.passwordPepper = this.configService.get<string>('PASSWORD_PEPPER') || '';
    if (!this.passwordPepper) {
      this.logger.warn('PASSWORD_PEPPER not set in environment variables. Using empty pepper (less secure)');
    } else if (this.passwordPepper.length < 32) {
      this.logger.warn('PASSWORD_PEPPER is shorter than recommended 32 characters');
    }
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password } = registerDto;

    // Validate email format
    if (!this.isValidEmail(email)) {
      throw new UnauthorizedException('Invalid email format');
    }

    // Validate password strength
    if (!this.isStrongPassword(password)) {
      throw new UnauthorizedException('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number');
    }

    // Check if user already exists
    const existingUser = await this.databaseService.findUserByEmail(email);

    if (existingUser) {
      this.logger.warn(`Registration attempt with existing email: ${email}`);
      throw new ConflictException('User with this email already exists');
    }

    try {
      // Hash password with pepper and higher salt rounds
      const passwordWithPepper = password + this.passwordPepper;
      const passwordHash = await this.hashPassword(passwordWithPepper);

      // Generate API key for backward compatibility
      const apiKey = this.generateSecureApiKey();
      const hashedApiKey = await this.hashApiKey(apiKey);

      // Create user
      const user = await this.databaseService.createUserWithJWT({
        email,
        passwordHash,
        apiKey: hashedApiKey,
        description: 'JWT User Account',
        isDemo: false,
        emailVerified: false,
        isActive: true,
      });

      this.logger.log(`New user registered: ${user.id} (${email})`);
      
      // Security logging handled at controller level to avoid circular dependencies

      // Generate JWT token
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email!,
      };
      const access_token = this.jwtService.sign(payload);

      return {
        access_token,
        user: {
          id: user.id,
          email: user.email!,
          isDemo: user.isDemo,
          emailVerified: user.emailVerified,
        },
      };
    } catch (error) {
      this.logger.error('Registration failed:', error);
      throw new UnauthorizedException('Registration failed');
    }
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    try {
      // Always perform timing-consistent operations to prevent user enumeration
      const user = await this.databaseService.findUserByEmail(email);
      const passwordWithPepper = password + this.passwordPepper;
      
      // Always perform password verification even if user doesn't exist (timing attack prevention)
      const dummyHash = '$2b$12$dummyhashtopreventtimingattacksandusernameenumeration';
      const targetHash = user?.passwordHash || dummyHash;
      const isPasswordValid = await this.verifyPassword(passwordWithPepper, targetHash);

      // Check all conditions after password verification to maintain constant timing
      if (!user || !user.passwordHash || !user.isActive || !isPasswordValid) {
        // Use consistent timing for all failure scenarios
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50)); // 50-150ms delay
        this.logger.warn(`Login attempt failed for: ${email}`);
        throw new UnauthorizedException('Invalid credentials');
      }

      // Update last login timestamp
      await this.databaseService.updateUserLastLogin(user.id);

      this.logger.log(`User logged in: ${user.id} (${email})`);
      
      // Security logging handled at controller level to avoid circular dependencies

      // Generate JWT token
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email!,
      };
      const access_token = this.jwtService.sign(payload);

      return {
        access_token,
        user: {
          id: user.id,
          email: user.email!,
          isDemo: user.isDemo,
          emailVerified: user.emailVerified,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Login failed:', error);
      throw new UnauthorizedException('Login failed');
    }
  }

  async validateUserById(userId: string): Promise<User | null> {
    try {
      const user = await this.databaseService.findActiveUserById(userId);
      return user;
    } catch (error) {
      this.logger.error(`Failed to validate user by ID: ${userId}`, error);
      return null;
    }
  }

  async updateLastSeen(userId: string): Promise<void> {
    try {
      await this.databaseService.updateUserLastSeen(userId);
    } catch (error) {
      this.logger.warn(`Failed to update last seen for user: ${userId}`, error);
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isStrongPassword(password: string): boolean {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  }

  private generateSecureApiKey(): string {
    // Generate a cryptographically secure API key (32 bytes = 64 hex chars)
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate email verification token
   */
  generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Request email verification (resend verification email)
   */
  async requestEmailVerification(userId: string): Promise<{ token: string }> {
    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      throw new ConflictException('Email is already verified');
    }

    // Invalidate any existing tokens for this user
    await this.databaseService.invalidateExistingVerificationTokens(userId);

    const verificationToken = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    // Store the token in database
    await this.databaseService.createVerificationToken(userId, verificationToken, expiresAt);
    
    this.logger.log(`Email verification requested for user: ${userId}`);
    
    // In production, this token would be sent via email instead of returned
    return { token: verificationToken };
  }

  /**
   * Verify email with token - SECURE IMPLEMENTATION
   */
  async verifyEmail(userId: string, token: string): Promise<{ success: boolean; message: string }> {
    // Validate token format
    if (!token || typeof token !== 'string' || token.length < 32) {
      this.logger.warn(`Invalid token format provided by user: ${userId}`);
      throw new UnauthorizedException('Invalid verification token format');
    }

    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      this.logger.warn(`Verification attempt for non-existent user: ${userId}`);
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      return { success: true, message: 'Email is already verified' };
    }

    // Find and validate the token in database
    const verificationToken = await this.databaseService.findValidVerificationToken(userId, token);
    
    if (!verificationToken) {
      this.logger.warn(`Invalid or expired verification token attempt by user: ${userId}`);
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (verificationToken.used) {
      this.logger.warn(`Already used verification token attempt by user: ${userId}`);
      throw new UnauthorizedException('This verification token has already been used');
    }

    if (verificationToken.expiresAt < new Date()) {
      this.logger.warn(`Expired verification token attempt by user: ${userId}`);
      throw new UnauthorizedException('Verification token has expired');
    }

    // Mark token as used and verify user email
    await this.databaseService.markVerificationTokenAsUsed(verificationToken.id);
    await this.databaseService.updateUserEmailVerification(userId, true);
    
    this.logger.log(`Email successfully verified for user: ${userId}`);
    
    return { success: true, message: 'Email verified successfully' };
  }

  /**
   * Check if user email is verified
   */
  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.emailVerified;
  }

  /**
   * Hash password with high security (pepper + high salt rounds)
   */
  private async hashPassword(passwordWithPepper: string): Promise<string> {
    try {
      return await bcrypt.hash(passwordWithPepper, this.PASSWORD_SALT_ROUNDS);
    } catch (error) {
      this.logger.error('Failed to hash password', error);
      throw new UnauthorizedException('Password processing failed');
    }
  }

  /**
   * Verify password with pepper
   */
  private async verifyPassword(passwordWithPepper: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(passwordWithPepper, hash);
    } catch (error) {
      this.logger.error('Failed to verify password', error);
      return false;
    }
  }

  /**
   * Hash API key with medium security (no pepper, lower salt rounds)
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    try {
      return await bcrypt.hash(apiKey, this.API_KEY_SALT_ROUNDS);
    } catch (error) {
      this.logger.error('Failed to hash API key', error);
      throw new UnauthorizedException('API key processing failed');
    }
  }

  /**
   * Verify API key (used by database service)
   */
  async verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(apiKey, hash);
    } catch (error) {
      this.logger.error('Failed to verify API key', error);
      return false;
    }
  }

  /**
   * Update user password (with proper hashing)
   */
  async updateUserPassword(userId: string, newPassword: string): Promise<void> {
    // Validate password strength
    if (!this.isStrongPassword(newPassword)) {
      throw new UnauthorizedException('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number');
    }

    try {
      const passwordWithPepper = newPassword + this.passwordPepper;
      const passwordHash = await this.hashPassword(passwordWithPepper);
      
      await this.databaseService.updateUserPassword(userId, passwordHash);
      this.logger.log(`Password updated for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to update password for user: ${userId}`, error);
      throw new UnauthorizedException('Password update failed');
    }
  }
}