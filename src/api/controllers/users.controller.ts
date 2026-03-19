import { Controller, Get, Post, Delete, Req, Body, Param, HttpStatus, HttpCode, ForbiddenException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { User } from '@prisma/client';
import { UserProfileDto } from '../shared/dto/user-profile.dto';
import { ApiKeyService } from '../shared/services/api-key.service';

class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  @MaxLength(100, { message: 'Description must be 100 characters or less' })
  description: string;
}

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get('me')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: "Get the authenticated user's profile" })
  @ApiResponse({ status: HttpStatus.OK, description: 'User profile retrieved successfully.', type: UserProfileDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized.' })
  async getProfile(@Req() req: AuthenticatedRequest): Promise<UserProfileDto> {
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    return {
      id: user.id,
      isDemo: user.isDemo,
      displayName: user.displayName ?? null,
    };
  }

  @Post('api-keys')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3600000 } }) // 5 keys per hour
  @ApiOperation({
    summary: 'Generate a new API key',
    description: 'Creates an API key with read scope. The raw key is returned only once — save it immediately.',
  })
  @ApiBody({ schema: { type: 'object', properties: { description: { type: 'string', maxLength: 100 } }, required: ['description'] } })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'API key created. Save the apiKey value — it will not be shown again.',
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'The raw API key — shown once only' },
        keyInfo: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            prefix: { type: 'string' },
            description: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized.' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many keys generated. Limit: 5 per hour.' })
  async createApiKey(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateApiKeyDto,
  ) {
    const user = req.user;
    if (!user) throw new ForbiddenException('User not authenticated');

    return this.apiKeyService.createApiKey({
      userId: user.id,
      description: body.description,
      scopes: ['read'],
    });
  }

  @Get('api-keys')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: "List the authenticated user's API keys" })
  @ApiResponse({ status: HttpStatus.OK, description: 'API keys retrieved.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized.' })
  async listApiKeys(@Req() req: AuthenticatedRequest) {
    const user = req.user;
    if (!user) throw new ForbiddenException('User not authenticated');

    return this.apiKeyService.listUserApiKeys(user.id);
  }

  @Delete('api-keys/:keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'API key revoked.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized or key belongs to another user.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'API key not found.' })
  async revokeApiKey(
    @Req() req: AuthenticatedRequest,
    @Param('keyId') keyId: string,
  ): Promise<void> {
    const user = req.user;
    if (!user) throw new ForbiddenException('User not authenticated');

    await this.apiKeyService.revokeApiKey(user.id, keyId);
  }
}
