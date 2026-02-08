import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { getErrorMessage } from '../src/core/utils/error-utils';
import chalk from 'chalk';

dotenv.config();

/**
 * Wallet Behavioral Profiles Script
 *
 * Generates comprehensive behavioral profiles for a list of wallets from the database.
 * Includes metrics like unique tokens traded per day, average trades per day, holding time,
 * flow/speed categories, trading sessions, and velocity scores.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/wallet-behavioral-profiles.ts
 *   npx ts-node -r tsconfig-paths/register scripts/wallet-behavioral-profiles.ts --file report.html
 *   npx ts-node -r tsconfig-paths/register scripts/wallet-behavioral-profiles.ts --format csv --file report.csv
 *
 * Options:
 *   --file <filename>           Save to file (default: terminal output only)
 *   --format <html|csv|json>    Output format (default: table for terminal, html for file)
 *   --limit <number>            Limit number of wallets (default: all)
 *   --sort <metric>             Sort by metric (default: velocityScore)
 */

const USER_ID = 'cmk5i361a0000wkrcssej2bqe';

import * as fs from 'fs';
import * as path from 'path';

interface WalletProfile {
  name: string;
  address: string;
  emoji?: string;

  // Core trading metrics
  uniqueTokensTraded: number;
  totalTradeCount: number;
  avgTradesPerDay: number;
  uniqueTokensPerDay: number;

  // Holding time metrics
  medianHoldTimeHours: number | null;
  medianCompletedHoldTimeHours: number | null;
  medianCurrentHoldingDurationHours: number | null;
  holdingTimeCategory: string;

  // Flow and speed
  flowPattern: string | null;
  speedCategory: string | null;
  velocityScore: number | null;

  // Session metrics
  sessionCount: number;
  avgTradesPerSession: number;
  avgSessionDurationMinutes: number;

  // Trading style
  tradingStyle: string;
  strategyType: string | null;

  // PnL summary
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  netPnl: number | null;
  profitableTokensCount: number;
  unprofitableTokensCount: number;

  // Activity timestamps
  firstTransactionTimestamp: number | null;
  lastTransactionTimestamp: number | null;
  activeDays: number | null;
}

interface ScriptOptions {
  file?: string;
  format?: 'html' | 'csv' | 'json' | 'table';
  limit?: number;
  sort: keyof WalletProfile;
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    sort: 'velocityScore',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--file':
        options.file = next;
        i++;
        break;
      case '--format':
        if (!next || !['html', 'csv', 'json', 'table'].includes(next)) {
          console.error('Error: --format must be html, csv, json, or table');
          process.exit(1);
        }
        options.format = next as 'html' | 'csv' | 'json' | 'table';
        i++;
        break;
      case '--limit':
        options.limit = parseInt(next, 10);
        if (isNaN(options.limit) || options.limit <= 0) {
          console.error('Error: --limit must be a positive number');
          process.exit(1);
        }
        i++;
        break;
      case '--sort':
        options.sort = next as keyof WalletProfile;
        i++;
        break;
      default:
        console.error(`Error: Unknown option ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

function formatNumber(num: number | null | undefined, decimals: number = 2): string {
  if (num === null || num === undefined) return 'N/A';
  return num.toFixed(decimals);
}

function formatLargeNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return 'N/A';
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
  return num.toFixed(0);
}

function formatDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return 'N/A';

  if (hours < 1) return `${(hours * 60).toFixed(0)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  if (days < 7) return `${days.toFixed(1)}d`;
  return `${(days / 7).toFixed(1)}w`;
}

function calculateActiveDays(firstTs: number | null, lastTs: number | null): number | null {
  if (!firstTs || !lastTs) return null;
  const diffSeconds = lastTs - firstTs;
  const diffDays = diffSeconds / (60 * 60 * 24);
  return Math.max(1, Math.ceil(diffDays));
}

function generateHtml(profiles: WalletProfile[]): string {
  const timestamp = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wallet Behavioral Profiles Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 20px;
            color: #333;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 700;
        }
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        .summary {
            padding: 30px 40px;
            background: #f8f9fa;
            border-bottom: 2px solid #e9ecef;
        }
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .stat-box {
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .stat-label {
            color: #6c757d;
            margin-top: 5px;
            font-size: 0.9em;
        }
        .profiles {
            padding: 20px;
        }
        .profile-card {
            background: white;
            margin: 20px;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            border-left: 5px solid #667eea;
            page-break-inside: avoid;
        }
        .profile-header {
            display: flex;
            align-items: center;
            margin-bottom: 25px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e9ecef;
        }
        .profile-emoji {
            font-size: 3em;
            margin-right: 20px;
        }
        .profile-title h2 {
            font-size: 1.8em;
            color: #2d3748;
            margin-bottom: 5px;
        }
        .profile-address {
            font-family: 'Courier New', monospace;
            color: #6c757d;
            font-size: 0.9em;
            word-break: break-all;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 25px;
            margin-top: 20px;
        }
        .metric-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
        }
        .metric-section h3 {
            color: #495057;
            font-size: 1.1em;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        .metric-section h3::before {
            content: '●';
            color: #667eea;
            margin-right: 10px;
            font-size: 1.2em;
        }
        .metric-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #dee2e6;
        }
        .metric-row:last-child {
            border-bottom: none;
        }
        .metric-label {
            color: #6c757d;
            font-size: 0.9em;
        }
        .metric-value {
            font-weight: 600;
            color: #2d3748;
        }
        .positive { color: #28a745; }
        .negative { color: #dc3545; }
        .footer {
            text-align: center;
            padding: 30px;
            color: #6c757d;
            font-size: 0.9em;
            background: #f8f9fa;
        }
        @media print {
            body { background: white; padding: 0; }
            .container { box-shadow: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Wallet Behavioral Profiles</h1>
            <p>Comprehensive trading behavior analysis</p>
            <p style="margin-top: 10px; font-size: 0.9em;">Generated: ${new Date(timestamp).toLocaleString()}</p>
        </div>

        <div class="summary">
            <h2>Report Summary</h2>
            <div class="summary-stats">
                <div class="stat-box">
                    <div class="stat-value">${profiles.length}</div>
                    <div class="stat-label">Total Wallets</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">${profiles.filter(p => p.velocityScore !== null && p.velocityScore >= 70).length}</div>
                    <div class="stat-label">High Velocity (≥70)</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">${profiles.filter(p => p.netPnl !== null && p.netPnl > 0).length}</div>
                    <div class="stat-label">Profitable</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">${formatNumber(profiles.reduce((sum, p) => sum + (p.uniqueTokensTraded || 0), 0) / profiles.length, 0)}</div>
                    <div class="stat-label">Avg Tokens Traded</div>
                </div>
            </div>
        </div>

        <div class="profiles">
${profiles.map((profile, idx) => `
            <div class="profile-card">
                <div class="profile-header">
                    <div class="profile-emoji">${profile.emoji || '📊'}</div>
                    <div class="profile-title">
                        <h2>${idx + 1}. ${profile.name}</h2>
                        <div class="profile-address">${profile.address}</div>
                    </div>
                </div>

                <div class="metrics-grid">
                    <div class="metric-section">
                        <h3>Trading Activity</h3>
                        <div class="metric-row">
                            <span class="metric-label">Unique Tokens Traded</span>
                            <span class="metric-value">${profile.uniqueTokensTraded}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Total Trades</span>
                            <span class="metric-value">${profile.totalTradeCount}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Avg Trades/Day</span>
                            <span class="metric-value">${formatNumber(profile.avgTradesPerDay, 1)}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Unique Tokens/Day</span>
                            <span class="metric-value">${formatNumber(profile.uniqueTokensPerDay, 2)}</span>
                        </div>
                    </div>

                    <div class="metric-section">
                        <h3>Holding Time</h3>
                        <div class="metric-row">
                            <span class="metric-label">Median Hold Time</span>
                            <span class="metric-value">${formatDuration(profile.medianHoldTimeHours)}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Completed Positions</span>
                            <span class="metric-value">${formatDuration(profile.medianCompletedHoldTimeHours)}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Flow Pattern</span>
                            <span class="metric-value">${profile.flowPattern || 'N/A'}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Speed Category</span>
                            <span class="metric-value">${profile.speedCategory || 'N/A'}</span>
                        </div>
                    </div>

                    <div class="metric-section">
                        <h3>Behavior Pattern</h3>
                        <div class="metric-row">
                            <span class="metric-label">Velocity Score</span>
                            <span class="metric-value">${profile.velocityScore !== null ? profile.velocityScore : 'N/A'}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Trading Style</span>
                            <span class="metric-value">${profile.tradingStyle}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Strategy Type</span>
                            <span class="metric-value">${profile.strategyType || 'N/A'}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Active Days</span>
                            <span class="metric-value">${profile.activeDays || 'N/A'}</span>
                        </div>
                    </div>

                    <div class="metric-section">
                        <h3>Activity Period</h3>
                        <div class="metric-row">
                            <span class="metric-label">First Trade</span>
                            <span class="metric-value">${profile.firstTransactionTimestamp ? new Date(profile.firstTransactionTimestamp * 1000).toLocaleDateString() : 'N/A'}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Last Trade</span>
                            <span class="metric-value">${profile.lastTransactionTimestamp ? new Date(profile.lastTransactionTimestamp * 1000).toLocaleDateString() : 'N/A'}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Time Range</span>
                            <span class="metric-value">${profile.firstTransactionTimestamp && profile.lastTransactionTimestamp ? new Date(profile.firstTransactionTimestamp * 1000).toLocaleDateString() + ' → ' + new Date(profile.lastTransactionTimestamp * 1000).toLocaleDateString() : 'N/A'}</span>
                        </div>
                    </div>

                    <div class="metric-section">
                        <h3>Session Metrics</h3>
                        <div class="metric-row">
                            <span class="metric-label">Session Count</span>
                            <span class="metric-value">${profile.sessionCount}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Avg Trades/Session</span>
                            <span class="metric-value">${formatNumber(profile.avgTradesPerSession, 1)}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Avg Session Duration</span>
                            <span class="metric-value">${formatDuration(profile.avgSessionDurationMinutes / 60)}</span>
                        </div>
                    </div>

                    <div class="metric-section">
                        <h3>Performance (PnL)</h3>
                        <div class="metric-row">
                            <span class="metric-label">Realized PnL</span>
                            <span class="metric-value ${(profile.realizedPnl || 0) > 0 ? 'positive' : 'negative'}">${formatNumber(profile.realizedPnl, 3)} SOL</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Unrealized PnL</span>
                            <span class="metric-value ${(profile.unrealizedPnl || 0) > 0 ? 'positive' : 'negative'}">${formatNumber(profile.unrealizedPnl, 3)} SOL</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Net PnL</span>
                            <span class="metric-value ${(profile.netPnl || 0) > 0 ? 'positive' : 'negative'}">${formatNumber(profile.netPnl, 3)} SOL</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Profitable Tokens</span>
                            <span class="metric-value positive">${profile.profitableTokensCount}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Unprofitable Tokens</span>
                            <span class="metric-value negative">${profile.unprofitableTokensCount}</span>
                        </div>
                    </div>
                </div>
            </div>
`).join('')}
        </div>

        <div class="footer">
            <p>Sova Intel - Wallet Behavioral Analysis System</p>
        </div>
    </div>
</body>
</html>`;
}

function generateCsv(profiles: WalletProfile[]): string {
  const headers = [
    'Name', 'Address', 'Unique Tokens', 'Total Trades', 'Avg Trades/Day', 'Unique Tokens/Day',
    'Median Hold Time (hrs)', 'Completed Hold (hrs)', 'Flow Pattern', 'Speed Category',
    'Velocity Score', 'Trading Style', 'Strategy Type', 'Sessions', 'Avg Trades/Session',
    'Avg Session Duration (min)', 'Realized PnL', 'Unrealized PnL', 'Net PnL',
    'Profitable Tokens', 'Unprofitable Tokens', 'Active Days',
  ];

  const rows = profiles.map(p => [
    `"${p.name}"`, p.address, p.uniqueTokensTraded, p.totalTradeCount,
    formatNumber(p.avgTradesPerDay, 2), formatNumber(p.uniqueTokensPerDay, 2),
    p.medianHoldTimeHours !== null ? formatNumber(p.medianHoldTimeHours, 2) : '',
    p.medianCompletedHoldTimeHours !== null ? formatNumber(p.medianCompletedHoldTimeHours, 2) : '',
    p.flowPattern || '', p.speedCategory || '', p.velocityScore !== null ? p.velocityScore : '',
    p.tradingStyle, p.strategyType || '', p.sessionCount, formatNumber(p.avgTradesPerSession, 2),
    formatNumber(p.avgSessionDurationMinutes, 2),
    p.realizedPnl !== null ? formatNumber(p.realizedPnl, 4) : '',
    p.unrealizedPnl !== null ? formatNumber(p.unrealizedPnl, 4) : '',
    p.netPnl !== null ? formatNumber(p.netPnl, 4) : '',
    p.profitableTokensCount, p.unprofitableTokensCount, p.activeDays !== null ? p.activeDays : '',
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

function printTableHeader(format: 'full' | 'compact') {
  console.log('\n' + chalk.bold.cyan('═'.repeat(160)));
  console.log(chalk.bold.white('WALLET BEHAVIORAL PROFILES'));
  console.log(chalk.bold.cyan('═'.repeat(160)) + '\n');
}

function printTableRow(profile: WalletProfile, format: 'full' | 'compact', index: number) {
  const emoji = profile.emoji || '📊';
  const shortAddr = `${profile.address.slice(0, 4)}...${profile.address.slice(-4)}`;

  if (format === 'compact') {
    // Compact single-line format
    const firstTrade = profile.firstTransactionTimestamp
      ? new Date(profile.firstTransactionTimestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'N/A';
    const lastTrade = profile.lastTransactionTimestamp
      ? new Date(profile.lastTransactionTimestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'N/A';

    console.log(
      chalk.yellow(`${(index + 1).toString().padStart(3)}. ${emoji} ${profile.name.padEnd(20)}`) +
      chalk.gray(` ${shortAddr}`) +
      chalk.white(` │ `) +
      chalk.cyan(`Tokens: ${profile.uniqueTokensTraded.toString().padStart(3)}`) +
      chalk.white(` │ `) +
      chalk.magenta(`Trades/Day: ${formatNumber(profile.avgTradesPerDay, 1).padStart(6)}`) +
      chalk.white(` │ `) +
      chalk.green(`Hold: ${formatDuration(profile.medianHoldTimeHours).padStart(6)}`) +
      chalk.white(` │ `) +
      chalk.blue(`Speed: ${(profile.speedCategory || 'N/A').padEnd(10)}`) +
      chalk.white(` │ `) +
      chalk.red(`V-Score: ${(profile.velocityScore?.toString() || 'N/A').padStart(3)}`) +
      chalk.white(` │ `) +
      chalk.gray(`${firstTrade} → ${lastTrade}`)
    );
  } else {
    // Full multi-line format
    console.log(chalk.bold.yellow(`${(index + 1).toString().padStart(3)}. ${emoji} ${profile.name}`));
    console.log(chalk.gray(`     Address: ${profile.address}`));
    console.log('');
    console.log(chalk.cyan(`     📈 Trading Activity:`));
    console.log(`        Unique Tokens Traded: ${chalk.white(profile.uniqueTokensTraded)}`);
    console.log(`        Total Trades: ${chalk.white(profile.totalTradeCount)}`);
    console.log(`        Avg Trades/Day: ${chalk.white(formatNumber(profile.avgTradesPerDay, 2))}`);
    console.log(`        Unique Tokens/Day: ${chalk.white(formatNumber(profile.uniqueTokensPerDay, 2))}`);
    console.log('');
    console.log(chalk.magenta(`     ⏱️  Holding Time:`));
    console.log(`        Median Hold Time: ${chalk.white(formatDuration(profile.medianHoldTimeHours))}`);
    console.log(`        Completed Positions Hold: ${chalk.white(formatDuration(profile.medianCompletedHoldTimeHours))}`);
    console.log(`        Current Holdings Duration: ${chalk.white(formatDuration(profile.medianCurrentHoldingDurationHours))}`);
    console.log('');
    console.log(chalk.blue(`     🎯 Behavior Patterns:`));
    console.log(`        Flow Pattern: ${chalk.white(profile.flowPattern || 'N/A')}`);
    console.log(`        Speed Category: ${chalk.white(profile.speedCategory || 'N/A')}`);
    console.log(`        Velocity Score: ${chalk.white(profile.velocityScore !== null ? profile.velocityScore : 'N/A')}`);
    console.log(`        Trading Style: ${chalk.white(profile.tradingStyle)}`);
    console.log(`        Strategy Type: ${chalk.white(profile.strategyType || 'N/A')}`);
    console.log('');
    console.log(chalk.green(`     📊 Session Metrics:`));
    console.log(`        Session Count: ${chalk.white(profile.sessionCount)}`);
    console.log(`        Avg Trades/Session: ${chalk.white(formatNumber(profile.avgTradesPerSession, 2))}`);
    console.log(`        Avg Session Duration: ${chalk.white(formatDuration(profile.avgSessionDurationMinutes / 60))}`);
    console.log('');
    console.log(chalk.yellow(`     💰 P&L Summary:`));
    console.log(`        Realized PnL: ${chalk.white(formatNumber(profile.realizedPnl, 4))} SOL`);
    console.log(`        Unrealized PnL: ${chalk.white(formatNumber(profile.unrealizedPnl, 4))} SOL`);
    console.log(`        Net PnL: ${chalk.white(formatNumber(profile.netPnl, 4))} SOL`);
    console.log(`        Profitable Tokens: ${chalk.white(profile.profitableTokensCount)}`);
    console.log(`        Unprofitable Tokens: ${chalk.white(profile.unprofitableTokensCount)}`);
    console.log('');
    console.log(chalk.gray(`     📅 Activity Period:`));
    console.log(`        Active Days: ${chalk.white(profile.activeDays || 'N/A')}`);
    console.log('');
    console.log(chalk.gray('─'.repeat(160)));
    console.log('');
  }
}

function printJson(profiles: WalletProfile[]) {
  console.log(JSON.stringify(profiles, null, 2));
}

function printCsv(profiles: WalletProfile[]) {
  // CSV Headers
  const headers = [
    'Name',
    'Address',
    'Emoji',
    'Unique Tokens',
    'Total Trades',
    'Avg Trades/Day',
    'Unique Tokens/Day',
    'Median Hold Time (hrs)',
    'Completed Hold Time (hrs)',
    'Current Holdings Duration (hrs)',
    'Flow Pattern',
    'Speed Category',
    'Velocity Score',
    'Trading Style',
    'Strategy Type',
    'Session Count',
    'Avg Trades/Session',
    'Avg Session Duration (min)',
    'Realized PnL (SOL)',
    'Unrealized PnL (SOL)',
    'Net PnL (SOL)',
    'Profitable Tokens',
    'Unprofitable Tokens',
    'Active Days',
  ];

  console.log(headers.join(','));

  profiles.forEach(profile => {
    const row = [
      `"${profile.name}"`,
      profile.address,
      profile.emoji || '',
      profile.uniqueTokensTraded,
      profile.totalTradeCount,
      formatNumber(profile.avgTradesPerDay, 2),
      formatNumber(profile.uniqueTokensPerDay, 2),
      profile.medianHoldTimeHours !== null ? formatNumber(profile.medianHoldTimeHours, 2) : '',
      profile.medianCompletedHoldTimeHours !== null ? formatNumber(profile.medianCompletedHoldTimeHours, 2) : '',
      profile.medianCurrentHoldingDurationHours !== null ? formatNumber(profile.medianCurrentHoldingDurationHours, 2) : '',
      profile.flowPattern || '',
      profile.speedCategory || '',
      profile.velocityScore !== null ? profile.velocityScore : '',
      profile.tradingStyle,
      profile.strategyType || '',
      profile.sessionCount,
      formatNumber(profile.avgTradesPerSession, 2),
      formatNumber(profile.avgSessionDurationMinutes, 2),
      profile.realizedPnl !== null ? formatNumber(profile.realizedPnl, 4) : '',
      profile.unrealizedPnl !== null ? formatNumber(profile.unrealizedPnl, 4) : '',
      profile.netPnl !== null ? formatNumber(profile.netPnl, 4) : '',
      profile.profitableTokensCount,
      profile.unprofitableTokensCount,
      profile.activeDays !== null ? profile.activeDays : '',
    ];

    console.log(row.join(','));
  });
}

async function main() {
  const options = parseArgs();
  const prisma = new PrismaClient();

  try {
    console.log(chalk.bold.blue('📊 Fetching wallet profiles from database...'));
    console.log(chalk.gray(`User ID: ${USER_ID}\n`));

    // Fetch all favorite wallets for the user with their behavioral data
    const favorites = await prisma.userFavoriteWallet.findMany({
      where: { userId: USER_ID },
      include: {
        wallet: {
          include: {
            behaviorProfile: true,
            pnlSummary: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(chalk.green(`✓ Found ${favorites.length} favorite wallets\n`));

    if (favorites.length === 0) {
      console.log(chalk.yellow('No favorite wallets found for this user.'));
      return;
    }

    // Build profiles
    const profiles: WalletProfile[] = favorites
      .map(fav => {
        const behavior = fav.wallet.behaviorProfile;
        const pnl = fav.wallet.pnlSummary;
        const metadata = fav.metadata as any;

        if (!behavior) {
          return null; // Skip wallets without behavior analysis
        }

        const activeDays = calculateActiveDays(
          behavior.firstTransactionTimestamp,
          behavior.lastTransactionTimestamp
        );

        const uniqueTokensPerDay = activeDays && activeDays > 0
          ? behavior.uniqueTokensTraded / activeDays
          : 0;

        const profile: WalletProfile = {
          name: fav.nickname || `Wallet ${fav.walletAddress.slice(0, 8)}`,
          address: fav.walletAddress,
          emoji: metadata?.emoji,

          uniqueTokensTraded: behavior.uniqueTokensTraded,
          totalTradeCount: behavior.totalTradeCount,
          avgTradesPerDay: (behavior.tradingFrequency as any)?.tradesPerDay || 0,
          uniqueTokensPerDay,

          medianHoldTimeHours: behavior.medianHoldTime,
          medianCompletedHoldTimeHours: behavior.medianCompletedHoldTimeHours,
          medianCurrentHoldingDurationHours: behavior.medianCurrentHoldingDurationHours,
          holdingTimeCategory: formatDuration(behavior.medianHoldTime),

          flowPattern: behavior.flowPattern,
          speedCategory: behavior.speedCategory,
          velocityScore: behavior.velocityScore,

          sessionCount: behavior.sessionCount,
          avgTradesPerSession: behavior.avgTradesPerSession,
          avgSessionDurationMinutes: behavior.averageSessionDurationMinutes,

          tradingStyle: behavior.tradingStyle,
          strategyType: behavior.strategyType,

          realizedPnl: pnl?.realizedPnl || null,
          unrealizedPnl: pnl?.unrealizedPnl || null,
          netPnl: pnl?.netPnl || null,
          profitableTokensCount: pnl?.profitableTokensCount || 0,
          unprofitableTokensCount: pnl?.unprofitableTokensCount || 0,

          firstTransactionTimestamp: behavior.firstTransactionTimestamp,
          lastTransactionTimestamp: behavior.lastTransactionTimestamp,
          activeDays,
        };

        return profile;
      })
      .filter((p): p is WalletProfile => p !== null);

    // Sort profiles
    profiles.sort((a, b) => {
      const aVal = a[options.sort];
      const bVal = b[options.sort];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return bVal - aVal; // Descending
      }

      return String(bVal).localeCompare(String(aVal));
    });

    // Apply limit if specified
    const limitedProfiles = options.limit
      ? profiles.slice(0, options.limit)
      : profiles;

    // Determine output format and content
    let outputFormat = options.format;
    if (!outputFormat) {
      outputFormat = options.file ? 'html' : 'table';
    }

    // Generate output content
    let outputContent: string | undefined;

    if (outputFormat === 'html') {
      outputContent = generateHtml(limitedProfiles);
    } else if (outputFormat === 'csv') {
      outputContent = generateCsv(limitedProfiles);
    } else if (outputFormat === 'json') {
      outputContent = JSON.stringify(limitedProfiles, null, 2);
    }

    // Save to file or print to console
    if (options.file) {
      if (!outputContent) {
        console.error(chalk.red('Error: Cannot save table format to file. Use --format html, csv, or json'));
        process.exit(1);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const outputPath = path.resolve(options.file);

      fs.writeFileSync(outputPath, outputContent, 'utf-8');

      console.log(chalk.green('\n✅ Report generated successfully!'));
      console.log(chalk.cyan(`📄 Output file: ${outputPath}`));
      console.log(chalk.cyan(`📊 Total profiles: ${limitedProfiles.length}`));
      console.log(chalk.cyan(`📏 Format: ${outputFormat.toUpperCase()}\n`));
    } else {
      // Print to console
      if (outputFormat === 'json' && outputContent) {
        console.log(outputContent);
      } else if (outputFormat === 'csv' && outputContent) {
        console.log(outputContent);
      } else {
        printTableHeader('compact');
        limitedProfiles.forEach((profile, index) => {
          printTableRow(profile, 'compact', index);
        });

        console.log('\n' + chalk.bold.cyan('═'.repeat(160)));
        console.log(chalk.bold.white(`Total Profiles: ${limitedProfiles.length}`));
        console.log(chalk.bold.cyan('═'.repeat(160)) + '\n');
        console.log(chalk.yellow('💡 Tip: Use --file report.html to save as a shareable HTML file\n'));
      }

      console.log(chalk.green('✅ Profile generation complete!\n'));
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${getErrorMessage(error)}`));
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
