import { Module } from '@nestjs/common';
import { BehaviorService } from './behavior.service';
import { DatabaseModule } from '../database/database.module'; // BehaviorService might need DatabaseService

@Module({
  imports: [DatabaseModule], // Import DatabaseModule if NestBehaviorService injects NestDatabaseService
  providers: [BehaviorService],
  exports: [BehaviorService], // Export BehaviorService so ApiModule (and others) can use it
})
export class BehaviorModule {} 