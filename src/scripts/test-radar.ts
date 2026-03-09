#!/usr/bin/env ts-node
/**
 * test-radar.ts — Holdings Radar end-to-end flow
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-radar.ts
 *
 * Env vars (optional — prompted if not set):
 *   API_URL        defaults to http://localhost:3001
 *   TEST_EMAIL
 *   TEST_PASSWORD
 *   TEST_WALLET    Solana address to add to radar
 */

import * as readline from 'readline';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API  = `${BASE}/api/v1`;

// ─── helpers ────────────────────────────────────────────────────────────────

function ask(q: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(q);
      let buf = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (ch: string) => {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.setRawMode(false); process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n'); rl.close(); resolve(buf);
        } else if (ch === '\u0003') { process.exit(); }
        else if (ch === '\u007F') { if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } }
        else { buf += ch; process.stdout.write('*'); }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(q, a => { rl.close(); resolve(a.trim()); });
    }
  });
}

type R = { status: number; data: any; ms: number };

async function call(
  method: string,
  path: string,
  token?: string,
  body?: any,
): Promise<R> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const t = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Date.now() - t;
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, ms };
}

function ok(label: string, r: R, expectStatus = 200) {
  const pass = r.status === expectStatus;
  const icon = pass ? '✅' : '❌';
  console.log(`\n${icon}  ${label} — HTTP ${r.status} (${r.ms}ms)`);
  console.log(JSON.stringify(r.data, null, 2));
  if (!pass) {
    console.error(`   Expected ${expectStatus}, got ${r.status}`);
  }
  return pass;
}

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍  Holdings Radar — E2E test');
  console.log(`   Target: ${API}\n`);

  // ── credentials ──
  const email    = process.env.TEST_EMAIL    ?? await ask('Email:    ');
  const password = process.env.TEST_PASSWORD ?? await ask('Password: ', true);

  // ── 1. login ──
  section('1 / LOGIN');
  const loginR = await call('POST', '/auth/login', undefined, { email, password });
  if (!ok('POST /auth/login', loginR)) process.exit(1);

  const token      = loginR.data.access_token as string;
  const user       = loginR.data.user;
  console.log(`\n   Logged in as: ${user.email}`);
  console.log(`   isAdmin:      ${user.isAdmin}`);
  console.log(`   isAnalyst:    ${user.isAnalyst}`);

  if (!user.isAdmin && !user.isAnalyst) {
    console.error('\n⛔  This user has neither isAdmin nor isAnalyst — radar endpoints will return 403.');
    console.error('   Run this SQL first:');
    console.error(`   UPDATE "User" SET "isAnalyst" = true WHERE email = '${email}';\n`);
    process.exit(1);
  }

  // ── 2. /auth/me — verify isAnalyst is in profile ──
  section('2 / AUTH/ME — verify isAnalyst in profile');
  const meR = await call('GET', '/auth/me', token);
  ok('GET /auth/me', meR);

  // ── 3. wallet to add ──
  const wallet = process.env.TEST_WALLET ?? await ask('\nSolana wallet address to track: ');

  // ── 4. list existing radar wallets ──
  section('3 / LIST RADAR WALLETS (before add)');
  const listR = await call('GET', '/analyst/radar', token);
  ok('GET /analyst/radar', listR);

  // ── 5. add wallet ──
  section('4 / ADD WALLET');
  const addR = await call('POST', '/analyst/radar', token, { address: wallet, label: 'test-radar' });
  ok('POST /analyst/radar', addR, 201);

  // ── 6. list again — should appear ──
  section('5 / LIST RADAR WALLETS (after add)');
  const list2R = await call('GET', '/analyst/radar', token);
  ok('GET /analyst/radar', list2R);

  // ── 7. trigger snapshot ──
  section('6 / TRIGGER SNAPSHOT');
  console.log('   Fetching balances via BalanceCacheService — may take a few seconds...');
  const snapR = await call('POST', `/analyst/radar/${wallet}/snapshot`, token);
  ok(`POST /analyst/radar/${wallet}/snapshot`, snapR, 201);
  if (snapR.data) {
    console.log(`\n   New tokens:         ${snapR.data.newTokens}`);
    console.log(`   Updated tokens:     ${snapR.data.updatedTokens}`);
    console.log(`   Deactivated tokens: ${snapR.data.deactivatedTokens}`);
  }

  // ── 8. holdings for this wallet ──
  section('7 / HOLDINGS FOR WALLET');
  const holdingsR = await call('GET', `/analyst/radar/${wallet}/holdings`, token);
  ok(`GET /analyst/radar/${wallet}/holdings`, holdingsR);
  const holdings: any[] = holdingsR.data ?? [];
  console.log(`\n   Total active holdings: ${holdings.length}`);
  if (holdings.length > 0) {
    console.log('   First 3:');
    holdings.slice(0, 3).forEach((h, i) => {
      console.log(`     [${i + 1}] mint=${h.tokenMint}  balance=${h.uiBalance}  usd=${h.usdValue ?? 'n/a'}  status=${h.reviewStatus}`);
    });
  }

  // ── 9. feed ──
  section('8 / FEED (unreviewed first)');
  const feedR = await call('GET', '/analyst/radar/feed', token);
  ok('GET /analyst/radar/feed', feedR);
  const feed: any[] = feedR.data ?? [];
  console.log(`\n   Feed entries: ${feed.length}`);
  if (feed.length > 0) {
    console.log('   First 3:');
    feed.slice(0, 3).forEach((h, i) => {
      console.log(`     [${i + 1}] wallet=${h.wallet.slice(0, 8)}...  mint=${h.tokenMint}  status=${h.reviewStatus}  firstSeenAt=${h.firstSeenAt}`);
    });
  }

  // ── 10. mark first feed item as reviewed (if any) ──
  if (feed.length > 0) {
    section('9 / MARK FIRST FEED ITEM AS REVIEWED');
    const holdingId = feed[0].id;
    const reviewR = await call('PATCH', `/analyst/radar/holdings/${holdingId}/review`, token, { status: 'reviewed' });
    ok(`PATCH /analyst/radar/holdings/${holdingId}/review`, reviewR);
    console.log(`\n   reviewStatus is now: ${reviewR.data?.reviewStatus}`);
    console.log(`   reviewedAt:          ${reviewR.data?.reviewedAt}`);

    // ── 11. feed again — reviewed item should move after unreviewed ──
    section('10 / FEED AFTER REVIEW (reviewed item should sort after unreviewed)');
    const feed2R = await call('GET', '/analyst/radar/feed', token);
    ok('GET /analyst/radar/feed', feed2R);
    const feed2: any[] = feed2R.data ?? [];
    const firstStatus = feed2[0]?.reviewStatus;
    const reviewedMoved = feed2.findIndex((h: any) => h.id === holdingId);
    console.log(`\n   First item status: ${firstStatus}`);
    console.log(`   Reviewed item position: ${reviewedMoved === -1 ? 'not found' : reviewedMoved + 1} of ${feed2.length}`);
  }

  // ── 12. delete wallet ──
  section('11 / DELETE WALLET (soft deactivate)');
  const delR = await call('DELETE', `/analyst/radar/${wallet}`, token);
  ok(`DELETE /analyst/radar/${wallet}`, delR, 204);

  // ── 13. list — should be gone ──
  section('12 / LIST AFTER DELETE (wallet should not appear)');
  const list3R = await call('GET', '/analyst/radar', token);
  ok('GET /analyst/radar', list3R);
  const stillThere = (list3R.data ?? []).find((w: any) => w.wallet === wallet);
  console.log(`\n   Wallet still in active list: ${stillThere ? '❌ YES (bug)' : '✅ NO (correct)'}`);

  // ── summary ──
  section('DONE');
  console.log('\n  Full radar flow completed.\n');
}

main().catch(err => {
  console.error('\n💥 Unexpected error:', err);
  process.exit(1);
});
