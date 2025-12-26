import { Module } from '@nestjs/common';
import { AdminController } from '../controllers/admin.controller';
import { ApiKeyService } from '../shared/services/api-key.service';
import { ApiKeyDatabaseService } from '../shared/services/api-key-database.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { DatabaseModule } from './database.module';
import { ConfigModule } from '@nestjs/config';
import { JobsModule } from './jobs.module';
import { AdminJobHistoryController } from '../controllers/admin-job-history.controller';

@Module({
  imports: [DatabaseModule, ConfigModule, JobsModule],
  controllers: [AdminController, AdminJobHistoryController],
  providers: [
    ApiKeyService,
    ApiKeyDatabaseService,  // Pure API key data access
    JwtDatabaseService,     // JWT/user operations only
  ],
})
export class AdminModule {}
