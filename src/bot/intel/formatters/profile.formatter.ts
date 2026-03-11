import type { WalletProfileResponse } from '@sova/intel-sdk';

export function formatProfile(address: string, profile: WalletProfileResponse): string {
  const hud = profile.hud;
  const behavior = profile.behavior;
  const summary = profile.summary;

  const lines: string[] = [
    `👤 <code>${address}</code>`,
    '',
  ];

  // ── PERFORMANCE ───────────────────────────────────────────────────────────
  lines.push('━━━ PERFORMANCE ━━━');
  lines.push(`Realized PnL   ${formatSol(summary.realizedPnl)}`);

  if (hud) {
    lines.push(`PnL / token    ${formatSol(hud.trimmedMeanPnl)}  <i>(trimmed mean)</i>`);
    lines.push(`Win Rate       ${Math.round(hud.winRate * 100)}%  ·  ${summary.profitableTradesCount} profitable / ${summary.totalTradesCount} trades`);
    lines.push(`Avg Tx Size    ${formatSol(hud.avgTxValueSol)}`);
  } else {
    lines.push(`Win Rate       ${summary.profitableTradesCount} profitable / ${summary.totalTradesCount} trades`);
  }

  // ── BEHAVIOR ──────────────────────────────────────────────────────────────
  if (hud || behavior) {
    lines.push('');
    lines.push('━━━ BEHAVIOR ━━━');

    if (hud) {
      const style = formatStyle(hud.behaviorCategory, hud.behaviorCode);
      lines.push(`Style        ${style}`);
      lines.push(`Hold Time    ${formatHoldTime(hud.medianHoldTimeHours)}  <i>(completed positions)</i>`);
      lines.push(`Activity     ${hud.avgTradesPerDay.toFixed(1)} tx/day  ·  ${hud.uniqueTokensPerDay.toFixed(1)} tokens/day`);
    }

    if (behavior?.exitPattern) {
      lines.push(`Exit         ${behavior.exitPattern.replace(/_/g, ' ')}`);
    }
    if (behavior?.buySellRatio !== null && behavior?.buySellRatio !== undefined) {
      lines.push(`Buy/Sell     ${behavior.buySellRatio.toFixed(2)}`);
    }
  }

  // ── PORTFOLIO ─────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('━━━ PORTFOLIO ━━━');

  if (hud) {
    const flags: string[] = [];
    if (hud.isWhale) flags.push('🐋 Whale');
    if (hud.isBot)   flags.push('🤖 Bot');

    const holdingsStr = hud.currentHoldingsUsd
      ? `${hud.currentHoldingsSol.toFixed(1)} SOL ($${formatUsd(hud.currentHoldingsUsd)})`
      : `${hud.currentHoldingsSol.toFixed(1)} SOL`;
    lines.push(`Holdings    ${holdingsStr}${flags.length ? '  ' + flags.join('  ') : ''}`);
  }

  if (summary.currentSolBalance !== null && summary.currentSolBalance !== undefined) {
    lines.push(`SOL Balance  ${summary.currentSolBalance.toFixed(2)} SOL`);
  }

  if (summary.knownLabel || summary.knownType) {
    lines.push(`Known As     ${summary.knownLabel ?? summary.knownType}`);
  }

  // ── META ──────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('━━━ META ━━━');

  if (hud) {
    const dataRange = hud.provenance?.dataRange;
    const dataPeriod = dataRange?.from && dataRange?.to
      ? `${formatDateCompact(dataRange.from)} – ${formatDateCompact(dataRange.to)}`
      : formatDateCompact(hud.calculatedAt);
    lines.push(`Quality   ${hud.dataQualityTier}  ·  ${dataPeriod}`);
  }

  lines.push(`Updated   ${timeAgo(summary.lastAnalyzedAt)}`);

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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}min ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
