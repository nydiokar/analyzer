import { extractSingleMintFromMention } from '../core/solana';
import { buildHolderDistributionSummary, buildReplyText } from '../core/summary';
import { renderSocialCardSvg } from '../render/social-card';
import type { IntelClient } from '../intel/client';
import type { TokenMetadataClient } from '../metadata/client';
import type { XMention } from '../types/x';

export type ProcessMentionResult =
  | { status: 'ignored'; reason: string }
  | {
      status: 'ready';
      mint: string;
      replyText: string;
      socialCardSvg: string;
    };

export async function processMention(params: {
  mention: XMention;
  intelClient: IntelClient;
  metadataClient: TokenMetadataClient;
  topN: number;
}): Promise<ProcessMentionResult> {
  const mint: string | null = extractSingleMintFromMention(params.mention.text);
  if (!mint) {
    return { status: 'ignored', reason: 'Mention did not contain exactly one mint candidate.' };
  }

  const [result, metadata] = await Promise.all([
    params.intelClient.pollHolderProfiles(mint, params.topN),
    params.metadataClient.getTokenMetadata(mint),
  ]);

  const summary = buildHolderDistributionSummary(result, metadata, params.topN);
  return {
    status: 'ready',
    mint,
    replyText: buildReplyText(summary),
    socialCardSvg: renderSocialCardSvg(summary),
  };
}
