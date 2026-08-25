import { createReadStream } from 'fs';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import type { ColdStorageAdapter } from './cold-storage.types';

/**
 * Local-filesystem cold storage. Keys map to paths under a root directory.
 *
 * Intended for development and for the period before the 2 TB / MinIO box exists.
 * When MinIO is up, swap to the S3 adapter via COLD_STORAGE_DRIVER=s3 — the
 * archival code does not change.
 */
export class LocalFsColdStorage implements ColdStorageAdapter {
  readonly driver = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    // Prevent path traversal outside the root.
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`Cold-storage key escapes root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer | Readable): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await writeFile(full, body);
    } else {
      await pipeline(body, createWriteStream(full));
    }
  }

  async get(key: string): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full); // throws ENOENT if missing
    return createReadStream(full);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolve(prefix);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // prefix does not exist yet
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else out.push(path.relative(this.root, abs));
      }
    };
    await walk(base);
    return out.sort();
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  uri(key: string): string {
    return this.resolve(key);
  }
}
