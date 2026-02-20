export interface ComparisonFormatResult {
  summary: string;
  report?: string;
}

export function formatComparison(addresses: string[], result: unknown): ComparisonFormatResult {
  const data = result as Record<string, unknown> | undefined;

  if (!data) {
    return { summary: `Similarity analysis complete for ${addresses.length} wallets, but no data was returned.` };
  }

  const lines: string[] = [];
  lines.push(`SIMILARITY ANALYSIS: ${addresses.length} wallets`);
  lines.push('');

  // Try to extract pairs from the result
  const pairs = extractPairs(data);

  if (pairs.length > 0) {
    lines.push('Pair                         Similarity');
    lines.push('\u2014'.repeat(50));

    for (const pair of pairs) {
      const a = `${pair.addr1.slice(0, 4)}..${pair.addr1.slice(-4)}`;
      const b = `${pair.addr2.slice(0, 4)}..${pair.addr2.slice(-4)}`;
      const pct = `${Math.round(pair.similarity * 100)}%`;
      const label = pair.similarity >= 0.7 ? 'High' : pair.similarity >= 0.4 ? 'Medium' : 'Low';
      const desc = pair.similarity >= 0.7
        ? 'likely same strategy'
        : pair.similarity >= 0.4
          ? 'some overlap'
          : 'independent';
      lines.push(`${a} \u2194 ${b}    ${pct.padStart(4)}    (${label} \u2014 ${desc})`);
    }

    // Verdict
    const highPairs = pairs.filter(p => p.similarity >= 0.7);
    if (highPairs.length > 0) {
      lines.push('');
      lines.push('Verdict: High similarity detected between some wallets.');
      lines.push('         Possible same operator or copy-trading.');
    } else {
      lines.push('');
      lines.push('Verdict: No strong similarity detected. Wallets appear independent.');
    }
  } else {
    // Fallback: dump summary from raw data
    lines.push('Results received. See attached report for details.');
  }

  // Build markdown report
  const report = buildReport(addresses, data);

  return { summary: lines.join('\n'), report };
}

interface SimilarityPair {
  addr1: string;
  addr2: string;
  similarity: number;
}

function extractPairs(data: Record<string, unknown>): SimilarityPair[] {
  // The similarity result shape may vary — attempt common patterns
  const pairs: SimilarityPair[] = [];

  // Pattern 1: { pairs: [{ wallet1, wallet2, score }] }
  const rawPairs = data.pairs ?? data.results ?? data.comparisons;
  if (Array.isArray(rawPairs)) {
    for (const p of rawPairs) {
      const obj = p as Record<string, unknown>;
      const addr1 = (obj.wallet1 ?? obj.address1 ?? obj.walletA) as string | undefined;
      const addr2 = (obj.wallet2 ?? obj.address2 ?? obj.walletB) as string | undefined;
      const sim = (obj.score ?? obj.similarity ?? obj.similarityScore) as number | undefined;
      if (addr1 && addr2 && sim !== undefined) {
        pairs.push({ addr1, addr2, similarity: sim });
      }
    }
  }

  // Pattern 2: { matrix: { addr: { addr: score } } }
  if (pairs.length === 0 && data.matrix && typeof data.matrix === 'object') {
    const matrix = data.matrix as Record<string, Record<string, number>>;
    const addrs = Object.keys(matrix);
    for (let i = 0; i < addrs.length; i++) {
      for (let j = i + 1; j < addrs.length; j++) {
        const sim = matrix[addrs[i]]?.[addrs[j]];
        if (typeof sim === 'number') {
          pairs.push({ addr1: addrs[i], addr2: addrs[j], similarity: sim });
        }
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

function buildReport(addresses: string[], data: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# Similarity Analysis Report`);
  lines.push(`**Wallets**: ${addresses.length}`);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Addresses');
  for (const addr of addresses) {
    lines.push(`- \`${addr}\``);
  }
  lines.push('');
  lines.push('## Raw Data');
  lines.push('```json');
  lines.push(JSON.stringify(data, null, 2).slice(0, 4000));
  lines.push('```');
  return lines.join('\n');
}
