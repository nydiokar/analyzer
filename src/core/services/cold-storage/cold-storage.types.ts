import type { Readable } from 'stream';

/**
 * Cold-storage abstraction for archived analytics data (Parquet files).
 *
 * The whole archival pipeline talks to THIS interface, never to a vendor SDK
 * directly. The concrete backend is chosen by env (see ./index.ts), so the same
 * code runs against:
 *   - the local filesystem (development / pre-2TB-box)
 *   - a self-hosted MinIO / Garage on the 2 TB disk (intended steady state, zero egress)
 *   - Backblaze B2 / Cloudflare R2 (off-site escape hatch)
 *
 * Switching backends is an env change, not a code change.
 */
export interface ColdStorageAdapter {
  /** Identifier of the active backend, e.g. 'local' | 's3'. */
  readonly driver: string;

  /** Upload an object (overwrites if present). */
  put(key: string, body: Buffer | Readable): Promise<void>;

  /** Open an object for reading. Throws if the key does not exist. */
  get(key: string): Promise<Readable>;

  /** True if the key exists. */
  exists(key: string): Promise<boolean>;

  /** List object keys under a prefix (recursive). */
  list(prefix: string): Promise<string[]>;

  /** Delete an object. No-op if absent. */
  delete(key: string): Promise<void>;

  /**
   * A URI a query engine (DuckDB httpfs, Polars) can read directly.
   * Local backend → absolute filesystem path; S3 backend → `s3://bucket/key`.
   * This is what makes "query the archive in place" trivial.
   */
  uri(key: string): string;
}
