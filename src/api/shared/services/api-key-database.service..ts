/**
 * ApiKeyDatabaseService
 * This service is responsible for the database operations for the API keys.
 * It is used to create, update, delete, and find API keys.
 * It is also used to validate API keys.
 * It is also used to find API keys by prefix.
 * It is also used to find API keys by user ID.
 * It is also used to find API keys by user email.
 * It is also used to find API keys by user ID.
 */

/**this is mock implementation of the ApiKeyDatabaseService */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../services/database.service';


@Injectable()
export class ApiKeyDatabaseService {
  constructor(private readonly databaseService: DatabaseService) {}
}

