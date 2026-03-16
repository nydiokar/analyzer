import { loadEnv } from '../config/env';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xBearerToken) {
    throw new Error('X_BEARER_TOKEN is required for posting tests.');
  }

  const text: string = process.argv.slice(2).join(' ').trim() || 'sova-x scaffold posting test';
  const client = new XClient(env.xApiBaseUrl, env.xBearerToken);
  const result = await client.createPost({ text });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
