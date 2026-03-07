#!/usr/bin/env ts-node
/**
 * test-pay8.ts — PAY-8 synchronous cold-wallet resolution test
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-pay8.ts
 *
 * Env vars (all optional — prompted if missing):
 *   API_URL        defaults to http://localhost:3001
 *   TEST_EMAIL
 *   TEST_PASSWORD
 *   WARM_WALLET    wallet with fresh analysis in DB
 *   COLD_WALLET    wallet with NO data in DB
 *   COLD_WALLET_2  optional second cold wallet for dedup test
 */

import * as readline from 'readline';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API  = `${BASE}/api/v1`;

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

async function GET(path: string, token?: string, headers: Record<string,string> = {}): Promise<R> {
  const h: Record<string,string> = { 'Content-Type': 'application/json', ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const t = Date.now();
  const res = await fetch(`${API}${path}`, { headers: h });
  const ms = Date.now() - t;
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, ms };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function bal(token: string, waitMs = 0): Promise<number> {
  if (waitMs) await sleep(waitMs);
  const r = await GET('/users/me/credits', token);
  return r.data?.balance ?? r.data?.credits ?? 0;
}

async function pollJob(jobId: string, token: string): Promise<boolean> {
  process.stdout.write(`    polling ${jobId}`);
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const r = await GET(`/jobs/${jobId}`, token);
    const s: string = r.data?.status ?? '';
    process.stdout.write(` [${s}]`);
    if (s === 'completed' || r.status === 404) { process.stdout.write('\n'); return true; }
    if (s === 'failed') { process.stdout.write('\n'); return false; }
  }
  process.stdout.write(' [timeout]\n'); return false;
}

let ok = 0, bad = 0;
const eq  = (lbl: string, a: any, b: any)                  => a === b       ? (ok++, console.log(`  ✅ ${lbl} (${a})`))           : (bad++, console.error(`  ❌ ${lbl} — expected ${b}, got ${a}`));
const rng = (lbl: string, v: number, lo: number, hi: number) => v>=lo && v<=hi ? (ok++, console.log(`  ✅ ${lbl} (${v}ms)`))         : (bad++, console.error(`  ❌ ${lbl} — ${v}ms not in [${lo}–${hi}]`));
const chk = (lbl: string, v: boolean, note = '')            => v             ? (ok++, console.log(`  ✅ ${lbl}${note?' ('+note+')':''}`)) : (bad++, console.error(`  ❌ ${lbl}${note?' — '+note:''}`));
const hr  = (t: string) => console.log(`\n${'─'.repeat(68)}\n  ${t}\n${'─'.repeat(68)}`);

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          PAY-8 Synchronous Cold-Wallet Resolution Test           ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${API}\n`);

  const email    = process.env.TEST_EMAIL    ?? await ask('Email: ');
  const password = process.env.TEST_PASSWORD ?? await ask('Password: ', true);

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginData: any = await loginRes.json();
  if (!loginRes.ok) { console.error('❌ Login failed:', loginData); process.exit(1); }
  const token = loginData.access_token as string;
  console.log(`✅  Logged in as: ${loginData.user?.email ?? email}`);

  const warmWallet  = process.env.WARM_WALLET   ?? await ask('Warm wallet: ');
  const coldWallet  = process.env.COLD_WALLET   ?? await ask('Cold wallet: ');
  const coldWallet2 = process.env.COLD_WALLET_2 ?? '';

  const balStart = await bal(token);
  console.log(`\nStarting balance: ${balStart} cr`);

  // ── 1. 402 gate ─────────────────────────────────────────────────────────────
  hr('1. 402 gate — unauthenticated');
  eq('/intel/wallet no auth → 402',     (await GET(`/intel/wallet/${warmWallet}`)).status,     402);
  eq('/intel/wallet/hud no auth → 402', (await GET(`/intel/wallet/${warmWallet}/hud`)).status, 402);

  // ── 2. Warm /intel/wallet ────────────────────────────────────────────────────
  hr('2. Warm — /intel/wallet/:addr (5cr)');
  const b2 = await bal(token);
  const w2 = await GET(`/intel/wallet/${warmWallet}`, token);
  console.log(`  status=${w2.status}  time=${w2.ms}ms`);
  eq('→ 200', w2.status, 200);
  eq('body.status = "ok"', w2.data?.status, 'ok');
  chk('summary present', !!w2.data?.summary);
  rng('< 2000ms (DB only, no analysis)', w2.ms, 0, 2000);
  eq('5cr deducted', b2 - await bal(token, 900), 5);

  // ── 3. Warm /hud ─────────────────────────────────────────────────────────────
  hr('3. Warm — /intel/wallet/:addr/hud (1cr)');
  const b3 = await bal(token);
  const w3 = await GET(`/intel/wallet/${warmWallet}/hud`, token);
  console.log(`  status=${w3.status}  time=${w3.ms}ms`);
  eq('→ 200', w3.status, 200);
  rng('< 2000ms', w3.ms, 0, 2000);
  eq('1cr deducted', b3 - await bal(token, 900), 1);

  // ── 4. Cold /intel/wallet — synchronous hold ─────────────────────────────────
  hr('4. Cold — /intel/wallet/:addr synchronous hold (5cr)');
  console.log(`  Wallet: ${coldWallet}`);
  console.log('  Holding connection up to 30s...');
  const b4 = await bal(token);
  const c4 = await GET(`/intel/wallet/${coldWallet}`, token);
  console.log(`  status=${c4.status}  time=${c4.ms}ms  body.status=${c4.data?.status}`);

  let prepaid4: string | null = null;

  if (c4.status === 200 && c4.data?.status === 'ok') {
    chk('→ 200 directly (synchronous hold worked)', true);
    rng('time shows real work (500ms–35s)', c4.ms, 500, 35000);
    chk('summary present', !!c4.data?.summary);
    chk('hud field present', 'hud' in c4.data);
    eq('5cr — single charge', b4 - await bal(token, 900), 5);

  } else if (c4.status === 202) {
    prepaid4 = c4.data?.prepaidJobId ?? null;
    chk('202 has prepaidJobId', !!prepaid4, prepaid4 ?? 'MISSING');
    chk('202 has monitoringUrl', !!c4.data?.monitoringUrl);
    eq('0cr on 202', b4 - await bal(token, 400), 0);
    console.log('  Job >30s — polling then re-calling with prepaid header...');
    if (prepaid4 && await pollJob(c4.data.jobId, token)) {
      const rc = await GET(`/intel/wallet/${coldWallet}`, token, { 'X-Prepaid-Job-Id': prepaid4 });
      console.log(`  re-call: status=${rc.status}  time=${rc.ms}ms`);
      eq('prepaid re-call → 200', rc.status, 200);
      eq('body.status = "ok"', rc.data?.status, 'ok');
      eq('5cr total across both calls', b4 - await bal(token, 900), 5);
    } else {
      bad++; console.error('  ❌ job failed/timed out');
    }
  } else {
    bad++; console.error(`  ❌ unexpected status=${c4.status}`);
  }

  // ── 5. Same cold wallet now warm — /hud instant ──────────────────────────────
  hr('5. Post-analysis /hud — coldWallet now in DB (1cr)');
  const b5 = await bal(token);
  const w5 = await GET(`/intel/wallet/${coldWallet}/hud`, token);
  console.log(`  status=${w5.status}  time=${w5.ms}ms`);
  eq('→ 200', w5.status, 200);
  rng('served from DB < 1000ms', w5.ms, 0, 1000);
  eq('1cr deducted', b5 - await bal(token, 900), 1);

  // ── 6. Dedup — two concurrent requests ──────────────────────────────────────
  hr('6. Dedup — two concurrent /hud requests (needs COLD_WALLET_2)');
  if (!coldWallet2) {
    console.log('  ⊘  Skipped — set COLD_WALLET_2 to run');
  } else {
    console.log(`  Wallet: ${coldWallet2}`);
    const b6 = await bal(token);
    const [r6a, r6b] = await Promise.all([
      GET(`/intel/wallet/${coldWallet2}/hud`, token),
      GET(`/intel/wallet/${coldWallet2}/hud`, token),
    ]);
    console.log(`  A: status=${r6a.status}  time=${r6a.ms}ms`);
    console.log(`  B: status=${r6b.status}  time=${r6b.ms}ms`);
    chk('both 200 or 202', (r6a.status === 200 || r6a.status === 202) && (r6b.status === 200 || r6b.status === 202));
    if (r6a.status === 200 && r6b.status === 200) {
      eq('2cr total', b6 - await bal(token, 900), 2);
      chk('identical responses (same job served both)', JSON.stringify(r6a.data) === JSON.stringify(r6b.data));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const balEnd = await bal(token, 300);
  console.log(`\n${'═'.repeat(68)}`);
  console.log(`  Balance: ${balStart} cr → ${balEnd} cr  (spent ${balStart - balEnd} cr)`);
  console.log(`  Results: ${ok} passed, ${bad} failed`);
  console.log('═'.repeat(68));
  if (bad > 0) { console.error('\n❌  Some tests failed.\n'); process.exit(1); }
  else { console.log('\n✅  All tests passed.\n'); }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
