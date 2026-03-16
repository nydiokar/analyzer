import type { HolderDistributionSummary } from '../core/summary';
import { formatUtcTimestamp } from '../core/summary';
import { SOVA_BADGE_SVG } from '../assets/sova-badge';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderSocialCardSvg(summary: HolderDistributionSummary): string {
  const width: number = 1200;
  const height: number = 675;
  const chartLeft: number = 84;
  const chartTop: number = 174;
  const chartWidth: number = 1032;
  const chartHeight: number = 270;
  const maxSupply: number = Math.max(1, ...summary.buckets.map((bucket) => bucket.supplyPercent));
  const stepCount: number = 4;
  const barGap: number = 16;
  const barWidth: number = Math.floor((chartWidth - (summary.buckets.length - 1) * barGap) / summary.buckets.length);

  const gridLines: string[] = [];
  for (let index = 0; index <= stepCount; index += 1) {
    const y: number = chartTop + (chartHeight / stepCount) * index;
    const value: number = maxSupply - (maxSupply / stepCount) * index;
    gridLines.push(`
      <line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="rgba(163,178,212,0.18)" stroke-width="1" />
      <text x="${chartLeft - 16}" y="${y + 4}" text-anchor="end" fill="#8ea4c4" font-size="20" font-family="Segoe UI, Arial, sans-serif">${value.toFixed(1)}%</text>
    `);
  }

  const bars: string[] = summary.buckets.map((bucket, index) => {
    const x: number = chartLeft + index * (barWidth + barGap);
    const heightPercent: number = bucket.supplyPercent / maxSupply;
    const barHeight: number = Math.max(0, Math.round(chartHeight * heightPercent));
    const y: number = chartTop + chartHeight - barHeight;
    const labelY: number = chartTop + chartHeight + 42;
    const timeframeY: number = labelY + 26;
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="16" fill="${bucket.color}" />
      <text x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle" fill="#f4f7ff" font-size="22" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(bucket.label)}</text>
      <text x="${x + barWidth / 2}" y="${timeframeY}" text-anchor="middle" fill="#8ea4c4" font-size="16" font-family="Segoe UI, Arial, sans-serif">${escapeXml(bucket.timeframe)}</text>
    `;
  });

  const iconMarkup: string = summary.tokenImageUrl
    ? `<circle cx="106" cy="86" r="34" fill="#0f1729" stroke="#2a3552" stroke-width="2" />
       <image href="${escapeXml(summary.tokenImageUrl)}" x="72" y="52" width="68" height="68" clip-path="circle(34px at center)" />`
    : `<circle cx="106" cy="86" r="34" fill="#1f2b46" />
       <text x="106" y="95" text-anchor="middle" fill="#f4f7ff" font-size="26" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(summary.tokenSymbol.slice(0, 3).toUpperCase())}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="36" fill="#07111f" />
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="28" fill="#0b1729" stroke="#16243d" stroke-width="2" />
  ${iconMarkup}
  <text x="164" y="78" fill="#f4f7ff" font-size="40" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(summary.tokenSymbol)}</text>
  <text x="164" y="112" fill="#8ea4c4" font-size="22" font-family="Segoe UI, Arial, sans-serif">${escapeXml(summary.mint)}</text>
  <text x="${width - 86}" y="72" text-anchor="end" fill="#8fd17c" font-size="22" font-weight="700" font-family="Segoe UI, Arial, sans-serif">Fresh supply ${Math.round(summary.freshSupplyPercent)}%</text>
  <text x="84" y="146" fill="#8ea4c4" font-size="22" font-weight="700" font-family="Segoe UI, Arial, sans-serif">TRADER DISTRIBUTION</text>
  ${gridLines.join('')}
  ${bars.join('')}
  <text x="84" y="${height - 72}" fill="#8ea4c4" font-size="18" font-family="Segoe UI, Arial, sans-serif">Holding patterns of top ${summary.topN} holders</text>
  <text x="${width - 84}" y="${height - 86}" text-anchor="end" fill="#8ea4c4" font-size="16" font-family="Segoe UI, Arial, sans-serif">Generated ${formatUtcTimestamp(summary.generatedAtIso)}</text>
  <g transform="translate(${width - 238}, ${height - 86}) scale(0.04)">
    ${SOVA_BADGE_SVG.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">', '').replace('</svg>', '')}
  </g>
  <text x="${width - 84}" y="${height - 54}" text-anchor="end" fill="#8ea4c4" font-size="20" font-family="Segoe UI, Arial, sans-serif">Sova Intel</text>
</svg>`;
}
