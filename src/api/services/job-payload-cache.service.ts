import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';


/**
 * Service for caching large job payloads in Redis to avoid bloating BullMQ job data.
 *
 * USE CASES:
 * - Store wallet balances before enqueueing enrichment jobs
 * - Store intermediate data between job steps (similarity → enrichment)
 * - Keep BullMQ job data small (only key references, not full payloads)
 *
 * BENEFITS:
 * - Reduces BullMQ Redis memory usage
 * - Faster job enqueueing/dequeueing
 * - Automatic cleanup via TTL
 *
 * PATTERN:
 * 1. Controller/Processor stores payload → receives key
 * 2. Pass key in job data (small)
 * 3. Processor retrieves payload using key
 * 4. Processor deletes key after use (best-effort cleanup)
 */
@Injectable()
export class JobPayloadCacheService {
  private readonly logger = new Logger(JobPayloadCacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Store a job payload in Redis with automatic expiry.
   *
   * @param requestId Unique identifier for the request/job
   * @param payloadType Type of payload (enrich, similarity, etc.) for key namespacing
   * @param data The payload data to cache
   * @param ttlMinutes Time-to-live in minutes (default: 15)
   * @returns Redis key where the payload is stored
   */
  async storePayload(
    requestId: string,
    payloadType: 'enrich' | 'similarity' | 'generic',
    data: any,
    ttlMinutes = 15,
  ): Promise<string> {
    const key = this.buildKey(payloadType, requestId);

    try {
      await this.redis.set(
        key,
        JSON.stringify(data),
        'EX',
        ttlMinutes * 60,
      );

      this.logger.debug(
        `Stored ${payloadType} payload for request ${requestId} (TTL: ${ttlMinutes}m, size: ${JSON.stringify(data).length} bytes)`,
      );

      return key;
    } catch (error) {
      this.logger.error(`Failed to store payload for ${requestId}:`, getErrorMessage(error));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to cache job payload: ${errorMessage}`);
    }
  }

  /**
   * Retrieve a job payload from Redis.
   *
   * @param key Redis key where the payload is stored
   * @returns The parsed payload data, or null if not found
   */
  async retrievePayload<T = any>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);

      if (!cached) {
        this.logger.warn(`Payload not found for key ${key} (expired or already deleted)`);
        return null;
      }

      const data = JSON.parse(cached);
      this.logger.debug(`Retrieved payload from ${key} (size: ${cached.length} bytes)`);

      return data as T;
    } catch (error) {
      this.logger.error(`Failed to retrieve payload for ${key}:`, getErrorMessage(error));
      return null;
    }
  }

  /**
   * Delete a job payload from Redis after use (best-effort cleanup).
   * Failures are logged but don't throw (TTL will clean up eventually).
   *
   * @param key Redis key to delete
   */
  async deletePayload(key: string): Promise<void> {
    try {
      const deleted = await this.redis.del(key);

      if (deleted > 0) {
        this.logger.debug(`Deleted payload ${key}`);
      } else {
        this.logger.debug(`Payload ${key} already expired or deleted`);
      }
    } catch (error) {
      // Non-critical: TTL will clean up eventually
      this.logger.warn(`Failed to delete payload ${key}:`, getErrorMessage(error));
    }
  }

  /**
   * Build a namespaced Redis key for job payloads.
   * Format: {payloadType}:balances:{requestId}
   */
  private buildKey(payloadType: string, requestId: string): string {
    return `${payloadType}:balances:${requestId}`;
  }

  /**
   * Check if a payload exists in Redis.
   *
   * @param key Redis key to check
   * @returns true if the key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Failed to check existence for ${key}:`, getErrorMessage(error));
      return false;
    }
  }

  /**
   * Get remaining TTL for a payload.
   *
   * @param key Redis key to check
   * @returns TTL in seconds, or -1 if key doesn't exist, -2 if no TTL set
   */
  async getTTL(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`Failed to get TTL for ${key}:`, getErrorMessage(error));
      return -1;
    }
  }
}
