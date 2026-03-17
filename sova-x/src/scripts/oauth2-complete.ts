import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { exchangeCodeForToken, type PkceSession } from '../x/oauth2';

export async function completeOAuth2FromCallbackUrl(callbackUrl: string): Promise<void> {
  const env = loadEnv();
  if (!env.xClientId) {
    throw new Error('X_CLIENT_ID is required.');
  }

  const sessionPath = path.join(env.outputDir, 'oauth2-pkce-session.json');
  const session = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as PkceSession;
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    throw new Error('Callback URL did not contain a code parameter.');
  }
  if (!state || state !== session.state) {
    throw new Error('State mismatch in OAuth2 callback.');
  }

  const token = await exchangeCodeForToken({
    code,
    redirectUri: env.xOAuth2RedirectUri,
    codeVerifier: session.codeVerifier,
    clientId: env.xClientId,
    clientSecret: env.xClientSecret,
  });

  const tokenPath = path.join(env.outputDir, 'oauth2-user-token.json');
  await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), 'utf8');

  console.log(`Saved OAuth2 token to ${tokenPath}`);
  console.log('');
  console.log('Put these in sova-x/.env:');
  console.log(`X_OAUTH2_ACCESS_TOKEN=${token.access_token}`);
  if (token.refresh_token) {
    console.log(`X_OAUTH2_REFRESH_TOKEN=${token.refresh_token}`);
  }
}
