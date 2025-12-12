import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly adminUserIds: Set<string>;
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    const ids = (this.configService.get<string>('ADMIN_USER_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const emails = (this.configService.get<string>('ADMIN_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    this.adminUserIds = new Set(ids);
    this.adminEmails = new Set(emails);
    
    if (this.adminUserIds.size > 0 || this.adminEmails.size > 0) {
      this.logger.log(`AdminGuard initialized with ${this.adminUserIds.size} admin IDs and ${this.adminEmails.size} admin emails`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isAdminOnly = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isAdminOnly) {
      return true; // Not an admin-only route
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      this.logger.warn('AdminGuard: No user found on request (auth guard should have run first)');
      throw new ForbiddenException('Authentication required for admin endpoints');
    }

    const isAdminId = user.id && this.adminUserIds.has(user.id);
    const isAdminEmail = user.email && this.adminEmails.has(user.email.toLowerCase());

    if (isAdminId || isAdminEmail) {
      this.logger.debug(`Admin access granted to user ${user.id}`);
      return true;
    }

    this.logger.warn(`Admin access denied for user ${user.id} (${user.email})`);
    throw new ForbiddenException('This endpoint requires administrator privileges');
  }

  /**
   * Check if a user is an admin (public helper method)
   */
  isUserAdmin(user: User | undefined): boolean {
    if (!user) return false;

    const isAdminId = user.id && this.adminUserIds.has(user.id);
    const isAdminEmail = user.email && this.adminEmails.has(user.email.toLowerCase());

    return !!(isAdminId || isAdminEmail);
  }
}
