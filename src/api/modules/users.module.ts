import { Module } from '@nestjs/common';
import { DatabaseModule } from '../modules/database.module';
import { UserFavoritesService } from '../services/user-favorites.service';
import { UserFavoritesController } from '../controllers/user-favorites.controller';
import { UsersController } from '../controllers/users.controller';

@Module({
  imports: [DatabaseModule],
  providers: [UserFavoritesService],
  controllers: [UserFavoritesController, UsersController],
  exports: [UserFavoritesService],
})
export class UsersModule {} 