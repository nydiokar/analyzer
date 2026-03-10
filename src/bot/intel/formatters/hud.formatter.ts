import type { WalletHud } from '@sova/intel-sdk';

export function formatHud(address: string, hud: WalletHud): string {
  const flags: string[] = [];
  if (hud.isWhale) flags.push('🐋');
  if (hud.isBot)   flags.push('🤖');

  const style = formatStyle(hud.behaviorCategory, hud.behaviorCode);
  const dataRange = hud.provenance?.dataRange;
  const dataPeriod = dataRange?.from && dataRange?.to
    ? `${formatDateCompact(dataRange.from)} – ${formatDateCompact(dataRange.to)}`
    : formatDateCompact(hud.calculatedAt);

  const holdingsStr = hud.currentHoldingsUsd
    ? `${hud.currentHoldingsSol.toFixed(1)} SOL ($${formatUsd(hud.currentHoldingsUsd)})`
    : `${hud.currentHoldingsSol.toFixed(1)} SOL`;

  const lines: string[] = [
    `🔍 <code>${address}</code>`,
    '',
    `<b>${style}</b>  ·  ${hud.dataQualityTier}  ·  ${dataPeriod}${flags.length ? '  ' + flags.join('') : ''}`,
    '',
    `PnL      ${formatSol(hud.trimmedMeanPnl)} / token  ·  Win ${Math.round(hud.winRate * 100)}%`,
    `Avg Tx   ${formatSol(hud.avgTxValueSol)}  ·  Hold ${formatHoldTime(hud.medianHoldTimeHours)}`,
    `Volume   ${hud.avgTradesPerDay.toFixed(1)} tx/day  ·  ${hud.uniqueTokensPerDay.toFixed(1)} tokens/day`,
    `Bag      ${holdingsStr}`,
  ];

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSol(sol: number): string {
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M SOL`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(2)}K SOL`;
  return `${sign}${abs.toFixed(2)} SOL`;
}

function formatHoldTime(hours?: number): string {
  if (hours === undefined || hours === null) return '—';
  if (hours < 1)  return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatStyle(category?: string, code?: string): string {
  const label = category
    ? category.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    : 'Unknown';
  return code ? `${label} (${code})` : label;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatDateCompact(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
