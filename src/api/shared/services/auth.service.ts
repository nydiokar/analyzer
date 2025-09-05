import { Injectable, UnauthorizedException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtDatabaseService } from './jwt-database.service';
import { SecurityLoggerService } from './security-logger.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtKeyRotationService } from './jwt-key-rotation.service';

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
    
    // TODO: Send email with verification token to user's email address
    // For now, we'll store the token in the database and return it for manual verification
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
      
      // Revoke all refresh sessions after password change for security
      await this.refreshTokenService.revokeAllUserSessions(userId);
      
      this.logger.log(`Password updated for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to update password for user: ${userId}`, error);
      throw new UnauthorizedException('Password update failed');
    }
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
  async requestPasswordReset(email: string): Promise<{ token: string; message: string }> {
    // Always perform timing-consistent operations
    const user = await this.databaseService.findUserByEmail(email);
    const resetToken = this.generatePasswordResetToken();
    
    // Add random delay to prevent timing attacks for user enumeration
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50)); // 50-150ms delay

    if (user && user.isActive) {
      // Invalidate any existing reset tokens for this user
      await this.databaseService.invalidateExistingPasswordResetTokens(user.id);

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      
      // Store the hashed token in database
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
      await this.databaseService.createPasswordResetToken(user.id, hashedToken, expiresAt);
      
      this.logger.log(`Password reset requested for user: ${user.id}`);
      
      return { 
        token: resetToken,
        message: 'If this email is associated with an account, a password reset token has been generated.' 
      };
    }

    // Don't reveal whether the email exists
    return { 
      token: resetToken, // Return a dummy token to maintain consistent timing
      message: 'If this email is associated with an account, a password reset token has been generated.'
    };
  }

  /**
   * Reset password with token - SECURE IMPLEMENTATION
   */
  async resetPassword(email: string, token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    // Validate token format
    if (!token || typeof token !== 'string' || token.length < 32) {
      this.logger.warn(`Invalid reset token format for email: ${email}`);
      throw new UnauthorizedException('Invalid password reset token format');
    }

    // Validate new password strength
    if (!this.isStrongPassword(newPassword)) {
      throw new UnauthorizedException('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number');
    }

    const user = await this.databaseService.findUserByEmail(email);
    if (!user || !user.isActive) {
      this.logger.warn(`Password reset attempt for non-existent or inactive user: ${email}`);
      throw new UnauthorizedException('User not found or inactive');
    }

    // Hash the token to find in database
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    // Find and validate the token in database
    const resetToken = await this.databaseService.findValidPasswordResetToken(user.id, hashedToken);
    
    if (!resetToken) {
      this.logger.warn(`Invalid or expired password reset token for user: ${user.id}`);
      throw new UnauthorizedException('Invalid or expired password reset token');
    }

    if (resetToken.used) {
      this.logger.warn(`Already used password reset token for user: ${user.id}`);
      throw new UnauthorizedException('This password reset token has already been used');
    }

    if (resetToken.expiresAt < new Date()) {
      this.logger.warn(`Expired password reset token for user: ${user.id}`);
      throw new UnauthorizedException('Password reset token has expired');
    }

    // Update password and mark token as used
    await this.updateUserPassword(user.id, newPassword);
    await this.databaseService.markPasswordResetTokenAsUsed(resetToken.id);
    
    this.logger.log(`Password successfully reset for user: ${user.id}`);
    
    return { success: true, message: 'Password reset successfully' };
  }

  /**
   * Request email change
   */
  async requestEmailChange(userId: string, newEmail: string): Promise<{ token: string; message: string }> {
    // Validate email format
    if (!this.isValidEmail(newEmail)) {
      throw new UnauthorizedException('Invalid email format');
    }

    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if new email is already in use
    const existingUser = await this.databaseService.findUserByEmail(newEmail);
    if (existingUser && existingUser.id !== userId) {
      throw new ConflictException('Email already in use');
    }

    // Invalidate any existing email change tokens for this user
    await this.databaseService.invalidateExistingEmailChangeTokens(userId);

    const changeToken = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    // Store the hashed token in database with new email
    const hashedToken = crypto.createHash('sha256').update(changeToken).digest('hex');
    await this.databaseService.createEmailChangeToken(userId, hashedToken, newEmail, expiresAt);
    
    this.logger.log(`Email change requested for user: ${userId} to ${newEmail}`);
    
    return { 
      token: changeToken,
      message: 'Email change token generated. Verify with the new email address.' 
    };
  }

  /**
   * Verify email change with token - SECURE IMPLEMENTATION
   */
  async verifyEmailChange(userId: string, token: string): Promise<{ success: boolean; message: string; newEmail?: string }> {
    // Validate token format
    if (!token || typeof token !== 'string' || token.length < 32) {
      this.logger.warn(`Invalid email change token format for user: ${userId}`);
      throw new UnauthorizedException('Invalid email change token format');
    }

    const user = await this.databaseService.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Hash the token to find in database
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    // Find and validate the token in database
    const changeToken = await this.databaseService.findValidEmailChangeToken(userId, hashedToken);
    
    if (!changeToken) {
      this.logger.warn(`Invalid or expired email change token for user: ${userId}`);
      throw new UnauthorizedException('Invalid or expired email change token');
    }

    if (changeToken.used) {
      this.logger.warn(`Already used email change token for user: ${userId}`);
      throw new UnauthorizedException('This email change token has already been used');
    }

    if (changeToken.expiresAt < new Date()) {
      this.logger.warn(`Expired email change token for user: ${userId}`);
      throw new UnauthorizedException('Email change token has expired');
    }

    // Check if the new email is still available
    const existingUser = await this.databaseService.findUserByEmail(changeToken.newEmail);
    if (existingUser && existingUser.id !== userId) {
      this.logger.warn(`Email change failed - email now in use: ${changeToken.newEmail}`);
      throw new ConflictException('The new email address is now in use by another account');
    }

    // Update email, mark token as used, and revoke all sessions for security
    await this.databaseService.updateUserEmail(userId, changeToken.newEmail);
    await this.databaseService.markEmailChangeTokenAsUsed(changeToken.id);
    await this.refreshTokenService.revokeAllUserSessions(userId);
    
    this.logger.log(`Email successfully changed for user: ${userId} to ${changeToken.newEmail}`);
    
    return { 
      success: true, 
      message: 'Email address updated successfully. Please log in again.',
      newEmail: changeToken.newEmail 
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
    // Detect potential replay attacks
    const isReplay = await this.refreshTokenService.detectReplay(refreshToken);
    if (isReplay) {
      throw new UnauthorizedException('Security violation detected - all sessions revoked');
    }

    // Rotate the refresh token and get session
    const result = await this.refreshTokenService.rotateRefreshToken(refreshToken);
    if (!result) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const { newRefreshToken, session } = result;

    // Get user data
    const user = await this.databaseService.findActiveUserById(session.userId);
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Generate new access token
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email!,
    };
    const access_token = this.signJwtWithEnhancedSecurity(payload);

    this.logger.log(`Access token refreshed for user: ${user.id}`);

    return {
      access_token,
      refresh_token: newRefreshToken,
      user: {
        id: user.id,
        email: user.email!,
        isDemo: user.isDemo,
        emailVerified: user.emailVerified,
      },
    };
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