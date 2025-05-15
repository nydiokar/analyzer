import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Module({
  providers: [DatabaseService],
  exports: [DatabaseService], // Export DatabaseService so other modules can use it
})
export class DatabaseModule {} 