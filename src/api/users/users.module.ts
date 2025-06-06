import { Module } from '@nestjs/common';
import { UserFavoritesController } from '../controllers/users/user-favorites.controller';
import { UserFavoritesService } from './user-favorites.service';
import { UsersController } from '../controllers/users/users.controller';

@Module({
  imports: [],
  controllers: [UserFavoritesController, UsersController],
  providers: [UserFavoritesService],
  exports: [UserFavoritesService], // Export if other modules might need this service directly
})
export class UsersModule {} 