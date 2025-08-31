import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from '../controllers/auth.controller';\nimport { SecurityController } from '../controllers/security.controller';
import { AuthService } from '../shared/services/auth.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { JwtSecretValidatorService } from '../shared/services/jwt-secret-validator.service';
import { SecurityCleanupService } from '../shared/services/security-cleanup.service';
import { AdvancedThrottlerService } from '../shared/services/advanced-throttler.service';
import { SecurityLoggerService } from '../shared/services/security-logger.service';
import { SecurityAlertsService } from '../shared/services/security-alerts.service';
import { JwtStrategy } from '../shared/strategies/jwt.strategy';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { AdvancedThrottlerGuard } from '../shared/guards/advanced-throttler.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const jwtSecret = configService.get<string>('JWT_SECRET');
        
        // Validate JWT secret security
        const validator = new JwtSecretValidatorService();
        const validation = validator.validateJwtSecret(jwtSecret);
        
        if (!validation.valid) {
          const recommendations = validator.getSecurityRecommendations();
          console.error('\n🚨 CRITICAL SECURITY ERROR: Insecure JWT Secret Configuration\n');
          console.error('Validation Errors:');
          validation.errors.forEach(error => console.error(`  ❌ ${error}`));
          console.error('\nSecurity Recommendations:');
          recommendations.forEach(rec => console.error(`  💡 ${rec}`));
          console.error(`\n🔐 Generate a secure secret: node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"`);          
          throw new Error(`JWT_SECRET validation failed: ${validation.errors.join('; ')}`);
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
  controllers: [AuthController, SecurityController],
  providers: [
    JwtDatabaseService,
    JwtSecretValidatorService,
    SecurityCleanupService,
    AdvancedThrottlerService,
    SecurityLoggerService,
    SecurityAlertsService,
    AuthService,
    JwtStrategy,
    CompositeAuthGuard,
    AdvancedThrottlerGuard,
  ],
  exports: [
    JwtDatabaseService,
    AuthService,
    JwtStrategy,
    CompositeAuthGuard,
    AdvancedThrottlerService,
    SecurityLoggerService,
    SecurityAlertsService,
    AdvancedThrottlerGuard,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}