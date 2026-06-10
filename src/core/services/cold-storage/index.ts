import { createLogger } from '../../utils/logger';
import type { ColdStorageAdapter } from './cold-storage.types';
import { LocalFsColdStorage } from './local-fs-adapter';

export type { ColdStorageAdapter } from './cold-storage.types';
export { LocalFsColdStorage } from './local-fs-adapter';

const logger = createLogger('ColdStorage');

let cached: ColdStorageAdapter | undefined;

/**
 * Returns the configured cold-storage backend (singleton).
 *
 * Env:
 *   COLD_STORAGE_DRIVER       'local' (default) | 's3'
 *   COLD_STORAGE_LOCAL_ROOT   local root dir (default ./data/cold-archive)
 *
 *   # when driver=s3 (MinIO / B2 / R2 — all S3-compatible):
 *   COLD_STORAGE_S3_ENDPOINT  e.g. http://localhost:9000 (MinIO) — omit for AWS S3
 *   COLD_STORAGE_S3_BUCKET
 *   COLD_STORAGE_S3_REGION     default 'us-east-1'
 *   COLD_STORAGE_S3_ACCESS_KEY_ID
 *   COLD_STORAGE_S3_SECRET_ACCESS_KEY
 *   COLD_STORAGE_S3_FORCE_PATH_STYLE  'true' for MinIO
 */
export function getColdStorage(): ColdStorageAdapter {
  if (cached) return cached;

  const driver = (process.env.COLD_STORAGE_DRIVER ?? 'local').toLowerCase();

  switch (driver) {
    case 'local': {
      const root = process.env.COLD_STORAGE_LOCAL_ROOT ?? './data/cold-archive';
      logger.info(`Cold storage driver=local root=${root}`);
      cached = new LocalFsColdStorage(root);
      return cached;
    }
    case 's3': {
      // The S3 adapter is intentionally not wired until the MinIO/2TB box exists.
      // Implementing it is a self-contained drop-in: add @aws-sdk/client-s3, create
      // ./s3-adapter.ts implementing ColdStorageAdapter, and return it here. No other
      // archival code changes. See docs/DATA_RETENTION_STRATEGY.md.
      throw new Error(
        "COLD_STORAGE_DRIVER=s3 selected but the S3 adapter is not wired yet. " +
          "Add @aws-sdk/client-s3 and src/core/services/cold-storage/s3-adapter.ts, " +
          "then register it in getColdStorage().",
      );
    }
    default:
      throw new Error(`Unknown COLD_STORAGE_DRIVER: ${driver}`);
  }
}
