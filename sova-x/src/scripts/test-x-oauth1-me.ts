import { loadEnv } from '../config/env';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xConsumerKey || !env.xConsumerSecret || !env.xAccessToken || !env.xAccessTokenSecret) {
    throw new Error('X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, and X_ACCESS_TOKEN_SECRET are required.');
  }

  const client = new XClient(env.xApiBaseUrl, {
    kind: 'oauth1',
    credentials: {
      consumerKey: env.xConsumerKey,
      consumerSecret: env.xConsumerSecret,
      accessToken: env.xAccessToken,
      accessTokenSecret: env.xAccessTokenSecret,
    },
  });

  const me = await client.getAuthenticatedUser();
  console.log(JSON.stringify(me, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
