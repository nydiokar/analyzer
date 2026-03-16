import { loadEnv } from '../config/env';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xBearerToken || !env.xBotUserId) {
    throw new Error('X_BEARER_TOKEN and X_BOT_USER_ID are required for mention tests.');
  }

  const client = new XClient(env.xApiBaseUrl, env.xBearerToken);
  const mentions = await client.getMentions(env.xBotUserId);
  console.log(JSON.stringify(mentions, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
