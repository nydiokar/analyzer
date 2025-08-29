import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from '../controllers/auth.controller';
import { AuthService } from '../shared/services/auth.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { JwtStrategy } from '../shared/strategies/jwt.strategy';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const jwtSecret = configService.get<string>('JWT_SECRET');
        if (!jwtSecret) {
          throw new Error('JWT_SECRET environment variable is not set');
        }
        
        return {
          secret: jwtSecret,
          signOptions: {
            expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtDatabaseService,
    AuthService,
    JwtStrategy,
    CompositeAuthGuard,
  ],
  exports: [
    JwtDatabaseService,
    AuthService,
    JwtStrategy,
    CompositeAuthGuard,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}