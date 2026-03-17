import { completeOAuth2FromCallbackUrl } from './oauth2-complete';

async function main(): Promise<void> {
  const callbackUrl = process.argv[2]?.trim();
  if (!callbackUrl) {
    throw new Error('Usage: node dist/scripts/test-x-oauth2-complete.js "<callback_url>"');
  }

  await completeOAuth2FromCallbackUrl(callbackUrl);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
