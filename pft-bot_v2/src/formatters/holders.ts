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
      const label = formatBehavior(hud.behaviorCategory, hud.behaviorCode);
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

function formatFlags(hud?: WalletHud): string {
  if (!hud) return '';
  const flags: string[] = [];
  if (hud.isWhale) flags.push('\u{1F40B}');
  if (hud.isBot) flags.push('\u{1F916}');
  if (hud.winRate > 0.65 && (hud.dataQualityTier === 'GOLD' || hud.dataQualityTier === 'SILVER')) {
    flags.push('\u2B50');
  }
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
  const title = tokenName && tokenSymbol
    ? `TOKEN: ${tokenName} (${tokenSymbol})`
    : `TOKEN: ${mint.slice(0, 6)}..${mint.slice(-4)}`;
  lines.push(title);

  // Separate system vs real profiles
  const systemProfiles = result.profiles.filter(p => p.analysisSkipped && p.knownType);
  const realProfiles = result.profiles.filter(p => !p.analysisSkipped || !p.knownType);

  const analyzedCount = realProfiles.filter(p => p.behaviorType !== null).length;
  lines.push(`Analyzed ${analyzedCount} of ${realProfiles.length} wallets`);
  lines.push('');

  // System accounts summary
  if (systemProfiles.length > 0) {
    const parts = systemProfiles.map(p => {
      const pct = `${p.supplyPercent.toFixed(1)}%`;
      const label = p.knownLabel ?? p.knownType ?? 'System';
      return `${label} ${pct}`.trim();
    });
    lines.push(`System: ${parts.join(' | ')}`);
    lines.push('');
  }

  // Table header
  lines.push('#  Wallet       Supply  PnL          Style        Hold    Flags');
  lines.push('—'.repeat(68));

  for (const profile of realProfiles.slice(0, 10)) {
    const addr = profile.walletAddress;
    const shortAddr = `${addr.slice(0, 4)}..${addr.slice(-4)}`;
    const rank = String(profile.rank).padEnd(2);
    const supplyStr = `${profile.supplyPercent.toFixed(1)}%`.padEnd(7);
    const pnl = formatPnl(profile.walletPnlSol ?? undefined).padEnd(12);
    const style = formatBehavior(profile.behaviorType ?? undefined, undefined).padEnd(12);
    const hold = formatHoldTime(profile.medianHoldTimeHours ?? undefined).padEnd(7);
    const flags = formatProfileFlags(profile);

    lines.push(`${rank} ${shortAddr}  ${supplyStr} ${pnl} ${style} ${hold} ${flags}`);
  }

  if (realProfiles.length > 10) {
    lines.push(`   ... and ${realProfiles.length - 10} more holders`);
  }

  lines.push('');

  // Distribution summary
  if (analyzedCount > 0) {
    const counts: Record<string, number> = {};
    for (const p of realProfiles) {
      if (!p.behaviorType) continue;
      const label = formatBehavior(p.behaviorType, undefined);
      counts[label] = (counts[label] ?? 0) + 1;
    }
    const dist = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
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
  const flags: string[] = [];
  if (p.solBalance && p.solBalance > 1000) flags.push('\u{1F40B}');
  return flags.join(' ');
}
