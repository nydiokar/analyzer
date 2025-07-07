import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UserFavoritesService } from './user-favorites.service';
import { UserFavoritesController } from '../controllers/users/user-favorites.controller';
import { UsersController } from '../controllers/users/users.controller';

@Module({
  imports: [DatabaseModule],
  providers: [UserFavoritesService],
  controllers: [UserFavoritesController, UsersController],
  exports: [UserFavoritesService],
})
export class UsersModule {} 