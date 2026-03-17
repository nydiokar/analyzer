import { loadEnv } from '../config/env';
import { XClient } from '../x/x-client';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.xBearerToken || !env.xBotUserId) {
    throw new Error('X_BEARER_TOKEN and X_BOT_USER_ID are required for mention tests.');
  }

  const sinceId: string | undefined = process.argv[2]?.trim() || undefined;
  const client = new XClient(env.xApiBaseUrl, { kind: 'bearer', token: env.xBearerToken });
  const mentions = await client.getMentions(env.xBotUserId, sinceId);
  const filteredMentions = env.xAllowedCallerIds.length > 0
    ? mentions.filter((mention) => env.xAllowedCallerIds.includes(mention.authorId))
    : mentions;
  const newestMentionId = mentions.reduce<string | null>((currentMax, mention) => {
    if (!currentMax) {
      return mention.id;
    }
    return BigInt(mention.id) > BigInt(currentMax) ? mention.id : currentMax;
  }, null);

  console.log(JSON.stringify({
    fetchedCount: mentions.length,
    filteredCount: filteredMentions.length,
    sinceId: sinceId ?? null,
    newestMentionId,
    allowedCallerIds: env.xAllowedCallerIds,
    ignoredMentionCount: mentions.length - filteredMentions.length,
    mentions: filteredMentions,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
