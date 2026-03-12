import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../modules/database.module';
import { UserFavoritesService } from '../services/user-favorites.service';
import { UserFavoritesController } from '../controllers/user-favorites.controller';
import { UsersController } from '../controllers/users.controller';
import { ApiKeyService } from '../shared/services/api-key.service';
import { ApiKeyDatabaseService } from '../shared/services/api-key-database.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';

@Module({
  imports: [DatabaseModule, ConfigModule], // AuthModule is @Global and imported in AppModule
  providers: [UserFavoritesService, ApiKeyService, ApiKeyDatabaseService, JwtDatabaseService],
  controllers: [UserFavoritesController, UsersController],
  exports: [UserFavoritesService],
})
export class UsersModule {}