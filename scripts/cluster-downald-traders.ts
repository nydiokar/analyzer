/**
 * Downald Twump — Format wallet briefs for LLM clustering
 *
 * Reads analyses/downald-analysis.json
 * Writes analyses/downald-briefs.txt — one plain-text brief per wallet, sorted by token PnL desc
 *
 * No rule-based clustering. The LLM reads the briefs and decides.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/cluster-downald-traders.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const IN_FILE  = path.resolve(__dirname, '../analyses/downald-analysis.json');
const OUT_FILE = path.resolve(__dirname, '../analyses/downald-briefs.txt');

interface WalletCard {
  address: string;
  tier: string | null;
  isBot: boolean;
  behaviorCategory: string | null;
  holdStyle: string;
  winRate: number | null;
  trimmedMeanPnl: number | null;
  avgTradesPerDay: number | null;
  walletAgeDays: number | null;
  efficiency: number | null;
  consistency: number | null;
  pnlPerDay: number | null;
  token: {
    realizedPnlSol: number | null;
    totalSolSpent: number;
    totalSolReceived: number;
    tokenROI: number | null;
    entryRank: number | null;
    firstEntryTs: number | null;
    lastExitTs: number | null;
  } | null;
}

function fmt(n: number | null, decimals = 2): string {
  return n != null ? n.toFixed(decimals) : 'n/a';
}

function entryLabel(rank: number | null): string {
  if (rank == null) return 'unknown';
  if (rank <= 0.15) return `very early (top ${(rank * 100).toFixed(0)}%)`;
  if (rank <= 0.35) return `early (top ${(rank * 100).toFixed(0)}%)`;
  if (rank <= 0.65) return `mid (${(rank * 100).toFixed(0)}%)`;
  return `late (${(rank * 100).toFixed(0)}%)`;
}

function brief(w: WalletCard, index: number): string {
  const t = w.token;
  const lines: string[] = [];

  lines.push(`--- WALLET ${index} ---`);
  lines.push(`Address:       ${w.address}`);
  lines.push(`Bot flag:      ${w.isBot ? 'YES' : 'no'}`);
  lines.push(`Tier:          ${w.tier ?? 'n/a'} | Behavior: ${w.behaviorCategory ?? 'n/a'} | Hold style: ${w.holdStyle}`);
  lines.push(`Wallet age:    ${w.walletAgeDays != null ? w.walletAgeDays + ' days' : 'unknown'}`);
  lines.push(`Trades/day:    ${fmt(w.avgTradesPerDay, 1)}`);
  lines.push(`Win rate:      ${w.winRate != null ? (w.winRate * 100).toFixed(0) + '%' : 'n/a'} (across all tokens ever traded)`);
  lines.push(`Trimmed PnL:   ${fmt(w.trimmedMeanPnl)} SOL/token avg (outliers removed)`);
  lines.push(`Efficiency:    ${fmt(w.efficiency)} (capital deployment quality; higher = more intentional sizing)`);
  lines.push(`Consistency:   ${fmt(w.consistency)} (PnL repeatability; higher = systematic edge, lower = variance/luck)`);
  lines.push(`PnL/day:       ${fmt(w.pnlPerDay)} SOL/active day`);

  if (t) {
    lines.push(`--- On Downald Twump ---`);
    lines.push(`Token PnL:     ${fmt(t.realizedPnlSol)} SOL realized`);
    lines.push(`Position:      ${fmt(t.totalSolSpent)} SOL in → ${fmt(t.totalSolReceived)} SOL out`);
    lines.push(`Token ROI:     ${t.tokenROI != null ? t.tokenROI.toFixed(2) + 'x' : 'n/a'}`);
    lines.push(`Entry timing:  ${entryLabel(t.entryRank)} among the 48 top traders`);
  } else {
    lines.push(`--- On Downald Twump ---`);
    lines.push(`No trade record found for this token.`);
  }

  return lines.join('\n');
}

function main() {
  const raw = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
  const wallets: WalletCard[] = raw.wallets;

  // Sort by token PnL descending, no-data at the bottom
  const sorted = [...wallets].sort((a, b) => {
    const pa = a.token?.realizedPnlSol ?? -Infinity;
    const pb = b.token?.realizedPnlSol ?? -Infinity;
    return pb - pa;
  });

  const header = [
    `DOWNALD TWUMP (${raw.tokenMint})`,
    `Top ${wallets.length} traders — signal briefs for LLM clustering`,
    `Generated: ${new Date().toISOString()}`,
    `Sorted by: realized PnL on this token (highest first)`,
    ``,
    `CLUSTERING INSTRUCTIONS FOR LLM:`,
    `Assign each wallet ONE of: EARLY_CONVICTION | SMART_MONEY | HIGH_VOLUME | MOMENTUM_TRADER | LP_HARVESTER | UNPROFITABLE | BOT | NO_DATA`,
    ``,
    `Definitions:`,
    `  EARLY_CONVICTION  — Got in very early (top 20%), small position, high ROI. Ignore overall win rate — these wallets spray many early plays and lose most. The early+ROI combo is the signal.`,
    `  SMART_MONEY       — Low frequency, high win rate, positive trimmedMeanPnl across many tokens. Verified edge, not a one-off.`,
    `  HIGH_VOLUME       — Deployed ≥50 SOL on this token and came out profitable. Scale suggests information or coordination.`,
    `  MOMENTUM_TRADER   — Profitable on this token but no dominant structural signal. Rode the move well.`,
    `  LP_HARVESTER      — Very high win rate (>75%) AND sniper/scalper behavior AND high efficiency. Structural fee extraction, not directional. Exclude from alpha signals.`,
    `  UNPROFITABLE      — Lost money on this token. Useful context, not a signal to follow.`,
    `  BOT               — System-flagged as bot.`,
    `  NO_DATA           — No trade record for this token.`,
    ``,
    `Notes:`,
    `  - A wallet can show low overall win rate but be EARLY_CONVICTION if it entered very early with high ROI`,
    `  - LP_HARVESTER requires HIGH win rate + sniper style + high efficiency TOGETHER — not just one`,
    `  - Efficiency and consistency are relative signals — extremely high efficiency on a sniper is suspicious`,
    `  - Wallet age matters: a 2-day-old wallet with 96 SOL profit on 2 SOL spent is an insider, not a degen`,
    ``,
    `=`.repeat(60),
  ].join('\n');

  const briefs = sorted.map((w, i) => brief(w, i + 1)).join('\n\n');
  const output = header + '\n\n' + briefs;

  fs.writeFileSync(OUT_FILE, output);

  console.log(`\nWrote ${wallets.length} wallet briefs -> ${OUT_FILE}`);
  console.log(`Paste into LLM with the clustering instructions above.`);
}

main();
