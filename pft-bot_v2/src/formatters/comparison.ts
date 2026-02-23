export interface ComparisonFormatResult {
  summary: string;
  report?: string;
}

// ── Types matching the backend CombinedSimilarityResult ───────────────────────

interface PairwiseSimilarity {
  walletA: string;
  walletB: string;
  binaryScore: number;
  capitalScore: number;
  sharedTokens: { mint: string; name?: string; symbol?: string }[];
  capitalAllocation: Record<string, { weightA: number; weightB: number }>;
  binarySharedTokenCount: number;
  binaryUniqueTokenCountA: number;
  binaryUniqueTokenCountB: number;
  capitalSharedTokenCount: number;
  capitalUniqueTokenCountA: number;
  capitalUniqueTokenCountB: number;
}

interface CombinedResult {
  pairwiseSimilarities: PairwiseSimilarity[];
  globalMetrics?: { averageSimilarity: number };
  uniqueTokensPerWallet?: Record<string, { binary: number; capital: number }>;
  summary?: { walletCount: number; uniqueTokensTotal: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function short(addr: string): string {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

/** Weighted score matching the dashboard: 40% behavioral + 60% capital */
function overallScore(binaryScore: number, capitalScore: number): number {
  return binaryScore * 0.4 + capitalScore * 0.6;
}

function similarityLabel(score: number): string {
  if (score >= 0.6) return 'High';
  if (score >= 0.2) return 'Moderate';
  return 'Low';
}

function similarityBar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

interface PairContext {
  shared: number;
  totalA: number;
  totalB: number;
  universe: number;
  jaccard: number;       // shared / union
  coverageA: number;     // shared / totalA
  coverageB: number;     // shared / totalB
}

function pairContext(pair: PairwiseSimilarity, universeSize: number): PairContext {
  const shared = pair.binarySharedTokenCount;
  const totalA = pair.binaryUniqueTokenCountA;
  const totalB = pair.binaryUniqueTokenCountB;
  const union = totalA + totalB - shared;
  return {
    shared,
    totalA,
    totalB,
    universe: universeSize,
    jaccard: union > 0 ? shared / union : 0,
    coverageA: totalA > 0 ? shared / totalA : 0,
    coverageB: totalB > 0 ? shared / totalB : 0,
  };
}

/** Build a fact-based verdict string — no judgement, just numbers in context */
function buildVerdict(pair: PairwiseSimilarity, ctx: PairContext): string {
  const facts: string[] = [];

  if (ctx.shared > 0 && ctx.totalA > 0 && ctx.totalB > 0) {
    const jPct = Math.round(ctx.jaccard * 100);
    const covA = Math.round(ctx.coverageA * 100);
    const covB = Math.round(ctx.coverageB * 100);
    const univPct = ctx.universe > 0 ? Math.round(ctx.shared / ctx.universe * 100) : 0;

    facts.push(`${ctx.shared} shared tokens`);
    if (ctx.universe > 0) facts.push(`${univPct}% of the ${ctx.universe}-token universe`);
    facts.push(`Jaccard ${jPct}%`);
    facts.push(`covers ${covA}% of A's portfolio and ${covB}% of B's`);
  }

  // Capital alignment note — do the weights actually track each other?
  const allocs = Object.values(pair.capitalAllocation);
  if (allocs.length >= 5) {
    const diffs = allocs.map(a => Math.abs(a.weightA - a.weightB));
    const avgDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    if (avgDiff < 0.005) {
      facts.push('capital weights closely aligned');
    } else if (avgDiff > 0.02) {
      facts.push('capital weights differ meaningfully despite shared tokens');
    }
  }

  return facts.length > 0 ? facts.join(' · ') : '';
}

function tokenDisplay(t: { mint: string; name?: string; symbol?: string }): string {
  if (t.symbol) return t.symbol;
  if (t.name) return t.name;
  return `${t.mint.slice(0, 6)}..${t.mint.slice(-4)}`;
}

// ── Main extractor — handles both combined and legacy shapes ──────────────────

function extractCombinedPairs(data: Record<string, unknown>): PairwiseSimilarity[] {
  const raw = data.pairwiseSimilarities;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return (raw as Record<string, unknown>[]).flatMap((p) => {
    const walletA = (p.walletA ?? p.wallet1 ?? p.address1) as string | undefined;
    const walletB = (p.walletB ?? p.wallet2 ?? p.address2) as string | undefined;
    if (!walletA || !walletB) return [];

    // Combined result shape
    if (typeof p.binaryScore === 'number' && typeof p.capitalScore === 'number') {
      return [{
        walletA,
        walletB,
        binaryScore: p.binaryScore as number,
        capitalScore: p.capitalScore as number,
        sharedTokens: Array.isArray(p.sharedTokens) ? p.sharedTokens as PairwiseSimilarity['sharedTokens'] : [],
        capitalAllocation: (p.capitalAllocation ?? {}) as PairwiseSimilarity['capitalAllocation'],
        binarySharedTokenCount: (p.binarySharedTokenCount as number) ?? 0,
        binaryUniqueTokenCountA: (p.binaryUniqueTokenCountA as number) ?? 0,
        binaryUniqueTokenCountB: (p.binaryUniqueTokenCountB as number) ?? 0,
        capitalSharedTokenCount: (p.capitalSharedTokenCount as number) ?? 0,
        capitalUniqueTokenCountA: (p.capitalUniqueTokenCountA as number) ?? 0,
        capitalUniqueTokenCountB: (p.capitalUniqueTokenCountB as number) ?? 0,
      }];
    }

    // Legacy/single-vector shape — treat as capital=score, binary=score
    const score = (p.score ?? p.similarity ?? p.similarityScore) as number | undefined;
    if (score !== undefined) {
      const shared = (p.sharedTokenCount as number) ?? 0;
      return [{
        walletA,
        walletB,
        binaryScore: score,
        capitalScore: score,
        sharedTokens: Array.isArray(p.sharedTokens) ? p.sharedTokens as PairwiseSimilarity['sharedTokens'] : [],
        capitalAllocation: {},
        binarySharedTokenCount: shared,
        binaryUniqueTokenCountA: 0,
        binaryUniqueTokenCountB: 0,
        capitalSharedTokenCount: shared,
        capitalUniqueTokenCountA: 0,
        capitalUniqueTokenCountB: 0,
      }];
    }

    return [];
  }).sort((a, b) => overallScore(b.binaryScore, b.capitalScore) - overallScore(a.binaryScore, a.capitalScore));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function formatComparison(addresses: string[], result: unknown): ComparisonFormatResult {
  const data = result as Record<string, unknown> | undefined;

  if (!data) {
    return { summary: `Similarity analysis complete for ${addresses.length} wallets, but no data was returned.` };
  }

  const pairs = extractCombinedPairs(data);

  if (pairs.length === 0) {
    return {
      summary: `Similarity analysis complete for ${addresses.length} wallets.\nNo pair data could be extracted from the result.`,
      report: buildReport(addresses, data, []),
    };
  }

  // ── Chat summary ────────────────────────────────────────────────────────────
  const lines: string[] = [];
  const universeSize = (data as Record<string, unknown> & { summary?: { uniqueTokensTotal?: number } }).summary?.uniqueTokensTotal ?? 0;

  lines.push(`WALLET COMPARISON — ${addresses.length} wallets, ${pairs.length} pair${pairs.length !== 1 ? 's' : ''}`);
  if (universeSize > 0) lines.push(`Token universe: ${universeSize} unique tokens across all wallets`);
  lines.push('');

  for (const pair of pairs) {
    const overall = overallScore(pair.binaryScore, pair.capitalScore);
    const pct = `${Math.round(overall * 100)}%`;
    const label = similarityLabel(overall);
    const a = short(pair.walletA);
    const b = short(pair.walletB);
    const bar = similarityBar(overall, 15);
    const sharedCount = pair.binarySharedTokenCount || pair.sharedTokens.length;
    const ctx = pairContext(pair, universeSize);

    lines.push(`${a} ↔ ${b}`);
    lines.push(`  ${bar} ${pct} (${label})`);
    lines.push(`  Behavioral: ${Math.round(pair.binaryScore * 100)}%  |  Capital: ${Math.round(pair.capitalScore * 100)}%`);

    if (ctx.shared > 0 && ctx.totalA > 0 && ctx.totalB > 0) {
      const covA = Math.round(ctx.coverageA * 100);
      const covB = Math.round(ctx.coverageB * 100);
      const jPct = Math.round(ctx.jaccard * 100);
      lines.push(`  Shared tokens: ${sharedCount} (${covA}% of A · ${covB}% of B · Jaccard ${jPct}%)`);
    } else {
      lines.push(`  Shared tokens: ${sharedCount}`);
    }

    // Show up to 5 shared tokens inline if available
    if (pair.sharedTokens.length > 0) {
      const names = pair.sharedTokens.slice(0, 5).map(tokenDisplay).join(', ');
      const more = pair.sharedTokens.length > 5 ? ` +${pair.sharedTokens.length - 5} more` : '';
      lines.push(`  Overlap: ${names}${more}`);
    }

    lines.push('');
  }

  lines.push('Full report attached.');

  return {
    summary: lines.join('\n'),
    report: buildReport(addresses, data, pairs),
  };
}

// ── Markdown report ───────────────────────────────────────────────────────────

function buildReport(addresses: string[], data: Record<string, unknown>, pairs: PairwiseSimilarity[]): string {
  const combined = data as unknown as Partial<CombinedResult>;
  const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

  const lines: string[] = [];

  // Header
  lines.push('# Wallet Similarity Report');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Wallets analyzed | ${addresses.length} |`);
  lines.push(`| Pairs compared | ${pairs.length} |`);
  lines.push(`| Generated | ${now} UTC |`);
  if (combined.summary?.uniqueTokensTotal) {
    lines.push(`| Unique tokens in universe | ${combined.summary.uniqueTokensTotal} |`);
  }
  lines.push('');

  // Wallet list
  lines.push('## Wallets');
  lines.push('');
  addresses.forEach((addr, i) => {
    const tokenCount = combined.uniqueTokensPerWallet?.[addr];
    const info = tokenCount
      ? ` — ${tokenCount.binary ?? tokenCount} tokens (binary), ${tokenCount.capital ?? '?'} (capital)`
      : '';
    lines.push(`${i + 1}. \`${addr}\`${info}`);
  });
  lines.push('');

  // Pair-by-pair breakdown
  if (pairs.length > 0) {
    lines.push('## Pair Analysis');
    lines.push('');

    for (const pair of pairs) {
      const overall = overallScore(pair.binaryScore, pair.capitalScore);
      const label = similarityLabel(overall);
      const sharedCount = pair.binarySharedTokenCount || pair.sharedTokens.length;

      lines.push(`### ${short(pair.walletA)} ↔ ${short(pair.walletB)}`);
      lines.push('');
      lines.push(`**Full addresses**`);
      lines.push(`- A: \`${pair.walletA}\``);
      lines.push(`- B: \`${pair.walletB}\``);
      lines.push('');
      lines.push(`| Metric | Score |`);
      lines.push(`|---|---|`);
      lines.push(`| Overall similarity | **${Math.round(overall * 100)}%** (${label}) |`);
      lines.push(`| Behavioral (binary) | ${Math.round(pair.binaryScore * 100)}% |`);
      lines.push(`| Capital (weighted) | ${Math.round(pair.capitalScore * 100)}% |`);
      lines.push(`| Shared tokens (binary) | ${sharedCount} |`);
      if (pair.capitalSharedTokenCount) {
        lines.push(`| Shared tokens (capital) | ${pair.capitalSharedTokenCount} |`);
      }
      lines.push('');

      // Shared tokens table — only show tokens with meaningful capital weight
      if (pair.sharedTokens.length > 0) {
        const hasNames = pair.sharedTokens.some(t => t.name || t.symbol);

        // Filter to tokens with at least 0.1% weight in either wallet, cap at 50
        const weighted = pair.sharedTokens.filter(t => {
          const alloc = pair.capitalAllocation[t.mint];
          return alloc && (alloc.weightA >= 0.001 || alloc.weightB >= 0.001);
        });
        const displayTokens = weighted.length > 0 ? weighted.slice(0, 50) : pair.sharedTokens.slice(0, 50);
        const hiddenCount = pair.sharedTokens.length - displayTokens.length;

        lines.push(`**Shared tokens (${pair.sharedTokens.length} total${weighted.length > 0 ? `, ${weighted.length} with meaningful capital weight` : ''})**`);
        lines.push('');

        if (hasNames) {
          lines.push('| Token | Symbol | Mint | Wallet A | Wallet B |');
          lines.push('|---|---|---|---|---|');
          for (const t of displayTokens) {
            const alloc = pair.capitalAllocation[t.mint];
            const wA = alloc ? `${(alloc.weightA * 100).toFixed(1)}%` : '—';
            const wB = alloc ? `${(alloc.weightB * 100).toFixed(1)}%` : '—';
            lines.push(`| ${t.name ?? '—'} | ${t.symbol ?? '—'} | \`${t.mint.slice(0, 6)}..${t.mint.slice(-4)}\` | ${wA} | ${wB} |`);
          }
        } else {
          lines.push('| Mint | Wallet A | Wallet B |');
          lines.push('|---|---|---|');
          for (const t of displayTokens) {
            const alloc = pair.capitalAllocation[t.mint];
            const wA = alloc ? `${(alloc.weightA * 100).toFixed(1)}%` : '—';
            const wB = alloc ? `${(alloc.weightB * 100).toFixed(1)}%` : '—';
            lines.push(`| \`${t.mint}\` | ${wA} | ${wB} |`);
          }
        }

        if (hiddenCount > 0) {
          lines.push('');
          lines.push(`*+ ${hiddenCount} more tokens with negligible weight not shown.*`);
        }
        lines.push('');
      } else {
        lines.push('*No shared token details available.*');
        lines.push('');
      }
    }
  }

  // Summary verdict
  lines.push('## Context');
  lines.push('');
  if (pairs.length === 0) {
    lines.push('No pair data available.');
  } else {
    for (const pair of pairs) {
      const ctx = pairContext(pair, combined.summary?.uniqueTokensTotal ?? 0);
      const overall = overallScore(pair.binaryScore, pair.capitalScore);
      const verdict = buildVerdict(pair, ctx);

      lines.push(`**${short(pair.walletA)} ↔ ${short(pair.walletB)}** — ${Math.round(overall * 100)}% overall`);
      lines.push('');

      if (verdict) {
        lines.push(verdict);
        lines.push('');
      }

      // Contextual breakdown — just facts
      if (ctx.shared > 0 && ctx.totalA > 0 && ctx.totalB > 0) {
        lines.push(`- **${ctx.shared} shared tokens** out of ${ctx.totalA} in A and ${ctx.totalB} in B`);
        if (ctx.universe > 0) {
          const univPct = Math.round(ctx.shared / ctx.universe * 100);
          lines.push(`- **${univPct}% of the full ${ctx.universe}-token universe** were touched by both wallets`);
        }
        lines.push(`- **${Math.round(ctx.coverageA * 100)}% of A's portfolio** overlaps with B`);
        lines.push(`- **${Math.round(ctx.coverageB * 100)}% of B's portfolio** overlaps with A`);
        lines.push(`- **Jaccard index: ${Math.round(ctx.jaccard * 100)}%** (shared / union of both portfolios)`);
      }
    }
  }

  return lines.join('\n');
}
