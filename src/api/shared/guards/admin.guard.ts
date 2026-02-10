import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly reflector: Reflector) {}

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

    // Check database isAdmin field (no restart needed to add/remove admins)
    if (user.isAdmin === true) {
      this.logger.debug(`Admin access granted to user ${user.id}`);
      return true;
    }

    this.logger.warn(`Admin access denied for user ${user.id} (${user.email}) - isAdmin flag is not set`);
    throw new ForbiddenException('This endpoint requires administrator privileges');
  }

  /**
   * Check if a user is an admin (public helper method)
   */
  isUserAdmin(user: User | undefined): boolean {
    if (!user) return false;
    return user.isAdmin === true;
  }
}
