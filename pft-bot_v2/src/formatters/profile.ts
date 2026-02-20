import type { WalletHud } from '../analyzer.js';

export function formatWalletProfile(address: string, hud: WalletHud | null): string {
  const short = `${address.slice(0, 4)}..${address.slice(-4)}`;

  if (!hud) {
    // This should rarely reach the formatter — commands.ts handles the no-HUD
    // state by queuing analysis. This is a last-resort fallback.
    return [
      `WALLET: ${short}`,
      'Status: No profile data available',
      '',
      `Run /analyze ${address} to generate a full analysis.`,
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`WALLET: ${short}`);
  lines.push('');

  // ── PnL ──────────────────────────────────────────────────────────────
  // trimmedMeanPnl = outlier-trimmed mean P/L per token (removes top/bottom outliers)
  // medianPnlPerToken = true median (unaffected by single huge wins/losses)
  // Show both so the user can sense the distribution spread
  lines.push(`PnL (median):      ${formatSol(hud.medianPnlPerToken)} per token`);
  lines.push(`PnL (trimmed avg): ${formatSol(hud.trimmedMeanPnl)} per token`);
  lines.push(`Win Rate:          ${Math.round(hud.winRate * 100)}%`);
  lines.push('');

  // ── Behavior ─────────────────────────────────────────────────────────
  lines.push(`Style:    ${formatStyle(hud.behaviorCategory, hud.behaviorCode)}`);
  lines.push(`Holding:  ${formatHoldTime(hud.medianHoldTimeHours)} median exit`);
  lines.push(`Activity: ${hud.avgTradesPerDay.toFixed(1)} trades/day | ${hud.uniqueTokensPerDay.toFixed(1)} tokens/day`);
  lines.push('');

  // ── Portfolio ─────────────────────────────────────────────────────────
  const holdingsStr = hud.currentHoldingsUsd
    ? `${hud.currentHoldingsSol.toFixed(1)} SOL ($${formatUsd(hud.currentHoldingsUsd)})`
    : `${hud.currentHoldingsSol.toFixed(1)} SOL`;
  lines.push(`Holdings: ${holdingsStr}`);

  // ── Badges ─────────────────────────────────────────────────────────────
  const flags: string[] = [];
  if (hud.isWhale) flags.push('\u{1F40B} Whale');
  if (hud.isBot) flags.push('\u{1F916} Bot');
  if (flags.length > 0) lines.push(`Flags:    ${flags.join('  ')}`);

  // ── Data quality + range ───────────────────────────────────────────────
  lines.push(`Quality:  ${hud.dataQualityTier}`);

  const dataRange = hud.provenance?.dataRange;
  if (dataRange?.from && dataRange?.to) {
    const from = formatDateShort(dataRange.from);
    const to = formatDateShort(dataRange.to);
    lines.push(`Data:     ${from} — ${to}`);
  } else {
    const updated = hud.calculatedAt ? formatDateShort(hud.calculatedAt) : null;
    if (updated) lines.push(`Updated:  ${updated}`);
  }

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatSol(sol: number): string {
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M SOL`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(2)}K SOL`;
  return `${sign}${abs.toFixed(2)} SOL`;
}

function formatHoldTime(hours?: number): string {
  if (!hours) return '—';
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
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
