import { loadEnv } from '../config/env';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  const text: string = process.argv.slice(2).join(' ').trim() || 'sova-x scaffold posting test';
  const client = env.xOAuth2AccessToken
    ? new XClient(env.xApiBaseUrl, { kind: 'bearer', token: env.xOAuth2AccessToken })
    : (() => {
        if (!env.xConsumerKey || !env.xConsumerSecret || !env.xAccessToken || !env.xAccessTokenSecret) {
          throw new Error('Either X_OAUTH2_ACCESS_TOKEN or the OAuth 1.0a credential set is required for posting tests.');
        }
        return new XClient(env.xApiBaseUrl, {
          kind: 'oauth1',
          credentials: {
            consumerKey: env.xConsumerKey,
            consumerSecret: env.xConsumerSecret,
            accessToken: env.xAccessToken,
            accessTokenSecret: env.xAccessTokenSecret,
          },
        });
      })();
  const result = await client.createPost({ text });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
