import { Module } from '@nestjs/common';
import { ApiModule } from './api.module';
import { ConfigModule } from '@nestjs/config'; // For .env variable support

@Module({
  imports: [
    ConfigModule.forRoot({ // Initialize ConfigModule to load .env variables
      isGlobal: true, // Make ConfigModule global
    }),
    ApiModule,
  ],
})
export class AppModule {} 