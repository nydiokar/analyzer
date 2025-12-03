import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../services/database.service';


@Injectable()
export class ApiKeyDatabaseService {
  constructor(private readonly databaseService: DatabaseService) {}
}

