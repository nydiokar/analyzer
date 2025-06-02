import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService], // Export DatabaseService so other modules can use it
})
export class DatabaseModule {} 