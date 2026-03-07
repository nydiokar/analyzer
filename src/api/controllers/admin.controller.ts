import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpStatus, Logger, ValidationPipe, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody, ApiProperty } from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { AdminOnly } from '../shared/decorators/admin-only.decorator';
import { ApiKeyService, ApiKeyScope } from '../shared/services/api-key.service';
import { RegistrationCodeService, CreateRegistrationCodeDto } from '../shared/services/registration-code.service';
import { DatabaseService } from '../services/database.service';
import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber, Min, Max, IsInt, IsDateString, IsBoolean } from 'class-validator';

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

// Registration Code DTOs
class CreateCodeDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

class GrantCreditsDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

class CreateBulkCodesDto {
  @IsInt()
  @Min(1)
  @Max(100)
  count: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// User List DTOs
class UserListItemDto {
  @ApiProperty({ description: 'Unique user ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'User email address', nullable: true })
  @IsString()
  @IsOptional()
  email: string | null;

  @ApiProperty({ description: 'Display name', nullable: true })
  @IsString()
  @IsOptional()
  displayName: string | null;

  @ApiProperty({ description: 'User description', nullable: true })
  @IsString()
  @IsOptional()
  description: string | null;

  @ApiProperty({ description: 'Is admin user' })
  @IsBoolean()
  isAdmin: boolean;

  @ApiProperty({ description: 'Account active status' })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ description: 'Is demo account' })
  @IsBoolean()
  isDemo: boolean;

  @ApiProperty({ description: 'Email verified status' })
  @IsBoolean()
  emailVerified: boolean;

  @ApiProperty({ description: 'Account creation timestamp', type: 'string', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ description: 'Last login timestamp', nullable: true, type: 'string', format: 'date-time' })
  @IsOptional()
  lastLoginAt: Date | null;

  @ApiProperty({ description: 'Last activity timestamp', nullable: true, type: 'string', format: 'date-time' })
  @IsOptional()
  lastSeenAt: Date | null;

  @ApiProperty({ description: 'Current credit balance', nullable: true })
  @IsOptional()
  @IsNumber()
  credits: number | null;
}

class UsersListResponseDto {
  @ApiProperty({ type: [UserListItemDto], description: 'List of users' })
  @IsArray()
  users: UserListItemDto[];

  @ApiProperty({ description: 'Total number of users matching the filter' })
  @IsNumber()
  total: number;

  @ApiProperty({ description: 'Number of results per page' })
  @IsNumber()
  limit: number;

  @ApiProperty({ description: 'Number of results skipped' })
  @IsNumber()
  offset: number;
}

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Admin')
@Controller('admin')
@AdminOnly()
@ApiBearerAuth()
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly registrationCodeService: RegistrationCodeService,
    private readonly databaseService: DatabaseService,
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

  // ========================================
  // REGISTRATION CODES
  // ========================================

  @Post('registration-codes')
  @ApiOperation({ summary: 'Create a new registration code (admin only)' })
  @ApiBody({ type: CreateCodeDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Registration code created successfully' })
  async createRegistrationCode(@Body() dto: CreateCodeDto, @Req() req: AuthenticatedRequest) {
    const adminId = req.user?.id;
    const createDto: CreateRegistrationCodeDto = {
      description: dto.description,
      maxUses: dto.maxUses,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdBy: adminId,
    };
    const code = await this.registrationCodeService.createCode(createDto);
    this.logger.log(`Admin ${adminId} created registration code ${code.code}`);
    return code;
  }

  @Post('registration-codes/bulk')
  @ApiOperation({ summary: 'Create multiple registration codes at once (admin only)' })
  @ApiBody({ type: CreateBulkCodesDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Registration codes created successfully' })
  async createBulkRegistrationCodes(@Body() dto: CreateBulkCodesDto, @Req() req: AuthenticatedRequest) {
    const adminId = req.user?.id;
    const createDto: CreateRegistrationCodeDto = {
      description: dto.description,
      maxUses: dto.maxUses,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdBy: adminId,
    };
    const codes = await this.registrationCodeService.createBulkCodes(dto.count, createDto);
    this.logger.log(`Admin ${adminId} created ${dto.count} registration codes in bulk`);
    return codes;
  }

  @Get('registration-codes')
  @ApiOperation({ summary: 'List all registration codes (admin only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'used', 'revoked'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of registration codes' })
  async listRegistrationCodes(@Query('status') status?: string, @Query('limit') limit?: number) {
    return this.registrationCodeService.listCodes(status, limit);
  }

  @Get('registration-codes/stats')
  @ApiOperation({ summary: 'Get registration code statistics (admin only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Registration code statistics' })
  async getRegistrationCodeStats() {
    return this.registrationCodeService.getStats();
  }

  @Patch('registration-codes/:code/revoke')
  @ApiOperation({ summary: 'Revoke a registration code (admin only)' })
  @ApiParam({ name: 'code', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'Code revoked successfully' })
  async revokeRegistrationCode(@Param('code') code: string, @Req() req: AuthenticatedRequest) {
    await this.registrationCodeService.revokeCode(code);
    this.logger.log(`Admin ${req.user?.id} revoked registration code ${code}`);
    return { success: true, message: 'Registration code revoked successfully' };
  }

  @Delete('registration-codes/:code')
  @ApiOperation({ summary: 'Permanently delete a registration code (admin only)' })
  @ApiParam({ name: 'code', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'Code deleted successfully' })
  async deleteRegistrationCode(@Param('code') code: string, @Req() req: AuthenticatedRequest) {
    await this.registrationCodeService.deleteCode(code);
    this.logger.log(`Admin ${req.user?.id} permanently deleted registration code ${code}`);
    return { success: true, message: 'Registration code deleted successfully' };
  }

  // ========================================
  // REGISTRATION KILL-SWITCH
  // ========================================

  @Get('registration/kill-switch')
  @ApiOperation({ summary: 'Get registration kill-switch status (admin only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Kill-switch status' })
  async getKillSwitchStatus() {
    return this.registrationCodeService.getKillSwitchStatus();
  }

  @Post('registration/kill-switch/enable')
  @ApiOperation({
    summary: 'Enable registration kill-switch - block all new registrations (admin only)',
    description: 'Emergency control to immediately halt all new user registrations. Existing users are not affected.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Registration kill-switch enabled' })
  async enableKillSwitch(@Req() req: AuthenticatedRequest) {
    await this.registrationCodeService.enableKillSwitch();
    this.logger.warn(`🚨 Admin ${req.user?.id} (${req.user?.email}) ENABLED registration kill-switch`);
    return { success: true, message: 'Registration kill-switch enabled. All new registration attempts will be blocked.' };
  }

  @Post('registration/kill-switch/disable')
  @ApiOperation({
    summary: 'Disable registration kill-switch - allow registrations (admin only)',
    description: 'Re-enable user registrations after emergency shutdown.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Registration kill-switch disabled' })
  async disableKillSwitch(@Req() req: AuthenticatedRequest) {
    await this.registrationCodeService.disableKillSwitch();
    this.logger.log(`✅ Admin ${req.user?.id} (${req.user?.email}) DISABLED registration kill-switch`);
    return { success: true, message: 'Registration kill-switch disabled. New registrations are now allowed.' };
  }

  // ========================================
  // CODE REQUIREMENT TOGGLE
  // ========================================

  @Get('registration/code-requirement')
  @ApiOperation({ summary: 'Get code requirement status (admin only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Code requirement status' })
  async getCodeRequirementStatus() {
    return this.registrationCodeService.getCodeRequirementStatus();
  }

  @Post('registration/code-requirement/enable')
  @ApiOperation({
    summary: 'Require registration codes (admin only)',
    description: 'Make registration codes mandatory. Users must provide a valid code to register.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Code requirement enabled' })
  async requireCodes(@Req() req: AuthenticatedRequest) {
    await this.registrationCodeService.requireCodes();
    this.logger.log(`Admin ${req.user?.id} (${req.user?.email}) ENABLED code requirement`);
    return { success: true, message: 'Registration codes are now required.' };
  }

  @Post('registration/code-requirement/disable')
  @ApiOperation({
    summary: 'Make registration codes optional - open registration (admin only)',
    description: 'Allow anyone to register without a code. ⚠️ Use with caution in production.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Code requirement disabled - open registration' })
  async makeCodesOptional(@Req() req: AuthenticatedRequest) {
    await this.registrationCodeService.makeCodesOptional();
    this.logger.warn(`⚠️  Admin ${req.user?.id} (${req.user?.email}) DISABLED code requirement - OPEN REGISTRATION`);
    return { success: true, message: 'Registration codes are now optional. Anyone can register.' };
  }

  // ========================================
  // USER MANAGEMENT
  // ========================================

  @Get('users')
  @ApiOperation({
    summary: 'List all users with filtering and pagination (admin only)',
    description: 'Retrieve a paginated list of users with optional search and filtering by status, admin, or demo flags.',
  })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by email or display name (case-insensitive)' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Filter by active status' })
  @ApiQuery({ name: 'isAdmin', required: false, type: Boolean, description: 'Filter by admin status' })
  @ApiQuery({ name: 'isDemo', required: false, type: Boolean, description: 'Filter by demo status' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'lastLoginAt', 'lastSeenAt', 'email', 'credits'], description: 'Field to sort by (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort direction (default: desc)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50, description: 'Max results per page (default: 50, max: 1000)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0, description: 'Number of results to skip (default: 0)' })
  @ApiQuery({ name: 'neverLoggedIn', required: false, type: Boolean, description: 'Filter users who have never logged in' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of users', type: UsersListResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required' })
  async listUsers(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('isAdmin') isAdmin?: string,
    @Query('isDemo') isDemo?: string,
    @Query('neverLoggedIn') neverLoggedInStr?: string,
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('sortOrder') sortOrder: string = 'desc',
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ): Promise<UsersListResponseDto> {
    const limit = Math.min(Math.max(1, parseInt(limitStr || '50', 10)), 1000);
    const offset = Math.max(0, parseInt(offsetStr || '0', 10));

    const parseBoolean = (val: string | undefined): boolean | undefined => {
      if (val === undefined) return undefined;
      return val.toLowerCase() === 'true';
    };

    const filters: {
      search?: string;
      isActive?: boolean;
      isAdmin?: boolean;
      isDemo?: boolean;
      neverLoggedIn?: boolean;
    } = {};

    if (search) filters.search = search;
    filters.isActive = parseBoolean(isActive);
    filters.isAdmin = parseBoolean(isAdmin);
    filters.isDemo = parseBoolean(isDemo);
    if (neverLoggedInStr === 'true') filters.neverLoggedIn = true;

    const validSortFields = ['createdAt', 'lastLoginAt', 'lastSeenAt', 'email', 'credits'];
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const finalSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

    this.logger.log(`Listing users: filters=${JSON.stringify(filters)}, sort=${finalSortBy}:${finalSortOrder}, limit=${limit}, offset=${offset}`);

    const result = await this.databaseService.listUsers(limit, offset, filters, finalSortBy, finalSortOrder as 'asc' | 'desc');

    // Map to DTO (database already selects only safe fields)
    return {
      users: result.users as UserListItemDto[],
      total: result.total,
      limit,
      offset,
    };
  }

  @Patch('users/:userId/disable')
  @ApiOperation({
    summary: 'Disable a user account (admin only)',
    description: 'Sets isActive=false to prevent user from accessing the system. User data is preserved.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'User account disabled successfully' })
  async disableUser(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const user = await this.databaseService.deactivateUser(userId);
    if (!user) {
      return { success: false, message: `User ${userId} not found` };
    }
    this.logger.warn(`Admin ${req.user?.id} disabled user ${userId}`);
    return { success: true, message: `User ${userId} has been disabled` };
  }

  @Patch('users/:userId/enable')
  @ApiOperation({
    summary: 'Re-enable a disabled user account (admin only)',
    description: 'Sets isActive=true to restore user access.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'User account enabled successfully' })
  async enableUser(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const user = await this.databaseService.activateUser(userId);
    if (!user) {
      return { success: false, message: `User ${userId} not found` };
    }
    this.logger.log(`Admin ${req.user?.id} enabled user ${userId}`);
    return { success: true, message: `User ${userId} has been enabled` };
  }

  // ========================================
  // CREDITS
  // ========================================

  @Post('users/:userId/credits')
  @ApiOperation({ summary: 'Grant credits to a user (admin only)' })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({ type: GrantCreditsDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Credits granted successfully' })
  async grantCredits(
    @Param('userId') userId: string,
    @Body(ValidationPipe) dto: GrantCreditsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.databaseService.grantCredits(userId, dto.amount, dto.reason ?? 'admin_grant');
    this.logger.log(`Admin ${req.user?.id} granted ${dto.amount} credits to user ${userId}. New balance: ${result.credits}`);
    return { success: true, credits: result.credits };
  }

  @Get('credits/transactions')
  @ApiOperation({ summary: 'List all credit transactions (admin only)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'Credit transactions list' })
  async listCreditTransactions(
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('userId') userId?: string,
  ) {
    const limit = Math.min(Math.max(1, parseInt(limitStr || '50', 10)), 500);
    const offset = Math.max(0, parseInt(offsetStr || '0', 10));
    return this.databaseService.listCreditTransactions(limit, offset, userId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get system-wide stats (admin only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'System stats' })
  async getSystemStats() {
    return this.databaseService.getSystemStats();
  }
}
