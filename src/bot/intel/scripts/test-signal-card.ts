/**
 * Test script for the signal card renderer.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/bot/intel/scripts/test-signal-card.ts <MINT_ADDRESS>
 *
 * Requires env vars: INTEL_API_KEY, INTEL_BASE_URL (optional, defaults to localhost:3001)
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SovaIntelClient, HolderProfilesResult } from '@sova-intel/sdk';
import { formatSignalCard } from '../formatters/signal.formatter';
import { buildSignalCardSummary, renderSignalCardSvg, fetchTokenMetadata, fetchImageAsDataUri } from '../render/social-card';
import { renderSvgToPngBuffer } from '../render/png';

async function main(): Promise<void> {
  const mint = process.argv[2]?.trim();
  if (!mint) {
    console.error('Usage: ts-node ... test-signal-card.ts <MINT_ADDRESS>');
    process.exit(1);
  }

  const apiKey = process.env.INTEL_API_KEY;
  if (!apiKey) throw new Error('Missing INTEL_API_KEY env var');

  const baseUrl = process.env.INTEL_BASE_URL ?? 'http://localhost:3001/api/v1';

  const client = new SovaIntelClient({ baseUrl, auth: { kind: 'apikey', apiKey } });

  console.log(`Fetching holder profiles + token metadata for ${mint}...`);
  const [result, metadata] = await Promise.all([
    client.pollHolderProfiles<HolderProfilesResult>(mint),
    fetchTokenMetadata(mint),
  ]);
  console.log(`Got ${result.profiles.length} profiles. Symbol: ${metadata.symbol ?? '(unknown)'}`);

  const tokenImageDataUri = metadata.imageUrl ? await fetchImageAsDataUri(metadata.imageUrl) : null;
  const summary = buildSignalCardSummary(result, metadata, tokenImageDataUri);
  const svg = renderSignalCardSvg(summary);
  const png = await renderSvgToPngBuffer(svg);
  const caption = formatSignalCard(result);

  const outDir = path.join(process.cwd(), 'out');
  await fs.mkdir(outDir, { recursive: true });

  const slug = mint.slice(0, 8);
  const pngPath = path.join(outDir, `signal-card-${slug}.png`);
  const svgPath = path.join(outDir, `signal-card-${slug}.svg`);

  await fs.writeFile(pngPath, png);
  await fs.writeFile(svgPath, svg, 'utf8');

  console.log(`PNG → ${pngPath}`);
  console.log(`SVG → ${svgPath}`);
  console.log('\n--- Caption (what Telegram will show) ---');
  console.log(caption);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
