import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../modules/database.module';
import { UserFavoritesService } from '../services/user-favorites.service';
import { UserWatchedTokensService } from '../services/user-watched-tokens.service';
import { UserFavoritesController } from '../controllers/user-favorites.controller';
import { UserWatchedTokensController } from '../controllers/user-watched-tokens.controller';
import { UsersController } from '../controllers/users.controller';
import { ApiKeyService } from '../shared/services/api-key.service';
import { ApiKeyDatabaseService } from '../shared/services/api-key-database.service';
import { JwtDatabaseService } from '../shared/services/jwt-database.service';
import { MessagesModule } from './messages.module';

@Module({
  imports: [DatabaseModule, ConfigModule, MessagesModule], // AuthModule is @Global and imported in AppModule
  providers: [UserFavoritesService, UserWatchedTokensService, ApiKeyService, ApiKeyDatabaseService, JwtDatabaseService],
  controllers: [UserFavoritesController, UserWatchedTokensController, UsersController],
  exports: [UserFavoritesService, UserWatchedTokensService],
})
export class UsersModule {}
