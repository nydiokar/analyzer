import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from '../services/auth.service';
import { JwtKeyRotationService } from '../services/jwt-key-rotation.service';
import { User } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly keyRotationService: JwtKeyRotationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (request, rawJwtToken, done) => {
        try {
          // Extract kid from JWT header
          const decoded = this.decodeJwtHeader(rawJwtToken);
          const keyId = decoded?.kid;
          
          if (keyId) {
            // Get key by ID
            const key = keyRotationService.getKey(keyId);
            if (key && key.isActive) {
              done(null, key.secret);
              return;
            }
            this.logger.warn(`JWT key not found or inactive: ${keyId}`);
          }
          
          // Fallback to default key for backward compatibility
          const fallbackSecret = configService.get<string>('JWT_SECRET');
          if (fallbackSecret) {
            done(null, fallbackSecret);
          } else {
            done(new UnauthorizedException('JWT key not found'), null);
          }
        } catch (error) {
          this.logger.error('Error in JWT key resolution:', error);
          done(new UnauthorizedException('JWT key resolution failed'), null);
        }
      },
    });
  }

  private decodeJwtHeader(token: string): any {
    try {
      const headerB64 = token.split('.')[0];
      const headerJson = Buffer.from(headerB64, 'base64url').toString();
      return JSON.parse(headerJson);
    } catch (error) {
      this.logger.warn('Failed to decode JWT header:', error);
      return null;
    }
  }

  async validate(payload: JwtPayload): Promise<User> {
    this.logger.debug(`Validating JWT payload for user: ${payload.sub}`);

    // Validate the payload structure
    if (!payload.sub || !payload.email) {
      this.logger.warn('Invalid JWT payload structure');
      throw new UnauthorizedException('Invalid token payload');
    }

    // Enhanced JWT validation
    await this.validateEnhancedClaims(payload);

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

  private async validateEnhancedClaims(payload: JwtPayload): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = 120; // 2 minutes tolerance

    // Validate issuer (iss)
    const expectedIssuer = this.configService.get<string>('JWT_ISSUER') || 'analyzer-api';
    if (payload.iss && payload.iss !== expectedIssuer) {
      this.logger.warn(`Invalid JWT issuer: expected ${expectedIssuer}, got ${payload.iss}`);
      throw new UnauthorizedException('Invalid token issuer');
    }

    // Validate audience (aud)
    const expectedAudience = this.configService.get<string>('JWT_AUDIENCE') || 'analyzer-client';
    if (payload.aud && payload.aud !== expectedAudience) {
      this.logger.warn(`Invalid JWT audience: expected ${expectedAudience}, got ${payload.aud}`);
      throw new UnauthorizedException('Invalid token audience');
    }

    // Validate not before (nbf) with clock skew tolerance
    if (payload.nbf && payload.nbf > (now + clockSkew)) {
      this.logger.warn(`JWT not yet valid: nbf=${payload.nbf}, now=${now}`);
      throw new UnauthorizedException('Token not yet valid');
    }

    // Additional validation: ensure iat (issued at) is not too far in the future
    if (payload.iat && payload.iat > (now + clockSkew)) {
      this.logger.warn(`JWT issued in future: iat=${payload.iat}, now=${now}`);
      throw new UnauthorizedException('Token issued in future');
    }
  }
}