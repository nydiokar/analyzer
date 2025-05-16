import { Injectable } from '@nestjs/common';
import { DatabaseService as ExternalDatabaseService } from '../../core/services/database-service';

@Injectable()
export class DatabaseService extends ExternalDatabaseService {
  constructor() {
    super(); // Call the constructor of ExternalDatabaseService
    // You can add any NestJS specific initialization here if needed in the future
  }
  // No need to redefine methods, they are inherited.
  // This wrapper allows ExternalDatabaseService to be injected via NestJS DI.
} 