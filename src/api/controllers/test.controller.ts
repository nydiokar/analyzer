import { Controller, Get, Req, InternalServerErrorException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { DatabaseService } from '../services/database.service'; // Assuming this path is correct

@Controller('test-auth') // This will be accessible at /api/v1/test-auth
export class TestController {
  private readonly logger = new Logger(TestController.name);

  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  async getTestData(@Req() req: Request & { user?: any }) {
    const actionType = 'get_test_data';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { headers: req.headers, query: req.query, params: req.params };
    let activityLogId: string | null = null;
    const startTime = Date.now();

    try {
      if (userId) {
        const logEntry = await this.databaseService.logActivity(
          userId,
          actionType,
          requestParameters,
          'INITIATED',
          undefined,
          undefined,
          sourceIp
        );
        activityLogId = logEntry?.id || null;
      }

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50)); 

      const response = {
        message: 'If you see this, the endpoint is working!',
        authenticatedUserId: userId || 'User not authenticated (should not happen if middleware ran)',
      };

      if (userId && activityLogId) {
        const durationMs = Date.now() - startTime;
        // Update log to SUCCESS
        // Note: logActivity doesn't have an update mechanism, it creates a new log.
        // For simplicity here, we'll log a new SUCCESS entry. 
        // A more robust system might use an 'updateActivityLog' method or log ID with current log entry.
        // The original plan: "Record entries in the ActivityLog table (start, success, failure of actions)."
        // This can be interpreted as potentially two entries or one entry updated.
        // Let's stick to creating a new entry that signifies the end, or update if an update method is preferred.
        // For now, creating a new 'SUCCESS' entry for simplicity, linked by context.
        // A better approach would be to create the log entry with status INITIATED and then update it.
        // Let's assume DatabaseService.logActivity is intended for single log points.
        // So, we'll log the final status as a new event, or if we had an update function, use that.
        // Given the current structure of logActivity, let's make the INITIATED log more of a marker,
        // and log a final detailed one.
        // OR, more simply, for this example, just log the final outcome.
        // Let's re-evaluate. The plan mentions "start, success, failure". 
        // This suggests one log entry that gets updated, or one log per state.
        // The logActivity method defaults to INITIATED and then can be called again with SUCCESS/FAILURE.
        // However, it doesn't take an ID to update. So, it means separate log entries.
        // This is fine. Let's log a success.
        await this.databaseService.logActivity(
          userId,
          actionType, // Could also be actionType + '_SUCCESS'
          { ...requestParameters, responseStatus: 200 },
          'SUCCESS',
          durationMs,
          undefined,
          sourceIp
        );
      }
      return response;
    } catch (error) {
      this.logger.error(`Error in ${actionType} for user ${userId}:`, error);
      if (userId) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.databaseService.logActivity(
          userId,
          actionType, // Could also be actionType + '_FAILURE'
          { ...requestParameters, error: errorMessage },
          'FAILURE',
          durationMs,
          errorMessage,
          sourceIp
        );
      }
      // Re-throw the original or a new NestJS exception
      throw new InternalServerErrorException('Error processing test data');
    }
  }
} 