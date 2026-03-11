import type { HolderProfilesResult } from '@sova/intel-sdk';

const BEHAVIOR_ORDER: string[] = [
  'Sniper', 'Ultra Flipper', 'Flipper', 'Scalper', 'Fast Trader',
  'Momentum', 'Intraday', 'Day Trader', 'Swing', 'Position',
  'Holder', 'Accumulator', 'Distributor', 'Balanced', 'Low Activity', 'New',
];

const BEHAVIOR_LABELS: Record<string, string> = {
  'SNIPER': 'Sniper', 'SCALPER': 'Scalper',
  'MOMENTUM': 'Momentum', 'MOMENTUM_TRADER': 'Momentum',
  'INTRADAY': 'Intraday', 'DAY_TRADER': 'Day Trader',
  'SWING': 'Swing', 'SWING_TRADER': 'Swing',
  'POSITION': 'Position', 'POSITION_TRADER': 'Position',
  'HODLER': 'Holder', 'PURE_HOLDER': 'Holder',
  'ACCUMULATOR': 'Accumulator', 'DISTRIBUTOR': 'Distributor',
  'BALANCED_TRADER': 'Balanced', 'LOW_ACTIVITY': 'Low Activity',
  'FAST_TRADER': 'Fast Trader', 'ULTRA_FLIPPER': 'Ultra Flipper',
  'FLIPPER': 'Flipper',
};

const BEHAVIOR_EMOJIS: Record<string, string> = {
  'Sniper': '🎯', 'Scalper': '⚡', 'Momentum': '🚀',
  'Intraday': '📈', 'Day Trader': '⏱️', 'Swing': '🌊',
  'Position': '🏛️', 'Holder': '💎', 'Accumulator': '🧲',
  'Distributor': '📤', 'Balanced': '⚖️', 'Low Activity': '🛌',
  'Fast Trader': '💨', 'Ultra Flipper': '🌀', 'Flipper': '🔁',
  'New': '🆕',
};

/** Compact group card: distribution + top 5 holders. */
export function formatSignalCard(result: HolderProfilesResult): string {
  const lines: string[] = [];

  const systemProfiles = result.profiles.filter(p => p.analysisSkipped && p.knownType);
  const realProfiles   = result.profiles.filter(p => !p.analysisSkipped || !p.knownType);
  const analyzedCount  = realProfiles.filter(p => p.behaviorType !== null).length;
  const newCount       = realProfiles.length - analyzedCount;

  lines.push(`🔍 <b>Sova Intel</b> · <code>${result.tokenMint ?? '?'}</code>`);
  lines.push('');

  // ── DISTRIBUTION ──────────────────────────────────────────────────────────
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
      return (ai === -1 ? BEHAVIOR_ORDER.length : ai) - (bi === -1 ? BEHAVIOR_ORDER.length : bi);
    });

    lines.push('<b>Trader Distribution</b>');
    for (const [label, { count, supply }] of sorted) {
      const emoji = BEHAVIOR_EMOJIS[label] ?? '•';
      lines.push(`${emoji} <b>${label}</b>  ${count} wallets · <b>${supply.toFixed(1)}%</b> supply`);
    }

    const systemSupply = systemProfiles.reduce((sum, p) => sum + p.supplyPercent, 0);
    if (systemSupply > 0) {
      lines.push(`⚙️ System/LP  ${systemSupply.toFixed(1)}% supply`);
    }

    const classifiedStr = newCount > 0
      ? `${analyzedCount} classified · ${newCount} new · ${realProfiles.length} total holders`
      : `${analyzedCount} of ${realProfiles.length} holders classified`;
    lines.push(`<i>${classifiedStr}</i>`);
    lines.push('');
  }

  // ── TOP 5 HOLDERS ─────────────────────────────────────────────────────────
  const top5 = realProfiles.slice(0, 5);
  if (top5.length > 0) {
    lines.push('<b>Top Holders</b>');
    for (const p of top5) {
      const short   = `${p.walletAddress.slice(0, 4)}..${p.walletAddress.slice(-4)}`;
      const supply  = `${p.supplyPercent.toFixed(1)}%`;
      const style   = p.behaviorType ? withBehaviorEmoji(formatBehavior(p.behaviorType)) : '🆕';
      const pnl     = formatPnl(p.walletRealizedPnlSol ?? p.walletPnlSol ?? undefined);
      lines.push(`<b>#${p.rank}</b> <code>${short}</code>  ${supply}  ${style}  ${pnl}`);
    }
  }

  return lines.join('\n');
}

function formatBehavior(category: string): string {
  if (BEHAVIOR_LABELS[category]) return BEHAVIOR_LABELS[category];
  return category.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function withBehaviorEmoji(style: string): string {
  const emoji = BEHAVIOR_EMOJIS[style];
  return emoji ? `${emoji} ${style}` : style;
}

function formatPnl(sol?: number): string {
  if (sol === undefined || sol === null) return '';
  const abs  = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M SOL`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}
