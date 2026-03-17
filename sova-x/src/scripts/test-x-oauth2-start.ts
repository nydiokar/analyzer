import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { buildAuthorizeUrl, createPkceSession } from '../x/oauth2';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xClientId) {
    throw new Error('X_CLIENT_ID is required.');
  }

  const session = createPkceSession();
  const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];
  const authorizeUrl = buildAuthorizeUrl({
    clientId: env.xClientId,
    redirectUri: env.xOAuth2RedirectUri,
    state: session.state,
    codeChallenge: session.codeChallenge,
    scopes,
  });

  await fs.mkdir(env.outputDir, { recursive: true });
  const sessionPath = path.join(env.outputDir, 'oauth2-pkce-session.json');
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');

  console.log(`Saved PKCE session to ${sessionPath}`);
  console.log('Start the local callback listener first:');
  console.log('node dist\\scripts\\test-x-oauth2-listen.js');
  console.log('');
  console.log('Open this URL in a browser and approve the app:');
  console.log(authorizeUrl);
  console.log('');
  console.log('Fallback if you do not run the listener: after redirect, copy the full callback URL and run:');
  console.log('node dist\\scripts\\test-x-oauth2-complete.js "<PASTED_CALLBACK_URL>"');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
