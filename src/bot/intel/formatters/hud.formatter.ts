import type { WalletHud } from '@sova/intel-sdk';

export function formatHud(address: string, hud: WalletHud): string {
  const short = `${address.slice(0, 4)}..${address.slice(-4)}`;
  const style = formatStyle(hud.behaviorCategory, hud.behaviorCode);
  const holdingsStr = hud.currentHoldingsUsd
    ? `${hud.currentHoldingsSol.toFixed(1)} SOL ($${formatUsd(hud.currentHoldingsUsd)})`
    : `${hud.currentHoldingsSol.toFixed(1)} SOL`;

  const flags: string[] = [];
  if (hud.isWhale) flags.push('🐋 Whale');
  if (hud.isBot) flags.push('🤖 Bot');

  const dataRange = hud.provenance?.dataRange;
  const dateStr = dataRange?.from && dataRange?.to
    ? `${formatDateShort(dataRange.from)} — ${formatDateShort(dataRange.to)}`
    : hud.calculatedAt ? formatDateShort(hud.calculatedAt) : null;

  const lines: string[] = [
    `<b>HUD: <code>${short}</code></b>`,
    '',
    `<b>PnL (trimmed):</b> ${formatSol(hud.trimmedMeanPnl)} / token`,
    `<b>Avg Tx:</b> ${formatSol(hud.avgTxValueSol)}`,
    `<b>Win Rate:</b> ${Math.round(hud.winRate * 100)}%`,
    '',
    `<b>Style:</b> ${style}`,
    `<b>Hold Time:</b> ${formatHoldTime(hud.medianHoldTimeHours)}`,
    `<b>Activity:</b> ${hud.avgTradesPerDay.toFixed(1)} trades/day · ${hud.uniqueTokensPerDay.toFixed(1)} tokens/day`,
    '',
    `<b>Holdings:</b> ${holdingsStr}`,
  ];

  if (flags.length > 0) lines.push(`<b>Flags:</b> ${flags.join('  ')}`);
  lines.push(`<b>Quality:</b> ${hud.dataQualityTier}`);
  if (dateStr) lines.push(`<b>Data:</b> ${dateStr}`);

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

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
