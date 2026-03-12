import type { HolderProfile, HolderProfilesResult } from '@sova-intel/sdk';

// Canonical hold-time order: shortest → longest.
// Any label not in this list gets appended at the end alphabetically.
const BEHAVIOR_ORDER: string[] = [
  'Sniper',
  'Ultra Flipper',
  'Flipper',
  'Scalper',
  'Fast Trader',
  'Momentum',
  'Intraday',
  'Day Trader',
  'Swing',
  'Position',
  'Holder',
  'Accumulator',
  'Distributor',
  'Balanced',
  'Low Activity',
  'New',
];

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
  'New': '🆕',
};

export function formatHolderProfilesResult(result: HolderProfilesResult): string {
  const lines: string[] = [];

  const mint = result.tokenMint ?? '?';
  lines.push(`🪙 <code>${mint}</code>`);
  lines.push('');

  const systemProfiles = result.profiles.filter(p => p.analysisSkipped && p.knownType);
  const realProfiles   = result.profiles.filter(p => !p.analysisSkipped || !p.knownType);
  const analyzedCount  = realProfiles.filter(p => p.behaviorType !== null).length;
  const newCount       = realProfiles.length - analyzedCount;

  // ── DISTRIBUTION (elevated, sorted by hold-time spectrum) ─────────────────
  if (analyzedCount > 0) {
    const countsByType: Record<string, { count: number; supply: number }> = {};
    for (const p of realProfiles) {
      const label = p.behaviorType ? formatBehavior(p.behaviorType) : 'New';
      if (!countsByType[label]) countsByType[label] = { count: 0, supply: 0 };
      countsByType[label].count  += 1;
      countsByType[label].supply += p.supplyPercent;
    }

    const sorted = Object.entries(countsByType).sort(([a], [b]) => {
      const ai = BEHAVIOR_ORDER.indexOf(a);
      const bi = BEHAVIOR_ORDER.indexOf(b);
      const aIdx = ai === -1 ? BEHAVIOR_ORDER.length : ai;
      const bIdx = bi === -1 ? BEHAVIOR_ORDER.length : bi;
      return aIdx - bIdx;
    });

    const dist = sorted
      .map(([k, v]) => `${withBehaviorEmoji(k)} ${v.count} (${v.supply.toFixed(1)}%)`)
      .join('  ');

    lines.push(`<b>━━━ DISTRIBUTION ━━━</b>`);
    lines.push(dist);
    const summary = newCount > 0
      ? `<i>${analyzedCount} classified · ${newCount} new · ${realProfiles.length} total</i>`
      : `<i>${analyzedCount} of ${realProfiles.length} classified</i>`;
    lines.push(summary);
    lines.push('');
  } else {
    lines.push(`<i>${analyzedCount} of ${realProfiles.length} classified</i>`);
    lines.push('');
  }

  // ── TOP HOLDERS ───────────────────────────────────────────────────────────
  lines.push('<b>━━━ TOP HOLDERS ━━━</b>');
  for (const profile of realProfiles.slice(0, 10)) {
    const addr      = profile.walletAddress;
    const shortAddr = `${addr.slice(0, 4)}..${addr.slice(-4)}`;
    const supply    = `${profile.supplyPercent.toFixed(1)}%`;
    const pnl       = formatPnl(profile.walletRealizedPnlSol ?? profile.walletPnlSol ?? undefined);
    const style     = withBehaviorEmoji(formatBehavior(profile.behaviorType ?? undefined));
    const hold      = formatHoldTime(profile.medianHoldTimeHours ?? undefined);
    const quality   = formatDataQuality(profile.dataQualityTier, profile.completedCycleCount);
    const bag       = formatTokenBag(profile.tokenHoldingValueSol ?? undefined);

    lines.push(`<b>#${profile.rank}</b> <code>${shortAddr}</code>  ${supply}  ${style}  ${quality}`);
    lines.push(`  Bag ${bag}  ·  PnL ${pnl}  ·  Hold ${hold}`);
    lines.push('');
  }

  if (realProfiles.length > 10) {
    lines.push(`<i>…and ${realProfiles.length - 10} more holders</i>`);
    lines.push('');
  }

  // ── SYSTEM WALLETS (demoted to footer) ────────────────────────────────────
  if (systemProfiles.length > 0) {
    const systemSupply = systemProfiles.reduce((sum, p) => sum + p.supplyPercent, 0);
    const parts = systemProfiles.map(p => {
      const label = p.knownLabel ?? p.knownType ?? 'System';
      const emoji = p.knownType === 'LP' ? '💧' : p.knownType === 'BURN' ? '🔥' : '⚙️';
      return `${emoji} ${label} ${p.supplyPercent.toFixed(1)}%`;
    });
    lines.push(`<i>System wallets (${systemSupply.toFixed(1)}%): ${parts.join('  ·  ')}</i>`);
    lines.push('');
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const { totalProcessingTimeMs } = result.metadata;
  lines.push(`<i>${(totalProcessingTimeMs / 1000).toFixed(1)}s</i>`);

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
  const abs  = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M SOL`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}

function formatHoldTime(hours?: number): string {
  if (hours === undefined || hours === null) return '—';
  if (hours < 1)  return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatTokenBag(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  if (sol < 0.01)       return '<0.01 SOL';
  if (sol >= 1_000_000) return `${(sol / 1_000_000).toFixed(1)}M SOL`;
  if (sol >= 1_000)     return `${(sol / 1_000).toFixed(1)}K SOL`;
  return `${sol.toFixed(2)} SOL`;
}

function formatDataQuality(tier: string, cycles: number): string {
  const tierMap: Record<string, string> = { 'GOLD': '🥇', 'SILVER': '🥈', 'BRONZE': '🥉' };
  const emoji    = tierMap[tier] || '';
  const cycleInfo = cycles > 0 ? `${cycles}c` : '';
  if (emoji && cycleInfo) return `${emoji}${cycleInfo}`;
  if (emoji)     return emoji;
  if (cycleInfo) return cycleInfo;
  return tier || '—';
}
