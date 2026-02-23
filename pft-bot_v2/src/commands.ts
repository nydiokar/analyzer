import { COMMAND_PRICES, HELP_TEXT } from './config.js';
import type { AnalyzerClient } from './analyzer.js';
import type { DeferredJobs } from './deferred-jobs.js';
import { formatWalletProfile } from './formatters/profile.js';

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface ParsedCommand {
  command: string;
  args: string[];
  raw: string;
}

export function parseCommand(message: string): ParsedCommand {
  const trimmed = message.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';

  if (!cmd.startsWith('/')) {
    return { command: 'unknown', args: [], raw: trimmed };
  }

  const args = parts.slice(1).filter(a => SOLANA_ADDR_RE.test(a));

  switch (cmd) {
    case '/holders':
      if (args.length < 1) return { command: '/holders', args: [], raw: trimmed };
      return { command: '/holders', args: [args[0]], raw: trimmed };

    case '/profile':
      if (args.length < 1) return { command: '/profile', args: [], raw: trimmed };
      return { command: '/profile', args: [args[0]], raw: trimmed };

    case '/analyze': {
      if (args.length < 1) return { command: '/analyze', args: [], raw: trimmed };
      return { command: '/analyze', args: [args[0]], raw: trimmed };
    }

    case '/compare':
      if (args.length < 2) return { command: '/compare', args, raw: trimmed };
      return { command: '/compare', args: args.slice(0, 30), raw: trimmed };

    default:
      return { command: 'unknown', args: [], raw: trimmed };
  }
}

export interface CommandResult {
  text: string;
  attachment?: { content: string; contentType: string; filename: string };
}

export async function handleCommand(
  parsed: ParsedCommand,
  sender: string,
  txHash: string,
  analyzer: AnalyzerClient,
  deferred: DeferredJobs,
  threadId?: string,
): Promise<CommandResult> {
  // Unknown command
  if (parsed.command === 'unknown') {
    return { text: `Unknown command.\n\n${HELP_TEXT}` };
  }

  // Missing args
  if (parsed.args.length === 0) {
    const examples: Record<string, string> = {
      '/holders': '/holders <token_mint_address>',
      '/profile': '/profile <wallet_address>',
      '/analyze': '/analyze <wallet_address>',
      '/compare': '/compare <address1> <address2> [address3...]',
    };
    return {
      text: `Missing address.\nUsage: ${examples[parsed.command] ?? parsed.command}\n\nAddresses must be valid Solana base58 (32-44 characters).`,
    };
  }

  // /compare needs at least 2
  if (parsed.command === '/compare' && parsed.args.length < 2) {
    return { text: 'Compare requires at least 2 wallet addresses.\nUsage: /compare <addr1> <addr2> [addr3...]' };
  }

  try {
    switch (parsed.command) {
      case '/holders':
        return await handleHolders(parsed.args[0], sender, txHash, analyzer, deferred, threadId);

      case '/profile':
        return await handleProfile(parsed.args[0], sender, txHash, analyzer, deferred, threadId);

      case '/analyze':
        return await handleAnalyze(parsed.args[0], sender, txHash, analyzer, deferred, threadId);

      case '/compare':
        return await handleCompare(parsed.args, sender, txHash, analyzer, deferred, threadId);

      default:
        return { text: HELP_TEXT };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CMD] Error handling ${parsed.command}:`, msg);
    return { text: `Error processing your request. Please try again later.\n\nDetails: ${msg}` };
  }
}

async function handleHolders(
  mint: string,
  sender: string,
  txHash: string,
  analyzer: AnalyzerClient,
  deferred: DeferredJobs,
  threadId?: string,
): Promise<CommandResult> {
  // Fetch optional token display name — non-critical
  let tokenName: string | undefined;
  let tokenSymbol: string | undefined;
  try {
    const infos = await analyzer.getTokenInfo([mint]);
    if (infos[0]) {
      tokenName = infos[0].name;
      tokenSymbol = infos[0].symbol;
    }
  } catch {
    // continue without token name
  }

  // Queue a single holder-profiles job that handles staleness/freshness
  // internally — syncs + analyzes each wallet, streams results, completes as one unit.
  const job = await analyzer.queueHolderProfilesAnalysis(mint, 10);

  const displayToken = tokenName && tokenSymbol
    ? `${tokenName} (${tokenSymbol})`
    : `${mint.slice(0, 6)}..${mint.slice(-4)}`;

  deferred.addJob({
    jobId: job.jobId,
    type: 'holders',
    sender,
    txHash,
    threadId,
    queuedAt: Date.now(),
    tokenMint: mint,
    tokenName,
    tokenSymbol,
  });

  return {
    text: `Analyzing top ${job.topN} holders of ${displayToken}.\nEstimated: ${job.estimatedProcessingTime}. I'll send the full report when ready.`,
  };
}

async function handleProfile(
  address: string,
  sender: string,
  txHash: string,
  analyzer: AnalyzerClient,
  deferred: DeferredJobs,
  threadId?: string,
): Promise<CommandResult> {
  const short = `${address.slice(0, 4)}..${address.slice(-4)}`;

  // Step 1: try HUD — fast Redis read, cache-backed
  const hud = await analyzer.getWalletHud(address);

  if (hud) {
    // Happy path — data exists, respond immediately
    return { text: formatWalletProfile(address, hud) };
  }

  // Step 2: no HUD — queue a single deep analysis, no follow-up chain
  const job = await analyzer.queueDashboardAnalysis(address, 'deep', {
    queueWorkingAfter: false,
    queueDeepAfter: false,
  });

  if (job.skipped && job.skipReason) {
    const isLp = job.skipReason.toLowerCase().includes('lp') || job.skipReason.toLowerCase().includes('liquidity');
    const label = isLp ? 'liquidity pool' : 'system wallet';
    return { text: `${short} is a known ${label} — behavioral analysis is not available for this address.` };
  }

  if (!job.jobId) {
    return { text: `${short} analysis couldn't be queued. Please try again.` };
  }

  deferred.addJob({
    jobId: job.jobId,
    type: 'profile',
    sender,
    txHash,
    threadId,
    queuedAt: Date.now(),
    walletAddress: address,
  });

  const alreadyRunning = job.alreadyRunning ? ' (already in progress)' : '';
  return {
    text: `${short} hasn't been analyzed yet. Running analysis${alreadyRunning} — I'll send the profile when ready (${job.estimatedProcessingTime}).`,
  };
}

async function handleAnalyze(
  address: string,
  sender: string,
  txHash: string,
  analyzer: AnalyzerClient,
  deferred: DeferredJobs,
  threadId?: string,
): Promise<CommandResult> {
  const short = `${address.slice(0, 4)}..${address.slice(-4)}`;

  // Always run a fresh deep analysis — no follow-up chain, forceRefresh bypasses freshness checks
  const result = await analyzer.queueDashboardAnalysis(address, 'deep', {
    queueWorkingAfter: false,
    queueDeepAfter: false,
    forceRefresh: true,
  });

  if (result.skipped && result.skipReason) {
    // Only skip for known system/LP wallets — forceRefresh prevents freshness skips
    const isLp = result.skipReason.toLowerCase().includes('lp') || result.skipReason.toLowerCase().includes('liquidity');
    const label = isLp ? 'liquidity pool' : 'system wallet';
    return { text: `${short} is a known ${label} — behavioral analysis is not available for this address.` };
  }

  if (!result.jobId) {
    // Shouldn't happen with forceRefresh, but if it does fetch existing HUD
    const hud = await analyzer.getWalletHud(address);
    if (hud) return { text: formatWalletProfile(address, hud) };
    return { text: 'Analysis could not be queued. Please try again later.' };
  }

  deferred.addJob({
    jobId: result.jobId,
    type: 'analysis',
    sender,
    txHash,
    threadId,
    queuedAt: Date.now(),
    walletAddress: address,
  });

  const running = result.alreadyRunning ? ' (already in progress)' : '';
  return {
    text: `Deep analysis queued for ${short}${running}.\nEstimated: ${result.estimatedProcessingTime}. I'll send the results when ready.`,
  };
}

async function handleCompare(
  addresses: string[],
  sender: string,
  txHash: string,
  analyzer: AnalyzerClient,
  deferred: DeferredJobs,
  threadId?: string,
): Promise<CommandResult> {
  const result = await analyzer.queueSimilarityAnalysis(addresses);

  deferred.addJob({
    jobId: result.jobId,
    type: 'similarity',
    sender,
    txHash,
    threadId,
    queuedAt: Date.now(),
    addresses,
  });

  return {
    text: `Similarity analysis queued for ${result.walletCount} wallets.\nEstimated time: ~45 sec. I'll send the results when ready.`,
  };
}
