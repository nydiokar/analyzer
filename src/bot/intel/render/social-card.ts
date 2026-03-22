import type { HolderProfilesResult } from '@sova-intel/sdk';

// ── Token metadata ───────────────────────────────────────────────────────────

type TokenMetadata = {
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
};

type DexscreenerResponse = {
  pairs?: Array<{
    fdv?: number | null;
    marketCap?: number | null;
    info?: { imageUrl?: string | null };
    baseToken?: { address?: string; symbol?: string | null; name?: string | null };
  }>;
};

export async function fetchTokenMetadata(mint: string): Promise<TokenMetadata> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`);
    if (!res.ok) return { symbol: null, name: null, imageUrl: null };
    const payload = (await res.json()) as DexscreenerResponse;
    const pairs = payload.pairs ?? [];
    const exact = pairs.filter((p) => p.baseToken?.address === mint);
    const pool = exact.length > 0 ? exact : pairs;
    const best = [...pool].sort((a, b) => Math.max(b.marketCap ?? 0, b.fdv ?? 0) - Math.max(a.marketCap ?? 0, a.fdv ?? 0))[0];
    if (!best) return { symbol: null, name: null, imageUrl: null };
    return {
      symbol: best.baseToken?.symbol ?? null,
      name: best.baseToken?.name ?? null,
      imageUrl: best.info?.imageUrl ?? null,
    };
  } catch {
    return { symbol: null, name: null, imageUrl: null };
  }
}

export async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type DistributionBucket = {
  id: string;
  label: string;
  timeframe: string;
  walletCount: number;
  supplyPercent: number;
  color: string;
};

type HolderDistributionSummary = {
  mint: string;
  tokenSymbol: string;
  tokenImageDataUri: string | null;
  freshSupplyPercent: number;
  buckets: DistributionBucket[];
  topN: number;
  generatedAtIso: string;
};

// ── Distribution logic (mirrors sova-x/src/core/distribution.ts) ─────────────

const BUCKET_ORDER: ReadonlyArray<string> = [
  'SNIPER', 'SCALPER', 'MOMENTUM', 'INTRADAY', 'DAY_TRADER', 'SWING', 'POSITION', 'HODLER',
];

const SYSTEM_WALLET_TYPES: ReadonlySet<string> = new Set([
  'BURN', 'LP', 'PROTOCOL', 'EXCHANGE', 'SYSTEM',
]);

const BUCKET_META: Record<string, { label: string; timeframe: string; color: string }> = {
  SNIPER:     { label: 'Sniper',      timeframe: '< 10 seconds',    color: '#d7868a' },
  SCALPER:    { label: 'Scalper',     timeframe: '< 1 minute',      color: '#e3a06d' },
  MOMENTUM:   { label: 'Momentum',    timeframe: '5-30 minutes',    color: '#d9c174' },
  INTRADAY:   { label: 'Intraday',    timeframe: '30 min - 4 hours', color: '#8dd0c8' },
  DAY_TRADER: { label: 'Day Trader',  timeframe: '4-24 hours',      color: '#7dc4ec' },
  SWING:      { label: 'Swing',       timeframe: '1-7 days',        color: '#8f98f7' },
  POSITION:   { label: 'Position',    timeframe: '7+ days',         color: '#a58cf0' },
  HODLER:     { label: 'Fresh',       timeframe: '',                color: '#8fd17c' },
};

type ProfileLike = {
  behaviorType?: string | null;
  analysisSkipped?: boolean;
  knownType?: string | null;
  supplyPercent?: number | null;
  currentHoldingsCount?: number | null;
  completedCycleCount?: number | null;
  realizedMedianHoldTimeHours?: number | null;
  medianHoldTimeHours?: number | null;
};

function normalizeBehavior(profile: ProfileLike): string | null {
  let behavior: string | null = profile.behaviorType ?? null;
  if (behavior === 'HOLDER') behavior = 'HODLER';
  if (!behavior && !profile.analysisSkipped) {
    if ((profile.currentHoldingsCount ?? 0) > 0 && (profile.completedCycleCount ?? 0) === 0) {
      behavior = 'HODLER';
    }
  }
  return behavior;
}

function buildDistributionBuckets(profiles: ProfileLike[]): DistributionBucket[] {
  const counts: Record<string, number> = {};
  const supply: Record<string, number> = {};
  for (const profile of profiles) {
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType)) continue;
    const behavior = normalizeBehavior(profile);
    if (!behavior) continue;
    counts[behavior] = (counts[behavior] ?? 0) + 1;
    supply[behavior] = (supply[behavior] ?? 0) + (profile.supplyPercent ?? 0);
  }
  return BUCKET_ORDER.map((id) => ({
    id,
    label: BUCKET_META[id]?.label ?? id,
    timeframe: BUCKET_META[id]?.timeframe ?? '',
    walletCount: counts[id] ?? 0,
    supplyPercent: supply[id] ?? 0,
    color: BUCKET_META[id]?.color ?? '#9ca3af',
  }));
}

function calculateFreshSupplyPercent(profiles: ProfileLike[]): number {
  let total = 0;
  for (const profile of profiles) {
    if (profile.analysisSkipped) continue;
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType)) continue;
    const behavior = normalizeBehavior(profile);
    if (behavior === 'HODLER') { total += profile.supplyPercent ?? 0; continue; }
    const realizedHours = profile.realizedMedianHoldTimeHours ?? null;
    const medianHours = profile.medianHoldTimeHours ?? null;
    const hasExitHistorySignal =
      (realizedHours != null && Number.isFinite(realizedHours)) ||
      (medianHours != null && Number.isFinite(medianHours) && (profile.completedCycleCount ?? 0) > 0);
    if (!hasExitHistorySignal && !behavior) total += profile.supplyPercent ?? 0;
  }
  return total;
}

// ── Summary builder ──────────────────────────────────────────────────────────

export function buildSignalCardSummary(
  result: HolderProfilesResult,
  metadata?: TokenMetadata | null,
  tokenImageDataUri?: string | null,
): HolderDistributionSummary {
  const mint = result.tokenMint ?? 'Unknown';
  const shortened = mint.length > 12 ? `${mint.slice(0, 4)}...${mint.slice(-4)}` : mint;
  const symbol = metadata?.symbol ?? shortened;
  return {
    mint: shortened,
    tokenSymbol: symbol,
    tokenImageDataUri: tokenImageDataUri ?? null,
    freshSupplyPercent: calculateFreshSupplyPercent(result.profiles),
    buckets: buildDistributionBuckets(result.profiles),
    topN: result.profiles.length,
    generatedAtIso: new Date().toISOString(),
  };
}

// ── SVG renderer ─────────────────────────────────────────────────────────────

const SOVA_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">
  <circle cx="512" cy="512" r="448" fill="#0A1A2F"/>
  <g fill="#FFFFFF" stroke="none" fill-rule="evenodd" transform="translate(0,-50) scale(1.12) translate(-46,0)">
    <path d="M256 300
             c0 0 120 -16 200 34
             c34 21 64 56 80 98
             h-16
             c16 -42 46 -77 80 -98
             c80 -50 200 -34 200 -34
             v152
             c0 68 -24 118 -72 176
             c-44 54 -108 98 -216 156
             c-108 -58 -172 -102 -216 -156
             c-48 -58 -72 -108 -72 -176
             Z
             M368 400 a60 60 0 1 0 0.1 0 Z
             M656 400 a60 60 0 1 0 0.1 0 Z
             M496 540 L528 540 L512 600 Z"/>
  </g>
</svg>`;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatAxisValue(value: number): string {
  if (value === 0) return '0%';
  if (Number.isInteger(value)) return `${value}%`;
  return `${value.toFixed(1)}%`;
}

function formatUtcTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function renderSignalCardSvg(summary: HolderDistributionSummary): string {
  const width = 1200;
  const height = 675;
  const padding = 56;
  const innerLeft = padding;
  const innerRight = width - padding;

  const iconCx = innerLeft + 34;
  const iconCy = 76;
  const iconR = 30;

  const subtitleY = 138;
  const dividerY = 156;

  const chartLeft = 110;
  const chartTop = 182;
  const chartWidth = innerRight - chartLeft - 8;
  const chartHeight = 300;
  const maxSupply = Math.max(1, ...summary.buckets.map((b) => b.supplyPercent));
  const stepCount = 4;
  const barGap = 14;
  const barWidth = Math.floor((chartWidth - (summary.buckets.length - 1) * barGap) / summary.buckets.length);

  const footerY = height - 36;

  const gridLines: string[] = [];
  for (let i = 0; i <= stepCount; i++) {
    const y = chartTop + (chartHeight / stepCount) * i;
    const value = maxSupply - (maxSupply / stepCount) * i;
    gridLines.push(
      `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="rgba(163,178,212,0.12)" stroke-width="1" />` +
      `<text x="${chartLeft - 14}" y="${y + 5}" text-anchor="end" fill="#5c7396" font-size="18" font-family="Segoe UI, Arial, sans-serif">${formatAxisValue(value)}</text>`,
    );
  }

  const bars = summary.buckets.map((bucket, index) => {
    const x = chartLeft + index * (barWidth + barGap);
    const barHeight = Math.max(0, Math.round(chartHeight * (bucket.supplyPercent / maxSupply)));
    const y = chartTop + chartHeight - barHeight;
    const labelY = chartTop + chartHeight + 36;
    const timeframeY = labelY + 22;
    return (
      `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="14" fill="${bucket.color}" />` +
      `<text x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle" fill="#f4f7ff" font-size="19" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(bucket.label)}</text>` +
      `<text x="${x + barWidth / 2}" y="${timeframeY}" text-anchor="middle" fill="#5c7396" font-size="14" font-family="Segoe UI, Arial, sans-serif">${escapeXml(bucket.timeframe)}</text>`
    );
  });

  const clipId = 'token-icon-clip';
  const iconMarkup = summary.tokenImageDataUri
    ? `<defs><clipPath id="${clipId}"><circle cx="${iconCx}" cy="${iconCy}" r="${iconR}" /></clipPath></defs>` +
      `<circle cx="${iconCx}" cy="${iconCy}" r="${iconR}" fill="#0f1729" stroke="#2a3552" stroke-width="2" />` +
      `<image href="${escapeXml(summary.tokenImageDataUri)}" x="${iconCx - iconR}" y="${iconCy - iconR}" width="${iconR * 2}" height="${iconR * 2}" clip-path="url(#${clipId})" />`
    : `<circle cx="${iconCx}" cy="${iconCy}" r="${iconR}" fill="#1f2b46" />` +
      `<text x="${iconCx}" y="${iconCy + 8}" text-anchor="middle" fill="#f4f7ff" font-size="18" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(summary.tokenSymbol.slice(0, 3).toUpperCase())}</text>`;

  const badgeSize = 34;
  const brandTextX = innerRight;
  const brandTextY = iconCy + 8;
  const badgeX = brandTextX - 164;
  const badgeY = iconCy - badgeSize / 2;
  const badgeInner = SOVA_BADGE_SVG
    .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">', '')
    .replace('</svg>', '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#07111f" />
  <rect width="${width}" height="${height}" rx="36" fill="#07111f" />
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="28" fill="#0b1729" stroke="#16243d" stroke-width="2" />

  ${iconMarkup}
  <text x="${iconCx + iconR + 16}" y="${iconCy - 4}" fill="#f4f7ff" font-size="36" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(summary.tokenSymbol)}</text>
  <text x="${iconCx + iconR + 16}" y="${iconCy + 24}" fill="#5c7396" font-size="17" font-family="Segoe UI, Arial, sans-serif">${escapeXml(summary.mint)}</text>

  <g transform="translate(${badgeX}, ${badgeY}) scale(${badgeSize / 1024})">
    ${badgeInner}
  </g>
  <text x="${brandTextX}" y="${brandTextY}" text-anchor="end" fill="#8ea4c4" font-size="22" font-weight="600" font-family="Segoe UI, Arial, sans-serif">Sova Intel</text>

  <text x="${innerLeft}" y="${subtitleY}" fill="#8ea4c4" font-size="20" font-family="Segoe UI, Arial, sans-serif">Holding patterns of top ${summary.topN} holders</text>
  <text x="${innerRight}" y="${subtitleY}" text-anchor="end" fill="#8fd17c" font-size="20" font-weight="700" font-family="Segoe UI, Arial, sans-serif">Fresh supply ${Math.round(summary.freshSupplyPercent)}%</text>
  <line x1="${innerLeft}" y1="${dividerY}" x2="${innerRight}" y2="${dividerY}" stroke="rgba(163,178,212,0.15)" stroke-width="1" />

  ${gridLines.join('\n  ')}
  ${bars.join('\n  ')}

  <text x="${innerRight}" y="${footerY}" text-anchor="end" fill="#3d5470" font-size="14" font-family="Segoe UI, Arial, sans-serif">Generated ${formatUtcTimestamp(summary.generatedAtIso)}</text>
</svg>`;
}
