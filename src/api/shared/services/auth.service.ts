import { Injectable, UnauthorizedException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtDatabaseService } from './jwt-database.service';

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
  private readonly saltRounds = 12;

  constructor(
    private readonly databaseService: JwtDatabaseService,
    private readonly jwtService: JwtService,
  ) {}

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
      // Hash password
      const passwordHash = await bcrypt.hash(password, this.saltRounds);

      // Generate API key for backward compatibility
      const apiKey = this.generateSecureApiKey();
      const hashedApiKey = await bcrypt.hash(apiKey, this.saltRounds);

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
      // Find user by email
      const user = await this.databaseService.findUserByEmail(email);

      if (!user || !user.passwordHash) {
        this.logger.warn(`Login attempt with non-existent or API-key-only user: ${email}`);
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.isActive) {
        this.logger.warn(`Login attempt with inactive user: ${email}`);
        throw new UnauthorizedException('Account is inactive');
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        this.logger.warn(`Invalid password for user: ${email}`);
        throw new UnauthorizedException('Invalid credentials');
      }

      // Update last login timestamp
      await this.databaseService.updateUserLastLogin(user.id);

      this.logger.log(`User logged in: ${user.id} (${email})`);

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
    // Generate a secure API key (32 characters)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
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

    const verificationToken = this.generateVerificationToken();
    
    // Note: In a real application, you would:
    // 1. Store this token in database with expiration (e.g., 24 hours)
    // 2. Send an email to the user with a verification link
    // 3. The link would contain this token and point to /auth/verify-email?token=TOKEN
    
    this.logger.log(`Email verification requested for user: ${userId}`);
    
    // For now, we return the token (in production, this would be sent via email)
    return { token: verificationToken };
  }

  /**
   * Verify email with token
   * Note: This is a simplified implementation. In production, you should:
   * 1. Store tokens in database with expiration
   * 2. Validate token against stored values
   * 3. Mark tokens as used after verification
   */
  async verifyEmail(userId: string, token: string): Promise<{ success: boolean; message: string }> {
    // Simple validation - in production, validate against stored tokens
    if (!token || token.length < 10) {
      throw new UnauthorizedException('Invalid verification token');
    }

    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      return { success: true, message: 'Email is already verified' };
    }

    // Update user email verification status
    await this.databaseService.updateUserEmailVerification(userId, true);
    
    this.logger.log(`Email verified for user: ${userId}`);
    
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
}