import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { XMediaClient } from '../x/media-client';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xOAuth2AccessToken) {
    throw new Error('X_OAUTH2_ACCESS_TOKEN is required for media upload and post creation.');
  }

  const imagePathArg: string | undefined = process.argv[2];
  const replyToTweetId: string | undefined = process.argv[3];
  const textArg: string = process.argv.slice(replyToTweetId ? 4 : 3).join(' ').trim();
  const imagePath = imagePathArg
    ? path.resolve(process.cwd(), imagePathArg)
    : path.resolve(env.outputDir, 'holder-distribution-card-v2.png');

  const text = textArg || 'sova-x media post test';
  const png = await fs.readFile(imagePath);

  const mediaClient = new XMediaClient(env.xApiBaseUrl, {
    kind: 'bearer',
    token: env.xOAuth2AccessToken,
  });
  const xClient = new XClient(env.xApiBaseUrl, {
    kind: 'bearer',
    token: env.xOAuth2AccessToken,
  });

  console.log(`Uploading ${imagePath}...`);
  const uploaded = await mediaClient.uploadPng(png);
  console.log(`Uploaded media id ${uploaded.mediaId}`);

  const post = await xClient.createPost({
    text,
    replyToTweetId,
    mediaIds: [uploaded.mediaId],
  });

  console.log(JSON.stringify(post, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
