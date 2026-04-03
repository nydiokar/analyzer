// ---------------------------------------------------------------------------
// Human-readable summaries for each tool result type.
// Factual, concise — no fabricated certainty.
// ---------------------------------------------------------------------------

import type {
  WalletHud,
  WalletProfileResponse,
  AgentHolderProfilesResult,
  AgentSimilarityResult,
  BatchHudResponse,
  TokenPnlResponse,
} from "@sova-intel/sdk";

export function summarizeWalletHud(hud: WalletHud): string {
  const parts: string[] = [];
  parts.push(`${hud.behaviorCode} profile`);
  parts.push(`win rate ${(hud.winRate * 100).toFixed(0)}%`);
  if (hud.medianHoldTimeHours != null) {
    parts.push(`median hold ${hud.medianHoldTimeHours.toFixed(1)}h`);
  }
  parts.push(`data quality ${hud.dataQualityTier}`);
  if (hud.isBot) parts.push("flagged as bot");
  if (hud.isWhale) parts.push("whale");
  return parts.join(", ") + ".";
}

export function summarizeWalletProfile(res: WalletProfileResponse): string {
  const parts: string[] = [];
  if (res.hud) {
    parts.push(`${res.hud.behaviorCode} profile`);
    parts.push(`win rate ${(res.hud.winRate * 100).toFixed(0)}%`);
  }
  if (res.pnl?.allTime) {
    const pnl = res.pnl.allTime.realizedPnlSol;
    parts.push(`realized PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} SOL`);
  }
  if (res.kol) {
    parts.push(`known KOL: ${res.kol.name}`);
  }
  if (res.summary.totalTradesCount) {
    parts.push(`${res.summary.totalTradesCount} trades`);
  }
  return parts.length ? parts.join(", ") + "." : "Wallet profile retrieved.";
}

export function summarizeHolderProfiles(res: AgentHolderProfilesResult): string {
  const { aggregate } = res;
  const top = aggregate.behaviorDistribution[0];
  const parts: string[] = [
    `${aggregate.analyzedHolders}/${aggregate.totalHolders} holders analyzed`,
    `top-5 hold ${aggregate.top5SupplyPct.toFixed(1)}% supply`,
  ];
  if (top) {
    parts.push(`dominant behavior ${top.behaviorType} (${top.count} wallets)`);
  }
  if (aggregate.avgWalletPnlSol != null) {
    parts.push(`avg holder PnL ${aggregate.avgWalletPnlSol.toFixed(2)} SOL`);
  }
  return parts.join(", ") + ".";
}

export function summarizeSimilarity(res: AgentSimilarityResult): string {
  const score = res.coordinationScore;
  const level = score >= 0.7 ? "HIGH" : score >= 0.4 ? "MODERATE" : "LOW";
  const flagged = res.metadata.flaggedPairs;
  const parts = [
    `coordination score ${score.toFixed(2)} (${level})`,
    `${res.metadata.walletsAnalyzed} wallets`,
    `${flagged} flagged pair${flagged !== 1 ? "s" : ""}`,
  ];
  return parts.join(", ") + ".";
}

export function summarizeBatchHud(res: BatchHudResponse): string {
  const ready = Object.keys(res.huds).length;
  const queued = res.queued.length;
  const skipped = res.skipped.length;
  const parts = [`${ready} HUDs ready`];
  if (queued) parts.push(`${queued} queued (stale)`);
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(", ") + ".";
}

export function summarizeTokenPnl(res: TokenPnlResponse, walletAddress: string): string {
  const total = res.total;
  const shown = res.data.length;
  return `${total} token position${total !== 1 ? "s" : ""} for ${walletAddress.slice(0, 8)}… — showing ${shown} on page ${res.page}.`;
}
