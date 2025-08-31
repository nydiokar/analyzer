import { Controller, Get, Req, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { UserProfileDto } from '../shared/dto/user-profile.dto';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth()
export class UsersController {
  constructor() {}

  @Get('me')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute for profile access
  @ApiOperation({ summary: "Get the authenticated user's profile" })
  @ApiResponse({ status: HttpStatus.OK, description: 'User profile retrieved successfully.', type: UserProfileDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized.' })
  async getProfile(@Req() req: AuthenticatedRequest): Promise<UserProfileDto> {
    const user = req.user!;
    return {
      id: user.id,
      isDemo: user.isDemo,
    };
  }
} 