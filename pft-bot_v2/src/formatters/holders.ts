import type { TopHoldersResponse, BatchHudResponse, WalletHud, HolderProfilesResult, HolderProfile } from '../analyzer.js';

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

const SYSTEM_TYPES = new Set(['BURN', 'LP', 'RAYDIUM', 'ORCA', 'JUPITER', 'PROTOCOL', 'EXCHANGE', 'SYSTEM']);

export function formatHolderTable(
  holders: TopHoldersResponse,
  hudData: BatchHudResponse | null,
  tokenName?: string,
  tokenSymbol?: string,
): string {
  const lines: string[] = [];

  // Header
  const title = tokenName && tokenSymbol
    ? `TOKEN: ${tokenName} (${tokenSymbol})`
    : `TOKEN: ${holders.mint.slice(0, 6)}..${holders.mint.slice(-4)}`;
  lines.push(title);

  // Separate system vs real wallets
  const systemHolders = holders.holders.filter(h => h.knownType && SYSTEM_TYPES.has(h.knownType));
  const realHolders = holders.holders.filter(h => !h.knownType && h.ownerAccount);

  // Total supply for percentage calc
  const totalSupply = holders.supply?.uiAmount ?? null;

  const analyzedCount = hudData ? Object.keys(hudData.huds).length : 0;
  lines.push(`Analyzed ${analyzedCount} of ${realHolders.length} wallets`);
  lines.push('');

  // System accounts summary
  if (systemHolders.length > 0) {
    const parts = systemHolders.map(h => {
      const pct = totalSupply && h.uiAmount ? `${((h.uiAmount / totalSupply) * 100).toFixed(1)}%` : '';
      const label = h.knownLabel ?? h.knownType ?? 'System';
      return `${label} ${pct}`.trim();
    });
    lines.push(`System: ${parts.join(' | ')}`);
    lines.push('');
  }

  // Table header
  lines.push('#  Wallet       Supply  PnL          Style        Hold    Flags');
  lines.push('—'.repeat(68));

  // Show up to 10 real wallets
  const display = realHolders.slice(0, 10);

  for (const holder of display) {
    const addr = holder.ownerAccount!;
    const shortAddr = `${addr.slice(0, 4)}..${addr.slice(-4)}`;
    const rank = String(holder.rank).padEnd(2);

    // Supply percentage
    let supplyStr: string;
    if (totalSupply && holder.uiAmount) {
      supplyStr = `${((holder.uiAmount / totalSupply) * 100).toFixed(1)}%`;
    } else {
      supplyStr = holder.uiAmountString ?? '—';
    }
    supplyStr = supplyStr.padEnd(7);

    // HUD data
    const hud = hudData?.huds[addr];
    const pnl = formatPnl(hud?.trimmedMeanPnl).padEnd(12);
    const style = formatBehavior(hud?.behaviorCategory, hud?.behaviorCode).padEnd(12);
    const hold = formatHoldTime(hud?.medianHoldTimeHours).padEnd(7);
    const flags = formatFlags(hud);

    lines.push(`${rank} ${shortAddr}  ${supplyStr} ${pnl} ${style} ${hold} ${flags}`);
  }

  // Remaining wallets summary
  if (realHolders.length > 10) {
    lines.push(`   ... and ${realHolders.length - 10} more holders`);
  }

  lines.push('');

  // Distribution summary
  if (hudData && Object.keys(hudData.huds).length > 0) {
    const counts: Record<string, number> = {};
    for (const hud of Object.values(hudData.huds)) {
      const label = withBehaviorEmoji(formatBehavior(hud.behaviorCategory, hud.behaviorCode));
      counts[label] = (counts[label] ?? 0) + 1;
    }
    const dist = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(' | ');
    lines.push(`Trader types: ${dist}`);
  }

  // Not-analyzed note — jobs are auto-queued by the command handler, no extra charge
  const notFoundCount = hudData?.notFound.length ?? 0;
  if (notFoundCount > 0) {
    lines.push(`\n* ${notFoundCount} wallets queued for analysis — profiles incoming (no extra charge)`);
  }

  return lines.join('\n');
}

function formatPnl(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M SOL`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}

function formatHoldTime(hours?: number): string {
  if (!hours) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatBehavior(category?: string, code?: string): string {
  if (category && BEHAVIOR_LABELS[category]) return BEHAVIOR_LABELS[category];
  if (category) return category.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  if (code) return `(${code})`;
  return '—';
}

function withBehaviorEmoji(style: string): string {
  const emoji = BEHAVIOR_EMOJIS[style];
  return emoji ? `${emoji} ${style}` : style;
}

function formatFlags(hud?: WalletHud): string {
  if (!hud) return '';
  const flags: string[] = [];
  if (hud.isWhale) flags.push('🐋');
  if (hud.isBot) flags.push('🤖');
  return flags.join(' ');
}

// ── Holder-profiles job result formatter ─────────────────────────────────────
// Used by DeferredJobs when a POST /analyses/holder-profiles job completes.
// Works from HolderProfilesResult (the full job payload resolved from Redis).

export function formatHolderProfilesResult(
  result: HolderProfilesResult,
  tokenName?: string,
  tokenSymbol?: string,
): string {
  const lines: string[] = [];

  const mint = result.tokenMint ?? '?';

  // Show full metadata if available, otherwise just the mint
  if (tokenName && tokenSymbol) {
    lines.push(`TOKEN: ${tokenName} (${tokenSymbol})`);
    lines.push(`Mint: ${mint}`);
  } else {
    lines.push(`TOKEN: ${mint}`);
  }
  lines.push('');

  // Separate system vs real profiles
  const systemProfiles = result.profiles.filter(p => p.analysisSkipped && p.knownType);
  const realProfiles = result.profiles.filter(p => !p.analysisSkipped || !p.knownType);

  const analyzedCount = realProfiles.filter(p => p.behaviorType !== null).length;
  lines.push(`Analyzed ${analyzedCount} of ${realProfiles.length} wallets`);

  // System accounts summary
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
    const supplyStr = `${profile.supplyPercent.toFixed(1)}%`;
    lines.push(`#${profile.rank} ${addr}`);
    const tokenBag = formatTokenBag(profile.tokenHoldingValueSol ?? undefined);
    const pnl = formatPnlWithContext(profile.walletRealizedPnlSol ?? profile.walletPnlSol ?? undefined);
    const style = withBehaviorEmoji(formatBehavior(profile.behaviorType ?? undefined, undefined));
    const hold = formatHoldTime(profile.medianHoldTimeHours ?? undefined);
    const quality = formatDataQuality(profile.dataQualityTier, profile.completedCycleCount);
    lines.push(`  Supply: ${supplyStr}  |  Bag: ${tokenBag}  |  PnL: ${pnl}`);
    lines.push(`  Style: ${style}  |  Avg exit: ${hold}  |  Data Quality: ${quality}`);
    lines.push('');
  }

  if (realProfiles.length > 10) {
    lines.push(`... and ${realProfiles.length - 10} more holders`);
    lines.push('');
  }

  lines.push('');

  // Distribution summary with supply %
  if (analyzedCount > 0) {
    const countsByType: Record<string, { count: number; supply: number }> = {};
    for (const p of realProfiles) {
      if (!p.behaviorType) continue;
      const label = formatBehavior(p.behaviorType, undefined);
      if (!countsByType[label]) {
        countsByType[label] = { count: 0, supply: 0 };
      }
      countsByType[label].count += 1;
      countsByType[label].supply += p.supplyPercent;
    }
    const dist = Object.entries(countsByType)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([k, v]) => `${withBehaviorEmoji(k)} ${v.count} (${v.supply.toFixed(1)}%)`)
      .join(' | ');
    lines.push(`Trader types: ${dist}`);
  }

  const { totalHoldersAnalyzed, totalHoldersRequested, totalProcessingTimeMs } = result.metadata;
  if (totalHoldersAnalyzed < totalHoldersRequested) {
    const skipped = totalHoldersRequested - totalHoldersAnalyzed;
    lines.push(`\n* ${skipped} holders skipped (system wallets or insufficient data)`);
  }
  lines.push(`\n[${(totalProcessingTimeMs / 1000).toFixed(1)}s total]`);

  return lines.join('\n');
}

function formatProfileFlags(p: HolderProfile): string {
  // We don't have isWhale or isBot from HUD here - only show what we actually have
  // Could add flags based on data quality, confidence, etc., but keeping it minimal for now
  return '';
}

function formatPnlWithContext(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M SOL`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}

function formatTokenBag(sol?: number): string {
  if (sol === undefined || sol === null) return '—';
  if (sol < 0.01) return '<0.01 SOL';
  if (sol >= 1000000) return `${(sol / 1000000).toFixed(1)}M SOL`;
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K SOL`;
  return `${sol.toFixed(2)} SOL`;
}

function formatDataQuality(tier: string, cycles: number): string {
  const tierMap: Record<string, string> = {
    'GOLD': '🥇',
    'SILVER': '🥈',
    'BRONZE': '🥉',
  };

  const emoji = tierMap[tier] || '';
  const cycleInfo = cycles >= 10 ? `${cycles}c` : cycles > 0 ? `${cycles}c` : '';

  if (emoji && cycleInfo) return `${emoji} ${cycleInfo}`;
  if (emoji) return emoji;
  if (cycleInfo) return cycleInfo;
  return tier || '—';
}
