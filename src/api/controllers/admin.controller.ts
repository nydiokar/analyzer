import { Controller, Get, Post, Patch, Delete, Body, Param, HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminOnly } from '../shared/decorators/admin-only.decorator';
import { ApiKeyService, ApiKeyScope } from '../shared/services/api-key.service';
import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber, Min } from 'class-validator';

// Response DTOs
class ApiKeyInfoDto {
  @IsString()
  id: string;

  @IsString()
  prefix: string;

  @IsString()
  userId: string;

  @IsString()
  @IsOptional()
  userEmail?: string | null;

  @IsString()
  @IsOptional()
  userDescription?: string | null;

  @IsString()
  description: string;

  @IsArray()
  @IsString({ each: true })
  scopes: ApiKeyScope[];

  @IsString()
  isActive: boolean;

  @IsString()
  @IsOptional()
  lastUsedAt?: Date | null;

  @IsString()
  @IsOptional()
  expiresAt?: Date | null;

  @IsString()
  createdAt: Date;
}

class AdminResponseDto {
  @IsString()
  success: boolean;

  @IsString()
  message: string;
}

// DTOs
class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @IsString({ each: true })
  scopes: ApiKeyScope[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  expiresInDays?: number;
}

class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: ApiKeyScope[];
}

@ApiTags('Admin')
@Controller('admin')
@AdminOnly()
@ApiBearerAuth()
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
  ) {}

  /**
   * List all API keys
   */
  @Get('api-keys')
  @ApiOperation({ summary: 'List all API keys (admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API keys retrieved successfully',
    type: [ApiKeyInfoDto]
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required' })
  async listApiKeys(): Promise<ApiKeyInfoDto[]> {
    this.logger.log('Admin: Listing all API keys');
    return await this.apiKeyService.listAllApiKeys();
  }

  /**
   * Create new API key
   */
  @Post('api-keys')
  @ApiOperation({ summary: 'Create new API key (admin only)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'API key created successfully',
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'The full API key - SAVE THIS NOW!' },
        keyInfo: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            prefix: { type: 'string' },
            userId: { type: 'string' },
            description: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            isActive: { type: 'boolean' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          }
        }
      }
    }
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid request data' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required' })
  async createApiKey(@Body(ValidationPipe) dto: CreateApiKeyDto) {
    this.logger.log(`Admin: Creating API key for user ${dto.userId}`);

    const result = await this.apiKeyService.createApiKey({
      userId: dto.userId,
      description: dto.description,
      scopes: dto.scopes,
      expiresInDays: dto.expiresInDays,
    });

    return result;
  }

  /**
   * Revoke (deactivate) an API key
   */
  @Patch('api-keys/:keyId/revoke')
  @ApiOperation({ summary: 'Revoke an API key (admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API key revoked successfully',
    type: AdminResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'API key not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required' })
  async revokeApiKey(@Param('keyId') keyId: string): Promise<AdminResponseDto> {
    this.logger.log(`Admin: Revoking API key ${keyId}`);
    return await this.apiKeyService.revokeApiKeyAsAdmin(keyId);
  }

  /**
   * Update an API key
   */
  @Patch('api-keys/:keyId')
  @ApiOperation({ summary: 'Update API key metadata (admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API key updated successfully',
    type: AdminResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'API key not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required' })
  async updateApiKey(
    @Param('keyId') keyId: string,
    @Body(ValidationPipe) dto: UpdateApiKeyDto
  ): Promise<AdminResponseDto> {
    this.logger.log(`Admin: Updating API key ${keyId}`);

    return await this.apiKeyService.updateApiKeyAsAdmin(keyId, {
      description: dto.description,
      scopes: dto.scopes,
    });
  }

  /**
   * Delete an API key permanently
   */
  @Delete('api-keys/:keyId')
  @ApiOperation({ summary: 'Delete API key permanently (admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API key deleted successfully',
    type: AdminResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'API key not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required' })
  async deleteApiKey(@Param('keyId') keyId: string): Promise<AdminResponseDto> {
    this.logger.log(`Admin: Deleting API key ${keyId}`);
    return await this.apiKeyService.deleteApiKey(keyId);
  }
}
