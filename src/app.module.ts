import { Module } from '@nestjs/common';
import { ApiModule } from './api.module';
import { ConfigModule } from '@nestjs/config'; // For .env variable support
import { HeliusModule } from './api/helius/helius.module'; // Import the global HeliusModule
import { DatabaseModule } from './api/database/database.module'; // Import the global DatabaseModule
import { UsersModule } from 'api/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ // Initialize ConfigModule to load .env variables
      isGlobal: true, // Make ConfigModule global
    }),
    DatabaseModule, // Import DatabaseModule (it's @Global, so its providers are available everywhere)
    HeliusModule, // Import HeliusModule (it's @Global, so its providers are available everywhere)
    ApiModule,
    UsersModule,
  ],
})
export class AppModule {} 