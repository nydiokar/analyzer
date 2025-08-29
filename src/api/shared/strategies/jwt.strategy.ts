import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from '../services/auth.service';
import { User } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    this.logger.debug(`Validating JWT payload for user: ${payload.sub}`);

    // Validate the payload structure
    if (!payload.sub || !payload.email) {
      this.logger.warn('Invalid JWT payload structure');
      throw new UnauthorizedException('Invalid token payload');
    }

    // Get user from database to ensure they're still active
    const user = await this.authService.validateUserById(payload.sub);
    
    if (!user) {
      this.logger.warn(`JWT validation failed: user not found or inactive: ${payload.sub}`);
      throw new UnauthorizedException('User not found or inactive');
    }

    // Update last seen timestamp
    await this.authService.updateLastSeen(user.id);

    this.logger.debug(`JWT validation successful for user: ${user.id}`);
    return user;
  }
}