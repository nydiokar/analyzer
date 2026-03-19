import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

@Injectable()
export class SparklineService {
  private readonly logger = new Logger(SparklineService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async appendMany(entries: Array<{ addr: string; price: number }>, maxPoints: number = 96): Promise<void> {
    if (!entries || entries.length === 0) return;
    try {
      const now = Date.now();
      const pipeline = this.redisClient.multi();
      for (const it of entries) {
        if (!isFinite(it.price)) continue;
        const key = `spark:${it.addr}`;
        const val = JSON.stringify({ t: now, p: it.price });
        pipeline.rpush(key, val);
        pipeline.ltrim(key, -maxPoints, -1);
      }
      await pipeline.exec();
    } catch (e) {
      this.logger.debug(`appendMany failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async read(addr: string, points: number): Promise<Array<[number, number]>> {
    const key = `spark:${addr}`;
    try {
      const len = await this.redisClient.llen(key);
      if (len <= 0) return [];
      const start = Math.max(len - points, 0);
      const raw = await this.redisClient.lrange(key, start, -1);
      const parsed = raw
        .map((s) => { try { return JSON.parse(s) as { t:number; p:number }; } catch { return null; } })
        .filter(Boolean) as Array<{ t:number; p:number }>;
      return parsed.map((it) => [it.t, it.p] as [number, number]);
    } catch (e) {
      this.logger.debug(`read failed for ${addr}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
}


