import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

function makeJobId(walletAddress: string): string {
  return `mcx-${crypto.createHash('md5').update(`mcx-${walletAddress}`).digest('hex').slice(0, 8)}`;
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/clear-stuck-mcx-job.ts <wallet-address|job-id>');
    process.exit(1);
  }

  const jobId = target.startsWith('mcx-') ? target : makeJobId(target);
  const queue = new Queue('enrichment-operations', { connection: redisConnection });
  const job = await queue.getJob(jobId);
  if (job) {
    const state = await job.getState();
    console.log(`Job ${jobId} state: ${state}`);
    await job.remove();
    console.log(`Removed ${jobId}.`);
  } else {
    console.log(`Job ${jobId} not found — already gone.`);
  }
  await queue.close();
}

main().catch(console.error);
