import { Module } from '@nestjs/common';
import { UserFavoritesController } from '../controllers/users/user-favorites.controller';
import { UserFavoritesService } from './user-favorites.service';
import { DatabaseModule } from '../database/database.module'; // Assuming DatabaseService is provided here

@Module({
  imports: [DatabaseModule], // Import if DatabaseService is exported from DatabaseModule
  controllers: [UserFavoritesController],
  providers: [UserFavoritesService],
  exports: [UserFavoritesService], // Export if other modules might need this service directly
})
export class UsersModule {} 