#!/usr/bin/env node
/*
 * PnL usage audit script.
 * Scans for PnL-related fields and flags potentially incorrect usage.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'dashboard'];
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.git',
  'logs',
]);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const TOKENS = [
  'netSolProfitLoss',
  'totalPnlSol',
  'realizedPnlSol',
  'unrealizedPnlSol',
  'realizedPnl',
  'unrealizedPnl',
  'netPnl',
  'totalSolSpent',
  'totalSolReceived',
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile()) {
      if (EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  }
  return files;
}

function classify(line) {
  const text = line.trim();
  if (/totalPnlSol\s*\?\?\s*netSolProfitLoss/.test(text)) return 'fallback-totalPnlSol';
  if (/netSolProfitLoss\s*\?\?/.test(text)) return 'null-coalesce';
  if (/netSolProfitLoss\s*\|\|\s*0/.test(text)) return 'zero-coalesce';
  if (/orderBy\.|sort\(|sortOrder|sortBy/.test(text)) return 'sorting';
  if (/filter\(|where\./.test(text)) return 'filtering';
  if (/reduce\(|sum|aggregate/.test(text)) return 'aggregation';
  return 'direct';
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TOKENS.some(token => line.includes(token))) {
      const tokenHits = TOKENS.filter(token => line.includes(token));
      matches.push({
        filePath,
        lineNumber: i + 1,
        line,
        tokens: tokenHits,
        category: classify(line),
      });
    }
  }

  return matches;
}

function main() {
  const allFiles = TARGET_DIRS.flatMap(dir => walk(path.join(ROOT, dir)));
  const matches = allFiles.flatMap(scanFile);

  const byToken = new Map();
  for (const token of TOKENS) byToken.set(token, []);
  for (const match of matches) {
    for (const token of match.tokens) {
      byToken.get(token).push(match);
    }
  }

  console.log('PnL Usage Audit');
  console.log('===============');
  console.log(`Scanned files: ${allFiles.length}`);
  console.log(`Matches: ${matches.length}`);
  console.log('');

  const risky = matches.filter(m => m.tokens.includes('netSolProfitLoss') && (m.category === 'direct' || m.category === 'sorting' || m.category === 'filtering' || m.category === 'aggregation' || m.category === 'zero-coalesce'));
  console.log(`Potentially risky netSolProfitLoss usage: ${risky.length}`);
  console.log('');

  function printSection(title, items) {
    console.log(title);
    console.log('-'.repeat(title.length));
    if (items.length === 0) {
      console.log('  (none)');
      console.log('');
      return;
    }
    for (const item of items) {
      const rel = path.relative(ROOT, item.filePath);
      const tokens = item.tokens.join(', ');
      const snippet = item.line.trim();
      console.log(`  ${rel}:${item.lineNumber} [${item.category}] (${tokens})`);
      console.log(`    ${snippet}`);
    }
    console.log('');
  }

  printSection('Risky netSolProfitLoss usage (review for FIFO correctness)', risky);

  printSection('Fallback usage (totalPnlSol ?? netSolProfitLoss)', matches.filter(m => m.category === 'fallback-totalPnlSol'));

  printSection('FIFO fields usage (realizedPnlSol/unrealizedPnlSol/totalPnlSol)', matches.filter(m => m.tokens.some(t => ['realizedPnlSol', 'unrealizedPnlSol', 'totalPnlSol'].includes(t))));

  printSection('Wallet summary fields usage (realizedPnl/unrealizedPnl/netPnl)', matches.filter(m => m.tokens.some(t => ['realizedPnl', 'unrealizedPnl', 'netPnl'].includes(t))));
}

main();
