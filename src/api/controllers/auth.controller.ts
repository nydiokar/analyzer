import { Controller, Post, Get, Body, Req, Res, HttpStatus, UseGuards, Logger, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { User } from '@prisma/client';
import { AuthService, RegisterDto, LoginDto, AuthResponse } from '../shared/services/auth.service';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { SecurityLoggerService } from '../shared/services/security-logger.service';
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
    private readonly securityLogger: SecurityLoggerService,
  ) {
    this.cookieMode = this.configService.get<string>('AUTH_COOKIE_MODE') === 'true';
    this.cookieName = this.configService.get<string>('AUTH_COOKIE_NAME') || 'analyzer.sid';
    this.cookieSecure = this.configService.get<string>('AUTH_COOKIE_SECURE') !== 'false';
  }

  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard)
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
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
      }

      this.logger.log(`User registered successfully: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
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
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
      }

      this.logger.log(`User logged in successfully: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
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

  @Post('logout')
  @UseGuards(CompositeAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user (clear cookie if cookie mode enabled)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Logout successful' })
  async logout(@Res({ passthrough: true }) response: Response): Promise<{ message: string }> {
    // Clear cookie if cookie mode is enabled
    if (this.cookieMode) {
      response.clearCookie(this.cookieName, {
        httpOnly: true,
        secure: this.cookieSecure,
        sameSite: 'strict',
      });
    }

    this.logger.log('User logged out');
    return { message: 'Logout successful' };
  }

  @Post('request-verification')
  @UseGuards(CompositeAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 3600000 } }) // 2 requests per hour
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request email verification' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Verification email requested successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        token: { type: 'string', description: 'Verification token (for demo purposes - would be sent via email in production)' },
      }
    }
  })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Email already verified' })
  async requestEmailVerification(@Req() req: AuthenticatedRequest): Promise<{ message: string; token: string }> {
    try {
      const user = req.user!;
      const result = await this.authService.requestEmailVerification(user.id);
      
      this.logger.log(`Email verification requested for user: ${user.id}`);
      return { 
        message: 'Verification email sent successfully. Please check your email and use the token below for demo purposes.', 
        token: result.token 
      };
    } catch (error) {
      this.logger.error(`Email verification request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Post('verify-email')
  @UseGuards(CompositeAuthGuard, ThrottlerGuard)
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
}