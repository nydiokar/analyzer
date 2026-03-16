import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env';
import { buildHolderDistributionSummary, buildReplyText } from '../core/summary';
import { SdkIntelClient } from '../intel/client';
import { DexscreenerTokenMetadataClient } from '../metadata/client';
import { renderSvgToPngBuffer } from '../render/png';
import { renderSocialCardSvg } from '../render/social-card';

async function main(): Promise<void> {
  const env = loadEnv();
  const mint: string = process.argv[2]?.trim();

  if (!mint) {
    throw new Error('Usage: node dist/scripts/test-live-render.js <mint>');
  }

  if (!env.sovaIntelApiKey) {
    throw new Error('SOVA_INTEL_API_KEY is required in sova-x/.env');
  }

  const intelClient = new SdkIntelClient({
    baseUrl: env.sovaIntelBaseUrl,
    apiKey: env.sovaIntelApiKey,
    pollIntervalMs: env.pollIntervalMs,
  });
  const metadataClient = new DexscreenerTokenMetadataClient();

  console.log(`Fetching holder profiles for ${mint} (topN=${env.defaultTopN})...`);
  const [result, metadata] = await Promise.all([
    intelClient.pollHolderProfiles(mint, env.defaultTopN),
    metadataClient.getTokenMetadata(mint),
  ]);

  const summary = buildHolderDistributionSummary(result, metadata, env.defaultTopN);
  const replyText = buildReplyText(summary);
  const svg = renderSocialCardSvg(summary);
  const png = await renderSvgToPngBuffer(svg);

  await fs.mkdir(env.outputDir, { recursive: true });
  const slug = `${summary.tokenSymbol || 'token'}-${mint.slice(0, 6)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const svgPath = path.join(env.outputDir, `live-holder-distribution-${slug}.svg`);
  const pngPath = path.join(env.outputDir, `live-holder-distribution-${slug}.png`);
  const jsonPath = path.join(env.outputDir, `live-holder-distribution-${slug}.json`);

  await fs.writeFile(svgPath, svg, 'utf8');
  await fs.writeFile(pngPath, png);
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        summary,
        replyText,
        metadata,
        holderCount: result.profiles.length,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Wrote ${svgPath}`);
  console.log(`Wrote ${pngPath}`);
  console.log(`Wrote ${jsonPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
