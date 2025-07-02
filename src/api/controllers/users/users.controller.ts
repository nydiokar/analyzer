import { Controller, Get, Req, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { UserProfileDto } from '../../users/user-profile.dto';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth()
export class UsersController {
  constructor() {}

  @Get('me')
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