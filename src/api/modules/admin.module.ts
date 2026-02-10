import { Module } from '@nestjs/common';
import { AdminController } from '../controllers/admin.controller';
import { ApiKeyService } from '../shared/services/api-key.service';
import { ApiKeyDatabaseService } from '../shared/services/api-key-database.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { RegistrationCodeService } from '../shared/services/registration-code.service';
import { DatabaseModule } from './database.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth.module';

@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [AdminController],
  providers: [
    ApiKeyService,
    ApiKeyDatabaseService,  // Pure API key data access
    JwtDatabaseService,     // JWT/user operations only
    RegistrationCodeService,
  ],
})
export class AdminModule {}
