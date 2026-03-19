import { Controller, Get, Post, Param, Body, Req, ForbiddenException } from '@nestjs/common';
import { User } from '@prisma/client';
import { UserWatchedTokensService } from '../services/user-watched-tokens.service';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@Controller('users/me/watched-tokens')
export class UserWatchedTokensController {
  constructor(private readonly userWatchedTokensService: UserWatchedTokensService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    return this.userWatchedTokensService.listForUser(userId);
  }

  @Post(':tokenAddress/watch')
  async setWatch(
    @Param('tokenAddress') tokenAddress: string,
    @Body('on') on: boolean,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    return this.userWatchedTokensService.setWatched(userId, tokenAddress, on === undefined ? true : !!on);
  }
}
