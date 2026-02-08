import { Injectable, UnauthorizedException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtDatabaseService } from './jwt-database.service';
import { SecurityLoggerService } from './security-logger.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtKeyRotationService } from './jwt-key-rotation.service';
import { EmailService } from './email.service';
import { generateUniqueDisplayName } from '../utils/display-name-generator';
import { getErrorMessage, getErrorDetails } from '../../../core/utils/error-utils';


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
  iss?: string; // issuer
  aud?: string; // audience
  iat?: number;
  exp?: number;
  nbf?: number; // not before
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    isDemo: boolean;
    emailVerified: boolean;
    isAdmin: boolean;
    displayName?: string;
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
    private readonly refreshTokenService: RefreshTokenService,
    private readonly keyRotationService: JwtKeyRotationService,
    private readonly emailService: EmailService,
    private readonly eventEmitter: EventEmitter2,
    // Security logger will be injected via method calls to avoid circular dependency
  ) {
    // Load password pepper from environment
    this.passwordPepper = this.configService.get<string>('PASSWORD_PEPPER') || '';
    if (!this.passwordPepper || this.passwordPepper.length < 32) {
      throw new Error('PASSWORD_PEPPER must be set and at least 32 characters long for secure password hashing');
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

      // Generate unique display name
      const displayName = await generateUniqueDisplayName(async (name) => {
        const existingUser = await this.databaseService.findUserByDisplayName(name);
        return !existingUser; // true if unique (not found)
      });

      // Create user
      const user = await this.databaseService.createUserWithJWT({
        email,
        passwordHash,
        apiKey: hashedApiKey,
        description: 'JWT User Account',
        isDemo: false,
        emailVerified: false,
        isActive: true,
        displayName,
      });

      this.logger.log(`User registered: ${user.id} (${email})`);

      // Security logging handled at controller level to avoid circular dependencies

      // Generate JWT token
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email!,
      };
      const access_token = this.signJwtWithEnhancedSecurity(payload);

      // Generate refresh token
      const refresh_token = await this.refreshTokenService.createRefreshSession(user.id, 'Registration Device');

      return {
        access_token,
        refresh_token,
        user: {
          id: user.id,
          email: user.email!,
          isDemo: user.isDemo,
          emailVerified: user.emailVerified,
          isAdmin: false,
          displayName: user.displayName || undefined,
        },
      };
    } catch (error) {
      this.logger.error('Registration failed:', getErrorMessage(error));
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
      const access_token = this.signJwtWithEnhancedSecurity(payload);

      // Generate refresh token
      const refresh_token = await this.refreshTokenService.createRefreshSession(user.id, 'Login Device');

      return {
        access_token,
        refresh_token,
        user: {
          id: user.id,
          email: user.email!,
          isDemo: user.isDemo,
          emailVerified: user.emailVerified,
          isAdmin: false,
          displayName: user.displayName || undefined,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Login failed:', getErrorMessage(error));
      throw new UnauthorizedException('Login failed');
    }
  }

  async validateUserById(userId: string): Promise<User | null> {
    try {
      const user = await this.databaseService.findActiveUserById(userId);
      return user;
    } catch (error) {
      this.logger.error(`Failed to validate user by ID: ${userId}`, getErrorMessage(error));
      return null;
    }
  }

  async updateLastSeen(userId: string): Promise<void> {
    try {
      await this.databaseService.updateUserLastSeen(userId);
    } catch (error) {
      this.logger.warn(`Failed to update last seen for user: ${userId}`, getErrorMessage(error));
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isStrongPassword(password: string): boolean {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    // Allow any characters (not just limited special chars)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
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
    
    this.logger.log(`Email verification requested: ${userId}`);
    
    // For now, we'll store the token in the database and return it for manual verification
    return { token: verificationToken };
  }

  /**
   * Verify email with token - SECURE IMPLEMENTATION
   */
  async verifyEmail(userId: string, token: string): Promise<{ success: boolean; message: string }> {
    // Validate token format
    if (!token || typeof token !== 'string' || token.length < 32) {
      throw new UnauthorizedException('Invalid verification token format');
    }

    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      return { success: true, message: 'Email is already verified' };
    }

    // Find and validate the token in database
    const verificationToken = await this.databaseService.findValidVerificationToken(userId, token);

    if (!verificationToken) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (verificationToken.used) {
      throw new UnauthorizedException('This verification token has already been used');
    }

    if (verificationToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Verification token has expired');
    }

    // Mark token as used and verify user email
    await this.databaseService.markVerificationTokenAsUsed(verificationToken.id);
    await this.databaseService.updateUserEmailVerification(userId, true);

    this.logger.log(`Email verified: ${userId}`);

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
      this.logger.error('Failed to hash password', getErrorMessage(error));
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
      this.logger.error('Failed to verify password', getErrorMessage(error));
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
      this.logger.error('Failed to hash API key', getErrorMessage(error));
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
      this.logger.error('Failed to verify API key', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Update user password (with proper hashing)
   */
  async updateUserPassword(userId: string, newPassword: string): Promise<void> {
    // Validate password strength (throws UnauthorizedException - not logged, expected user input error)
    if (!this.isStrongPassword(newPassword)) {
      throw new UnauthorizedException('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number');
    }

    const passwordWithPepper = newPassword + this.passwordPepper;
    const passwordHash = await this.hashPassword(passwordWithPepper);

    await this.databaseService.updateUserPassword(userId, passwordHash);

    // Revoke all refresh sessions after password change for security
    await this.refreshTokenService.revokeAllUserSessions(userId);

    // CRITICAL: Emit event to invalidate authentication caches immediately
    this.eventEmitter.emit('auth.cache.invalidate', {
      reason: 'password_changed',
      userId,
    });

    this.logger.log(`Password updated for user: ${userId}`);
  }

  /**
   * Generate password reset token
   */
  generatePasswordResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<{ message: string; emailSent: boolean }> {
    // Always perform timing-consistent operations
    const user = await this.databaseService.findUserByEmail(email);
    const resetToken = this.generatePasswordResetToken();
    const genericResponse = { 
      message: 'If this email is associated with an account, a password reset token has been generated.',
      emailSent: false
    };
    
    // Add random delay to prevent timing attacks for user enumeration
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50)); // 50-150ms delay

    if (user && user.isActive) {
      // Invalidate any existing reset tokens for this user
      await this.databaseService.invalidateExistingPasswordResetTokens(user.id);

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      
      // Store the hashed token in database
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
      await this.databaseService.createPasswordResetToken(user.id, hashedToken, expiresAt);
      
      this.logger.log(`Password reset requested: ${user.id}`);

      const emailSent = await this.emailService.sendPasswordResetEmail(email, resetToken);
      if (!emailSent) {
        this.logger.warn(`🔑 DEVELOPMENT MODE - Password Reset Token for ${email}: ${resetToken}`);
      }
      
      return { 
        ...genericResponse,
        emailSent,
      };
    }

    // Don't reveal whether the email exists
    return genericResponse;
  }

  /**
   * Reset password with token - SECURE IMPLEMENTATION
   */
  async resetPassword(email: string, token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    // Validate token format
    if (!token || typeof token !== 'string' || token.length < 32) {
      throw new UnauthorizedException('Invalid password reset token format');
    }

    // Validate new password strength
    if (!this.isStrongPassword(newPassword)) {
      throw new UnauthorizedException('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number');
    }

    const user = await this.databaseService.findUserByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Hash the token to find in database
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find and validate the token in database
    const resetToken = await this.databaseService.findValidPasswordResetToken(user.id, hashedToken);

    if (!resetToken) {
      throw new UnauthorizedException('Invalid or expired password reset token');
    }

    if (resetToken.used) {
      throw new UnauthorizedException('This password reset token has already been used');
    }

    if (resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Password reset token has expired');
    }

    // VALIDATION: Verify new password is different from current password BEFORE consuming token
    // This allows users to retry with different passwords without burning their token
    // NOTE: This throws UnauthorizedException on failure - it's NOT logged as an error (expected user mistake)
    const passwordWithPepper = newPassword + this.passwordPepper;
    if (user.passwordHash) {
      const isSamePassword = await this.verifyPassword(passwordWithPepper, user.passwordHash);
      if (isSamePassword) {
        throw new UnauthorizedException('New password must be different from your current password');
      }
    }

    // SECURITY: Mark token as used AFTER validation passes, BEFORE database update
    // ✅ Prevents: Token reuse, race conditions
    // ✅ Allows: Multiple attempts if user enters same password (token NOT consumed on validation errors)
    // ⚠️ Trade-off: If database update fails (rare), token is consumed but password unchanged
    await this.databaseService.markPasswordResetTokenAsUsed(resetToken.id);

    // Update password - if this fails, token is already consumed (correct for security)
    await this.updateUserPassword(user.id, newPassword);

    this.logger.log(`Password reset: ${user.id}`);

    // Send confirmation email (non-blocking - don't fail password reset if email fails)
    try {
      await this.emailService.sendPasswordResetConfirmationEmail(user.email!);
    } catch (emailError) {
      this.logger.warn(`Failed to send password reset confirmation email to ${user.email}: ${emailError instanceof Error ? emailError.message : 'Unknown error'}`);
    }

    return { success: true, message: 'Password reset successfully' };
  }

  /**
   * Logout - revoke specific session
   */
  async logout(refreshToken: string): Promise<void> {
    const session = await this.refreshTokenService.getSessionByRefreshToken(refreshToken);
    if (session) {
      await this.refreshTokenService.revokeSession(session.sessionId);
      this.logger.log(`User logged out: ${session.userId}, session: ${session.sessionId}`);
    }
  }

  /**
   * Logout all sessions for a user
   */
  async logoutAllSessions(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllUserSessions(userId);
    this.logger.log(`All sessions revoked for user: ${userId}`);
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
    const requestId = crypto.randomBytes(4).toString('hex');
    this.logger.debug(`[${requestId}] Starting token refresh`);

    try {
      // Rotate the refresh token and get new session
      const rotationResult = await this.refreshTokenService.rotateRefreshToken(refreshToken);

      if (!rotationResult) {
        this.logger.warn(`[${requestId}] Invalid or expired refresh token`);
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      this.logger.debug(`[${requestId}] Token rotation successful for user ${rotationResult.session.userId}`);

      const { newRefreshToken, session } = rotationResult;

      // Get user data
      const user = await this.databaseService.findActiveUserById(session.userId);
      if (!user) {
        this.logger.warn(`User not found for refresh token: ${session.userId}`);
        throw new UnauthorizedException('User not found');
      }

      // Generate new access token
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email!,
      };
      const access_token = this.signJwtWithEnhancedSecurity(payload);

      this.logger.log(`[${requestId}] Access token refreshed for user: ${user.id}`);

      return {
        access_token,
        refresh_token: newRefreshToken,
        user: {
          id: user.id,
          email: user.email!,
          isDemo: user.isDemo,
          emailVerified: user.emailVerified,
          isAdmin: false,
          displayName: user.displayName || undefined,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.logger.warn(`[${requestId}] Token refresh failed: ${error.message}`);
        throw error;
      }
      this.logger.error(`[${requestId}] Failed to refresh access token:`, getErrorMessage(error));
      throw new UnauthorizedException('Token refresh failed');
    }
  }

  /**
   * Sign JWT with enhanced security (kid header, iss/aud/nbf claims)
   */
  private signJwtWithEnhancedSecurity(payload: JwtPayload): string {
    const currentKey = this.keyRotationService.getCurrentKey();
    const now = Math.floor(Date.now() / 1000);
    
    // Add enhanced claims
    const enhancedPayload: JwtPayload = {
      ...payload,
      iss: this.configService.get<string>('JWT_ISSUER') || 'analyzer-api',
      aud: this.configService.get<string>('JWT_AUDIENCE') || 'analyzer-client',
      nbf: now, // Not valid before now
    };

    // Sign with current key and add kid to header
    return this.jwtService.sign(enhancedPayload, {
      secret: currentKey.secret,
      header: {
        alg: 'HS256',
        typ: 'JWT',
        kid: currentKey.id,
      },
    });
  }
}
