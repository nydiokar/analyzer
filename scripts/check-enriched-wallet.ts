import { prisma } from '../src/core/services/database-service';

async function main() {
  const wallet = process.argv[2];
  if (!wallet) { console.error('Usage: npx ts-node ... scripts/check-enriched-wallet.ts <WALLET>'); process.exit(1); }

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const rows = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: wallet, enrichedAt: { not: null }, NOT: { mint: SOL_MINT } },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  if (!rows.length) { console.log('No enriched swaps found for this wallet.'); await prisma.$disconnect(); return; }

  console.log(`\n${'DIR'.padEnd(5)} ${'MINT'.padEnd(46)} ${'USD Val'.padStart(10)} ${'Token $'.padStart(14)} ${'MCAP'.padStart(12)} ${'BUCKET'.padEnd(12)} DATE`);
  console.log('-'.repeat(110));

  for (const r of rows) {
    const dir = r.direction.toUpperCase().padEnd(5);
    const mint = r.mint.padEnd(46);
    const usd = (r.usdValue?.toFixed(2) ?? '-').padStart(10);
    const tokPrice = r.tokenPriceUsd != null ? r.tokenPriceUsd.toExponential(3).padStart(14) : '             -';
    const mcap = r.marketCapUsd != null ? formatMcap(r.marketCapUsd).padStart(12) : '           N/A';
    const bucket = (r.mcapBucket ?? 'N/A').padEnd(12);
    const date = new Date(r.timestamp * 1000).toISOString().split('T')[0];
    console.log(`${dir} ${mint} ${usd} ${tokPrice} ${mcap} ${bucket} ${date}`);
  }

  const enriched = await prisma.swapAnalysisInput.count({ where: { walletAddress: wallet, enrichedAt: { not: null } } });
  const total = await prisma.swapAnalysisInput.count({ where: { walletAddress: wallet } });
  console.log(`\nEnriched: ${enriched}/${total} swaps`);
  const nullMcap = rows.filter(r => r.marketCapUsd == null).length;
  console.log(`Null mcap in sample: ${nullMcap}/${rows.length}`);
  await prisma.$disconnect();
}

function formatMcap(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

main().catch(console.error);
