import { Queue } from 'bullmq';
import * as dotenv from 'dotenv';
dotenv.config();

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

async function main() {
  const queue = new Queue('enrichment-operations', { connection: redisConnection });
  const job = await queue.getJob('mcx-7a8f43fc');
  if (job) {
    const state = await job.getState();
    console.log(`Job state: ${state}`);
    await job.remove();
    console.log('Removed.');
  } else {
    console.log('Job not found — already gone.');
  }
  await queue.close();
}

main().catch(console.error);
