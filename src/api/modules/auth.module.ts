import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database.module';
import { AuthController } from '../controllers/auth.controller';
import { SecurityController } from '../controllers/security.controller'
import { BotIntegrationController } from '../controllers/bot-integration.controller';
import { AuthService } from '../shared/services/auth.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { ApiKeyDatabaseService } from '../shared/services/api-key-database.service';
import { JwtSecretValidatorService } from '../shared/services/jwt-secret-validator.service';
import { RefreshTokenService } from '../shared/services/refresh-token.service';
import { CsrfService } from '../shared/services/csrf.service';
import { JwtKeyRotationService } from '../shared/services/jwt-key-rotation.service';
import { ApiKeyService } from '../shared/services/api-key.service';
import { SecurityCleanupService } from '../shared/services/security-cleanup.service';
import { AdvancedThrottlerService } from '../shared/services/advanced-throttler.service';
import { SecurityLoggerService } from '../shared/services/security-logger.service';
import { SecurityAlertsService } from '../shared/services/security-alerts.service';
import { EmailService } from '../shared/services/email.service';
import { EmailEventService } from '../shared/services/email-event.service';
import { JwtStrategy } from '../shared/strategies/jwt.strategy';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { CsrfGuard } from '../shared/guards/csrf.guard';
import { AdvancedThrottlerGuard } from '../shared/guards/advanced-throttler.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { EmailWebhookController } from '../controllers/email-webhook.controller';

@Global()
@Module({
  imports: [
    DatabaseModule, // Required for JwtDatabaseService and ApiKeyDatabaseService
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ThrottlerModule,
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
            expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '30m') as any, // Changed from 7d to 30m for short-lived tokens
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, SecurityController, BotIntegrationController, EmailWebhookController],
  providers: [
    JwtDatabaseService,
    ApiKeyDatabaseService,    // Pure API key data access (required by ApiKeyService)
    JwtSecretValidatorService,
    RefreshTokenService,
    CsrfService,
    JwtKeyRotationService,
    ApiKeyService,             // Depends on ApiKeyDatabaseService + JwtDatabaseService
    SecurityCleanupService,
    AdvancedThrottlerService,
    SecurityLoggerService,
    SecurityAlertsService,
    EmailService,
    EmailEventService,
    AuthService,
    JwtStrategy,
    CompositeAuthGuard,
    CsrfGuard,
    AdvancedThrottlerGuard,
    AdminGuard,
  ],
  exports: [
    JwtDatabaseService,
    RefreshTokenService,
    CsrfService,
    JwtKeyRotationService,
    ApiKeyService,
    AuthService,
    JwtStrategy,
    CompositeAuthGuard,
    CsrfGuard,
    AdvancedThrottlerService,
    SecurityLoggerService,
    SecurityAlertsService,
    AdvancedThrottlerGuard,
    AdminGuard,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}
