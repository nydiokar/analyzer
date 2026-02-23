export interface AnalysisFormatResult {
  summary: string;
  report?: string;
}

export function formatAnalysisResult(walletAddress: string, result: unknown): AnalysisFormatResult {
  const short = `${walletAddress.slice(0, 4)}..${walletAddress.slice(-4)}`;
  const data = result as Record<string, unknown> | undefined;

  if (!data) {
    return { summary: `Analysis complete for ${short}, but no data was returned.` };
  }

  // Extract key metrics from the analysis result
  // The shape varies — we pull what's available
  const pnl = extractNumber(data, 'realizedPnl', 'latestPnl', 'pnl');
  const winRate = extractNumber(data, 'tokenWinRate', 'winRate');
  const style = extractString(data, 'behaviorClassification', 'tradingStyle', 'classification');
  const totalTrades = extractNumber(data, 'totalTradesCount', 'totalTradeCount');
  const totalTokens = extractNumber(data, 'uniqueTokensTraded');
  const volume = extractNumber(data, 'totalVolume');
  const avgTxVal = extractNumber(data, 'averageTransactionValueSol');
  const maxTxVal = extractNumber(data, 'largestTransactionValueSol');

  // Short summary for chat
  const summaryParts: string[] = [`Analysis complete: ${short}`];
  summaryParts.push('');

  const metricsLine: string[] = [];
  if (pnl !== undefined) metricsLine.push(`PnL: ${formatSol(pnl)}`);
  if (winRate !== undefined) metricsLine.push(`Win Rate: ${Math.round(winRate > 1 ? winRate : winRate * 100)}%`);
  if (style) metricsLine.push(`Style: ${style}`);
  if (metricsLine.length > 0) summaryParts.push(metricsLine.join(' | '));

  const volumeLine: string[] = [];
  if (volume !== undefined) volumeLine.push(`Volume: ${formatSol(volume)} total`);
  if (totalTrades !== undefined) volumeLine.push(`${totalTrades} trades`);
  if (totalTokens !== undefined) volumeLine.push(`${totalTokens} tokens`);
  if (volumeLine.length > 0) summaryParts.push(volumeLine.join(' | '));

  if (avgTxVal !== undefined || maxTxVal !== undefined) {
    const riskParts: string[] = [];
    if (avgTxVal !== undefined) riskParts.push(`avg ${avgTxVal.toFixed(1)} SOL/trade`);
    if (maxTxVal !== undefined) riskParts.push(`max ${formatSol(maxTxVal)}`);
    summaryParts.push(`Risk: ${riskParts.join(', ')}`);
  }

  // Build markdown report for attachment
  const report = buildMarkdownReport(short, walletAddress, data);

  if (report) {
    summaryParts.push('');
    summaryParts.push('Full report attached.');
  }

  return { summary: summaryParts.join('\n'), report };
}

function buildMarkdownReport(short: string, address: string, data: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# Wallet Analysis: ${short}`);
  lines.push(`**Address**: \`${address}\``);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Raw Data');
  lines.push('```json');
  lines.push(JSON.stringify(data, null, 2).slice(0, 4000));
  lines.push('```');
  return lines.join('\n');
}

function extractNumber(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const val = deepGet(data, key);
    if (typeof val === 'number') return val;
  }
  return undefined;
}

function extractString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = deepGet(data, key);
    if (typeof val === 'string' && val) return val;
  }
  return undefined;
}

function deepGet(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  // Check one level deep
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && key in (val as Record<string, unknown>)) {
      return (val as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

function formatSol(sol: number): string {
  const abs = Math.abs(sol);
  const sign = sol >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M SOL`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K SOL`;
  return `${sign}${abs.toFixed(1)} SOL`;
}
