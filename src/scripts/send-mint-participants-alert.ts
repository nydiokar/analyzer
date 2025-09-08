#!/usr/bin/env node

import dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { TelegramAlertsService } from '../api/services/telegram-alerts.service';

dotenv.config();

interface Row {
  wallet: string;
  mint: string;
  buyTs: number;
  accountAgeDays?: number | null;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('mint', { type: 'string', demandOption: true, desc: 'Token mint to alert about' })
    .option('file', { type: 'string', default: 'analyses/mint_participants/index.jsonl', desc: 'Input JSONL file' })
    .option('limit', { type: 'number', default: 20, desc: 'Max wallets to include' })
    .option('ageMaxDays', { type: 'number', desc: 'Include wallets with accountAgeDays <= this' })
    .strict()
    .parseAsync();

  const file: string = argv.file as string;
  const mint: string = argv.mint as string;
  const limit: number = Number(argv.limit ?? 20);
  const ageMaxDays: number | undefined = (argv.ageMaxDays as number | undefined);

  if (!fs.existsSync(file)) {
    console.error(`Input not found: ${file}`);
    process.exit(1);
  }

  const rows: Row[] = [];
  const data = fs.readFileSync(file, 'utf8');
  for (const line of data.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.mint === mint && typeof o.wallet === 'string' && typeof o.buyTs === 'number') {
        rows.push({
          wallet: o.wallet,
          mint: o.mint,
          buyTs: o.buyTs,
          accountAgeDays: (typeof o.accountAgeDays === 'number') ? o.accountAgeDays : undefined,
        });
      }
    } catch {}
  }

  if (rows.length === 0) {
    console.error(`No rows found for mint ${mint} in ${file}`);
    process.exit(2);
  }

  rows.sort((a, b) => b.buyTs - a.buyTs);
  const filtered = (typeof ageMaxDays === 'number')
    ? rows.filter(r => typeof r.accountAgeDays === 'number' && (r.accountAgeDays as number) <= ageMaxDays)
    : rows;
  const top = filtered.slice(0, limit);

  const nowIso = new Date().toISOString();
  const MAX_LINES = 50;
  const listArr = top.map(w => {
    const age = w.accountAgeDays == null ? '?' : `${w.accountAgeDays}`;
    const addr = `<code>${w.wallet}</code>`;
    return `• ${addr} (<b>${age}d</b>)`;
  });
  const list = listArr.slice(0, MAX_LINES).join('\n') + (listArr.length > MAX_LINES ? `\n…and ${listArr.length - MAX_LINES} more` : '');
  const cohort = (typeof ageMaxDays === 'number') ? `≤${ageMaxDays}d` : 'all ages';
  const header = `<b>Chen Group alert</b> • <b>${top.length}</b> wallet(s) ${cohort}\n<code>${mint}</code>\nfrom: <code>${file}</code>\nwhen: ${nowIso}`;
  const text = `${header}\n\n${list}`;

  const config = new ConfigService();
  const telegram = new TelegramAlertsService(config);
  await telegram.broadcast(text, { html: true });

  console.log(`Sent alert for mint ${mint} with ${top.length} wallet(s).`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});


