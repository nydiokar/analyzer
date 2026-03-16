import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xOAuth2AccessToken) {
    throw new Error('X_OAUTH2_ACCESS_TOKEN is required.');
  }

  const tokenPath = path.join(env.outputDir, 'oauth2-user-token.json');
  let tokenPayload: unknown = null;
  try {
    tokenPayload = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
  } catch {
    tokenPayload = null;
  }

  const client = new XClient(env.xApiBaseUrl, {
    kind: 'bearer',
    token: env.xOAuth2AccessToken,
  });

  const me = await client.getAuthenticatedUser();
  console.log(JSON.stringify({ me, tokenPayload }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
