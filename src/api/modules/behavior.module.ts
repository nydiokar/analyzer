import { Module } from '@nestjs/common';
import { BehaviorService } from '../services/behavior.service';
import { DatabaseModule } from '../modules/database.module'; // BehaviorService might need DatabaseService

@Module({
  imports: [DatabaseModule], // Import DatabaseModule if NestBehaviorService injects NestDatabaseService
  providers: [BehaviorService],
  exports: [BehaviorService], // Export BehaviorService so ApiModule (and others) can use it
})
export class BehaviorModule {} 