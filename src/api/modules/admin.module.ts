import { Module } from '@nestjs/common';
import { AdminController } from '../controllers/admin.controller';
import { ApiKeyService } from '../shared/services/api-key.service';
import { ApiKeyDatabaseService } from '../shared/services/api-key-database.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { RegistrationCodeService } from '../shared/services/registration-code.service';
import { DatabaseModule } from './database.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [DatabaseModule, ConfigModule], // AuthModule is @Global and imported in AppModule
  controllers: [AdminController],
  providers: [
    ApiKeyService,
    ApiKeyDatabaseService,  // Pure API key data access
    JwtDatabaseService,     // JWT/user operations only
    RegistrationCodeService,
  ],
})
export class AdminModule {}
