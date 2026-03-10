import type { WalletProfileResponse } from '@sova/intel-sdk';

export function formatProfile(address: string, profile: WalletProfileResponse): string {
  const short = `${address.slice(0, 4)}..${address.slice(-4)}`;
  const hud = profile.hud;
  const behavior = profile.behavior;
  const summary = profile.summary;

  const lines: string[] = [
    `<b>PROFILE: <code>${short}</code></b>`,
    '',
  ];

  if (hud) {
    lines.push(`<b>PnL (trimmed):</b> ${formatSol(hud.trimmedMeanPnl)} / token`);
    lines.push(`<b>Realized PnL:</b> ${formatSol(summary.realizedPnl)}`);
    lines.push(`<b>Win Rate:</b> ${Math.round(hud.winRate * 100)}%  (${summary.profitableTradesCount}/${summary.totalTradesCount} trades)`);
    lines.push(`<b>Avg Tx:</b> ${formatSol(hud.avgTxValueSol)}`);
    lines.push('');

    const style = formatStyle(hud.behaviorCategory, hud.behaviorCode);
    const holdTime = behavior?.medianHoldTimeHours ?? hud.medianHoldTimeHours;
    lines.push(`<b>Style:</b> ${style}`);
    lines.push(`<b>Hold Time:</b> ${formatHoldTime(holdTime ?? undefined)}`);
    lines.push(`<b>Activity:</b> ${hud.avgTradesPerDay.toFixed(1)} trades/day · ${hud.uniqueTokensPerDay.toFixed(1)} tokens/day`);
    lines.push('');

    const holdingsStr = hud.currentHoldingsUsd
      ? `${hud.currentHoldingsSol.toFixed(1)} SOL ($${formatUsd(hud.currentHoldingsUsd)})`
      : `${hud.currentHoldingsSol.toFixed(1)} SOL`;
    lines.push(`<b>Holdings:</b> ${holdingsStr}`);

    const flags: string[] = [];
    if (hud.isWhale) flags.push('🐋 Whale');
    if (hud.isBot)   flags.push('🤖 Bot');
    if (flags.length > 0) lines.push(`<b>Flags:</b> ${flags.join('  ')}`);
    lines.push(`<b>Quality:</b> ${hud.dataQualityTier}`);

    const dataRange = hud.provenance?.dataRange;
    const dateStr = dataRange?.from && dataRange?.to
      ? `${formatDateShort(dataRange.from)} — ${formatDateShort(dataRange.to)}`
      : hud.calculatedAt ? formatDateShort(hud.calculatedAt) : null;
    if (dateStr) lines.push(`<b>Data:</b> ${dateStr}`);
  } else {
    lines.push(`<b>Realized PnL:</b> ${formatSol(summary.realizedPnl)}`);
    lines.push(`<b>Trades:</b> ${summary.profitableTradesCount} profitable / ${summary.totalTradesCount} total`);
    if (summary.currentSolBalance !== null) {
      lines.push(`<b>SOL Balance:</b> ${summary.currentSolBalance.toFixed(2)} SOL`);
    }
    lines.push('');
    lines.push('<i>Full behavioral metrics not yet available — run /hud to trigger analysis.</i>');
  }

  if (behavior?.exitPattern) {
    lines.push(`<b>Exit Pattern:</b> ${behavior.exitPattern}`);
  }
  if (behavior?.buySellRatio !== null && behavior?.buySellRatio !== undefined) {
    lines.push(`<b>Buy/Sell Ratio:</b> ${behavior.buySellRatio.toFixed(2)}`);
  }

  lines.push('');
  lines.push(`<i>Last analyzed: ${formatDateShort(summary.lastAnalyzedAt)}</i>`);

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
