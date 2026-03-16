import fs from 'node:fs/promises';
import path from 'node:path';
import fixture from '../fixtures/holder-profiles.fixture.json';
import { loadEnv } from '../config/env';
import { buildHolderDistributionSummary, buildReplyText } from '../core/summary';
import { renderSocialCardSvg } from '../render/social-card';
import { renderSvgToPngBuffer } from '../render/png';
import type { HolderProfilesResult, TokenMetadata } from '../types/holder-profiles';

async function main(): Promise<void> {
  const env = loadEnv();
  const result: HolderProfilesResult = fixture;
  const metadata: TokenMetadata = {
    mint: result.tokenMint ?? 'unknown',
    symbol: 'SOVA',
    name: 'Sova Test Token',
    imageUrl: null,
  };

  const summary = buildHolderDistributionSummary(result, metadata, env.defaultTopN);
  const svg = renderSocialCardSvg(summary);
  const png = await renderSvgToPngBuffer(svg);
  const replyText = buildReplyText(summary);

  await fs.mkdir(env.outputDir, { recursive: true });
  await fs.writeFile(path.join(env.outputDir, 'holder-distribution-card.svg'), svg, 'utf8');
  await fs.writeFile(path.join(env.outputDir, 'holder-distribution-card-v2.svg'), svg, 'utf8');
  await fs.writeFile(path.join(env.outputDir, 'holder-distribution-card.png'), png);
  await fs.writeFile(path.join(env.outputDir, 'holder-distribution-card-v2.png'), png);
  await fs.writeFile(
    path.join(env.outputDir, 'holder-distribution-summary.json'),
    JSON.stringify({ summary, replyText }, null, 2),
    'utf8',
  );

  console.log(`Wrote ${path.join(env.outputDir, 'holder-distribution-card.svg')}`);
  console.log(`Wrote ${path.join(env.outputDir, 'holder-distribution-card-v2.svg')}`);
  console.log(`Wrote ${path.join(env.outputDir, 'holder-distribution-card.png')}`);
  console.log(`Wrote ${path.join(env.outputDir, 'holder-distribution-card-v2.png')}`);
  console.log(`Wrote ${path.join(env.outputDir, 'holder-distribution-summary.json')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
