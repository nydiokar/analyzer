import type { HolderProfile, HolderProfilesResult } from '../intel-client';

// Copied from pft-bot_v2/src/formatters/holders.ts — adapted for Telegram HTML
const BEHAVIOR_LABELS: Record<string, string> = {
  'SNIPER': 'Sniper',
  'SCALPER': 'Scalper',
  'MOMENTUM': 'Momentum',
  'MOMENTUM_TRADER': 'Momentum',
  'INTRADAY': 'Intraday',
  'DAY_TRADER': 'Day Trader',
  'SWING': 'Swing',
  'SWING_TRADER': 'Swing',
  'POSITION': 'Position',
  'POSITION_TRADER': 'Position',
  'HODLER': 'Holder',
  'PURE_HOLDER': 'Holder',
  'ACCUMULATOR': 'Accumulator',
  'DISTRIBUTOR': 'Distributor',
  'BALANCED_TRADER': 'Balanced',
  'LOW_ACTIVITY': 'Low Activity',
  'FAST_TRADER': 'Fast Trader',
  'ULTRA_FLIPPER': 'Ultra Flipper',
  'FLIPPER': 'Flipper',
};

const BEHAVIOR_EMOJIS: Record<string, string> = {
  'Sniper': '🎯',
  'Scalper': '⚡',
  'Momentum': '🚀',
  'Intraday': '📈',
  'Day Trader': '⏱️',
  'Swing': '🌊',
  'Position': '🏛️',
  'Holder': '💎',
  'Accumulator': '🧲',
  'Distributor': '📤',
  'Balanced': '⚖️',
  'Low Activity': '🛌',
  'Fast Trader': '💨',
  'Ultra Flipper': '🌀',
  'Flipper': '🔁',
};

export function formatHolderProfilesResult(
  result: HolderProfilesResult,
): string {
  const lines: string[] = [];

  const mint = result.tokenMint ?? '?';
  const shortMint = `${mint.slice(0, 6)}..${mint.slice(-4)}`;
  lines.push(`<b>HOLDERS: <code>${shortMint}</code></b>`);
  lines.push('');

  const systemProfiles = result.profiles.filter(p => p.analysisSkipped && p.knownType);
  const realProfiles = result.profiles.filter(p => !p.analysisSkipped || !p.knownType);

  const analyzedCount = realProfiles.filter(p => p.behaviorType !== null).length;
  lines.push(`Analyzed <b>${analyzedCount}</b> of ${realProfiles.length} wallets`);

  if (systemProfiles.length > 0) {
    const systemSupply = systemProfiles.reduce((sum, p) => sum + p.supplyPercent, 0);
    const parts = systemProfiles.map(p => {
      const pct = `${p.supplyPercent.toFixed(1)}%`;
      const label = p.knownLabel ?? p.knownType ?? 'System';
      const emoji = p.knownType === 'LP' ? '💧' : '';
      return `${label} ${emoji} ${pct}`.trim();
    });
    lines.push(`System (${systemSupply.toFixed(1)}%): ${parts.join(' | ')}`);
    lines.push('');
  }

  for (const profile of realProfiles.slice(0, 10)) {
    const addr = profile.walletAddress;
    const shortAddr = `${addr.slice(0, 4)}..${addr.slice(-4)}`;
    const supplyStr = `${profile.supplyPercent.toFixed(1)}%`;
    const pnl = formatPnl(profile.walletRealizedPnlSol ?? profile.walletPnlSol ?? undefined);
    const style = withBehaviorEmoji(formatBehavior(profile.behaviorType ?? undefined));
    const hold = formatHoldTime(profile.medianHoldTimeHours ?? undefined);
    const quality = formatDataQuality(profile.dataQualityTier, profile.completedCycleCount);
    const bag = formatTokenBag(profile.tokenHoldingValueSol ?? undefined);

    lines.push(`<b>#${profile.rank}</b> <code>${shortAddr}</code>`);
    lines.push(`  Supply: ${supplyStr}  Bag: ${bag}  PnL: ${pnl}`);
    lines.push(`  ${style}  Hold: ${hold}  ${quality}`);
    lines.push('');
  }

  if (realProfiles.length > 10) {
    lines.push(`…and ${realProfiles.length - 10} more holders`);
    lines.push('');
  }

  if (analyzedCount > 0) {
    const countsByType: Record<string, { count: number; supply: number }> = {};
    for (const p of realProfiles) {
      if (!p.behaviorType) continue;
      const label = formatBehavior(p.behaviorType);
      if (!countsByType[label]) countsByType[label] = { count: 0, supply: 0 };
      countsByType[label].count += 1;
      countsByType[label].supply += p.supplyPercent;
    }
    const dist = Object.entries(countsByType)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([k, v]) => `${withBehaviorEmoji(k)} ${v.count} (${v.supply.toFixed(1)}%)`)
      .join(' | ');
    lines.push(`<b>Types:</b> ${dist}`);
  }

  const { totalHoldersAnalyzed, totalHoldersRequested, totalProcessingTimeMs } = result.metadata;
  if (totalHoldersAnalyzed < totalHoldersRequested) {
    const skipped = totalHoldersRequested - totalHoldersAnalyzed;
    lines.push(`\n* ${skipped} holders skipped (system wallets or insufficient data)`);
  }
  lines.push(`\n[${(totalProcessingTimeMs / 1000).toFixed(1)}s total]`);

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBehavior(category?: string): string {
  if (!category) return '—';
  if (BEHAVIOR_LABELS[category]) return BEHAVIOR_LABELS[category];
  return category.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function withBehaviorEmoji(style: string): string {
  const emoji = BEHAVIOR_EMOJIS[style];
  return emoji ? `${emoji} ${style}` : style;
}

function formatPnl(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M SOL`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}

function formatHoldTime(hours?: number): string {
  if (!hours) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatTokenBag(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  if (sol < 0.01) return '<0.01 SOL';
  if (sol >= 1_000_000) return `${(sol / 1_000_000).toFixed(1)}M SOL`;
  if (sol >= 1_000) return `${(sol / 1_000).toFixed(1)}K SOL`;
  return `${sol.toFixed(2)} SOL`;
}

function formatDataQuality(tier: string, cycles: number): string {
  const tierMap: Record<string, string> = { 'GOLD': '🥇', 'SILVER': '🥈', 'BRONZE': '🥉' };
  const emoji = tierMap[tier] || '';
  const cycleInfo = cycles > 0 ? `${cycles}c` : '';
  if (emoji && cycleInfo) return `${emoji} ${cycleInfo}`;
  if (emoji) return emoji;
  if (cycleInfo) return cycleInfo;
  return tier || '—';
}
