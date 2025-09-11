import { Controller, Post, Get, Body, Req, Res, HttpStatus, UseGuards, Logger, UseInterceptors, ValidationPipe, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { User } from '@prisma/client';
import { AuthService, RegisterDto, LoginDto, AuthResponse } from '../shared/services/auth.service';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { CsrfGuard } from '../shared/guards/csrf.guard';
import { CsrfService } from '../shared/services/csrf.service';
import { SecurityLoggerService } from '../shared/services/security-logger.service';
import { EmailService } from '../shared/services/email.service';
import { Public } from '../shared/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

// DTOs for validation
class RegisterRequestDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;
}

class LoginRequestDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;
}

class RefreshRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refresh_token: string;
}

class PasswordResetRequestDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}

class PasswordResetDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Reset token is required' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  newPassword: string;
}

 

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly cookieMode: boolean;
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly csrfService: CsrfService,
    private readonly securityLogger: SecurityLoggerService,
    private readonly emailService: EmailService,
  ) {
    this.cookieMode = this.configService.get<string>('AUTH_COOKIE_MODE') === 'true';
    this.cookieName = this.configService.get<string>('AUTH_COOKIE_NAME') || 'analyzer.sid';
    this.cookieSecure = this.configService.get<string>('AUTH_COOKIE_SECURE') !== 'false';
  }

  @Post('register')
  @Public()
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute for registration
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterRequestDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'User registered successfully',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            isDemo: { type: 'boolean' },
            emailVerified: { type: 'boolean' },
          }
        }
      }
    }
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation failed' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'User already exists' })
  async register(
    @Body() registerDto: RegisterRequestDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.register(registerDto);

      // Set httpOnly cookie if cookie mode is enabled
      if (this.cookieMode) {
        response.cookie(this.cookieName, result.access_token, {
          httpOnly: true,
          secure: this.cookieSecure,
          sameSite: 'strict',
          maxAge: 30 * 60 * 1000, // 30 minutes to match token TTL
        });
      }

      // Automatically send email verification after successful registration
      try {
        const emailResult = await this.authService.requestEmailVerification(result.user.id);
        const emailSent = await this.emailService.sendVerificationEmail(result.user.email, emailResult.token);
        
        if (emailSent) {
          this.logger.log(`Email verification automatically sent to new user: ${result.user.id}`);
        } else {
          this.logger.warn(`Email service not configured - verification token for user ${result.user.id}: ${emailResult.token}`);
        }
      } catch (emailError) {
        this.logger.warn(`Failed to send automatic verification email for user ${result.user.id}: ${emailError instanceof Error ? emailError.message : 'Unknown error'}`);
        // Don't fail registration if email sending fails
      }

      this.logger.log(`User registered successfully: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute for login
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginRequestDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            isDemo: { type: 'boolean' },
            emailVerified: { type: 'boolean' },
          }
        }
      }
    }
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginRequestDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.login(loginDto);

      // Set httpOnly cookie if cookie mode is enabled
      if (this.cookieMode) {
        response.cookie(this.cookieName, result.access_token, {
          httpOnly: true,
          secure: this.cookieSecure,
          sameSite: 'strict',
          maxAge: 30 * 60 * 1000, // 30 minutes to match token TTL
        });
      }

      this.logger.log(`User logged in successfully: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Get('csrf-token')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute
  @ApiOperation({ summary: 'Get CSRF token (only when cookie mode enabled)' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'CSRF token generated successfully',
    schema: {
      type: 'object',
      properties: {
        csrfToken: { type: 'string' },
        message: { type: 'string' },
      }
    }
  })
  async getCsrfToken(@Req() req: AuthenticatedRequest): Promise<{ csrfToken?: string; message: string }> {
    if (!this.cookieMode) {
      return { message: 'CSRF protection not enabled (not in cookie mode)' };
    }

    const sessionId = req.user?.id; // Use user ID as session ID if authenticated
    const csrfToken = this.csrfService.generateCsrfToken(sessionId);
    
    return {
      csrfToken,
      message: 'Include this token in X-CSRF-Token header for state-changing requests',
    };
  }

  @Get('me')
  @UseGuards(CompositeAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'User profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        isDemo: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
      }
    }
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async getProfile(@Req() req: AuthenticatedRequest): Promise<{
    id: string;
    email: string | null;
    isDemo: boolean;
    emailVerified: boolean;
    createdAt: Date;
    lastLoginAt: Date | null;
  }> {
    const user = req.user!;
    return {
      id: user.id,
      email: user.email,
      isDemo: user.isDemo,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute for token refresh
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiBody({ type: RefreshRequestDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Token refreshed successfully',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            isDemo: { type: 'boolean' },
            emailVerified: { type: 'boolean' },
          }
        }
      }
    }
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid or expired refresh token' })
  async refresh(
    @Body() refreshDto: RefreshRequestDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthResponse> {
    try {
      const result = await this.authService.refreshAccessToken(refreshDto.refresh_token);

      // Update cookie if cookie mode is enabled
      if (this.cookieMode) {
        response.cookie(this.cookieName, result.access_token, {
          httpOnly: true,
          secure: this.cookieSecure,
          sameSite: 'strict',
          maxAge: 30 * 60 * 1000, // 30 minutes for new short-lived token
        });
      }

      this.logger.log(`Token refreshed for user: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Public() // Allow both authenticated and unauthenticated requests
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Logout user and revoke refresh token' })
  @ApiBody({ 
    type: RefreshRequestDto,
    required: false,
    description: 'Optional refresh token to revoke specific session'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Logout successful' })
  async logout(
    @Body() body?: { refresh_token?: string },
    @Res({ passthrough: true }) response?: Response
  ): Promise<{ message: string }> {
    try {
      // Revoke refresh token session if provided
      if (body?.refresh_token) {
        await this.authService.logout(body.refresh_token);
      }

      // Clear cookie if cookie mode is enabled
      if (this.cookieMode && response) {
        response.clearCookie(this.cookieName, {
          httpOnly: true,
          secure: this.cookieSecure,
          sameSite: 'strict',
        });
      }

      this.logger.log('User logged out');
      return { message: 'Logout successful' };
    } catch (error) {
      this.logger.warn(`Logout warning: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Don't fail logout even if refresh token revocation fails
      return { message: 'Logout successful' };
    }
  }

  @Post('request-verification')
  @UseGuards(CompositeAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 300000 } }) // 10 requests per 5 minutes
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request email verification' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Verification email requested successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      }
    }
  })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Email already verified' })
  async requestEmailVerification(@Req() req: AuthenticatedRequest): Promise<{ message: string }> {
    try {
      const user = req.user!;
      const result = await this.authService.requestEmailVerification(user.id);
      
      // Try to send email
      const emailSent = await this.emailService.sendVerificationEmail(user.email!, result.token);
      
      this.logger.log(`Email verification requested for user: ${user.id}`);
      
      if (emailSent) {
        return { 
          message: 'Verification email sent! Please check your email and enter the verification token.'
        };
      } else {
        // Email not configured - log token for development
        this.logger.warn(`🔑 DEVELOPMENT MODE - Email Verification Token for user ${user.id}: ${result.token}`);
        return { 
          message: 'Email service not configured. For development, the verification token has been logged to the server console.'
        };
      }
    } catch (error) {
      this.logger.error(`Email verification request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('verify-email')
  @UseGuards(CompositeAuthGuard, CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 attempts per 5 minutes
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify email with token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Email verification token' }
      },
      required: ['token']
    }
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Email verified successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      }
    }
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid verification token' })
  async verifyEmail(
    @Req() req: AuthenticatedRequest,
    @Body() body: { token: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = req.user!;
      const result = await this.authService.verifyEmail(user.id, body.token);
      
      this.securityLogger.logEmailVerificationAttempt(req, user.id, true);
      this.logger.log(`Email verified for user: ${user.id}`);
      return result;
    } catch (error) {
      const user = req.user!;
      this.securityLogger.logEmailVerificationAttempt(req, user.id, false, error instanceof Error ? error.message : 'Unknown error');
      this.logger.error(`Email verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('forgot-password')
  @Public()
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 requests per 5 minutes
  @ApiOperation({ summary: 'Request password reset token' })
  @ApiBody({ type: PasswordResetRequestDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Password reset requested',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      }
    }
  })
  async forgotPassword(@Body() body: PasswordResetRequestDto): Promise<{ message: string }> {
    try {
      const result = await this.authService.requestPasswordReset(body.email);
      
      // Attempt to send password reset email
      if (result.token) {
        const emailSent = await this.emailService.sendPasswordResetEmail(body.email, result.token);
        if (!emailSent) {
          this.logger.warn(`🔑 DEVELOPMENT MODE - Password Reset Token for ${body.email}: ${result.token}`);
        }
      }
      
      return { message: result.message };
    } catch (error) {
      this.logger.error(`Password reset request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('reset-password')
  @Public()
  @UseGuards(CsrfGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 attempts per 5 minutes
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiBody({ type: PasswordResetDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Password reset successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      }
    }
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid reset token' })
  async resetPassword(@Body() body: PasswordResetDto): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.authService.resetPassword(body.email, body.token, body.newPassword);
      this.logger.log(`Password reset successful for: ${body.email}`);
      return result;
    } catch (error) {
      this.logger.error(`Password reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

 
}