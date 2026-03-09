import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_ANALYST_KEY } from '../decorators/analyst.decorator';
import { User } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@Injectable()
export class AnalystGuard implements CanActivate {
  private readonly logger = new Logger(AnalystGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isAnalyst = this.reflector.getAllAndOverride<boolean>(IS_ANALYST_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isAnalyst) {
      return true; // Not an analyst-only route
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      this.logger.warn('AnalystGuard: No user found on request (auth guard should have run first)');
      throw new ForbiddenException('Authentication required for analyst endpoints');
    }

    if (user.isAnalyst === true || user.isAdmin === true) {
      this.logger.debug(`Analyst access granted to user ${user.id}`);
      return true;
    }

    this.logger.warn(`Analyst access denied for user ${user.id} (${user.email}) - isAnalyst and isAdmin flags are not set`);
    throw new ForbiddenException('This endpoint requires analyst privileges');
  }
}
