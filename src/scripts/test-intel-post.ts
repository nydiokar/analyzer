/**
 * test-intel-post.ts
 *
 * Tests the two POST Intel endpoints:
 *   POST /intel/token/:mint/holders  (35cr)
 *   POST /intel/wallets/batch-hud    (5cr)
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-intel-post.ts
 */

import * as readline from 'readline';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API  = `${BASE}/api/v1`;

function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
      let buf = '';
      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write('\n'); rl.close(); resolve(buf);
        } else if (ch === '\u0003') { process.exit(); }
        else if (ch === '\u007F' || ch === '\b') { if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } }
        else { buf += ch; process.stdout.write('*'); }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
    }
  });
}

async function req(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /**/ }
  return { status: res.status, data };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function pollUntilDone(jobId: string, token: string): Promise<'completed' | 'failed'> {
  process.stdout.write(`  ⏳ Polling job ${jobId.slice(0, 40)}...`);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const r = await req('GET', `/jobs/${jobId}`, token);
    if (r.status === 404) { process.stdout.write(' [not found — assumed complete]\n'); return 'completed'; }
    const st: string = r.data?.status ?? '';
    process.stdout.write(` [${st}]`);
    if (st === 'completed') { process.stdout.write('\n'); return 'completed'; }
    if (st === 'failed')    { process.stdout.write('\n'); return 'failed'; }
  }
  process.stdout.write(' [timeout]\n');
  return 'failed';
}

function section(t: string) {
  console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);
}

function show(status: number, data: any) {
  console.log(`${status >= 200 && status < 300 ? '✅' : status === 402 ? '🔒' : '❌'}  HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      Intel POST Endpoints — Focused Integration Test        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Login
  const email    = await prompt('Email: ');
  const password = await prompt('Password: ', true);
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginData: any = await loginRes.json();
  if (!loginRes.ok) { console.error('Login failed:', loginData); process.exit(1); }
  const token = loginData.access_token as string;
  console.log(`\n✅ Logged in as: ${loginData.user?.email ?? email}`);

  // Balance
  const b0 = await req('GET', '/users/me/credits', token);
  const balBefore: number = b0.data?.balance ?? 0;
  console.log(`💳 Balance: ${balBefore} cr`);

  // Inputs
  const mint         = await prompt('\nToken mint for POST /intel/token/:mint/holders (Enter to skip): ');
  const walletsInput = await prompt('Wallet addresses for POST /intel/wallets/batch-hud, comma-separated: ');
  const wallets      = walletsInput.split(',').map(w => w.trim()).filter(Boolean);

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST A — POST /intel/token/:mint/holders
  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST A — POST /intel/token/:mint/holders  (35cr)');

  if (!mint) {
    console.log('  ⊘  Skipped — no mint provided');
  } else {
    console.log(`  mint: ${mint}  topN: 5\n`);
    const rA = await req('POST', `/intel/token/${mint}/holders`, token, { topN: 5 });
    show(rA.status, rA.data);

    if (rA.status === 202 && rA.data?.jobId) {
      const outcome = await pollUntilDone(rA.data.jobId, token);
      if (outcome === 'completed') {
        console.log('\n  → Fetching job result...');
        const resultA = await req('GET', `/jobs/${rA.data.jobId}/result`, token);
        show(resultA.status, resultA.data);
        const profiles = resultA.data?.result?.profiles;
        if (profiles?.length) {
          console.log(`\n  → Got ${profiles.length} holder profile(s). First:`);
          const p = profiles[0];
          console.log(JSON.stringify({
            walletAddress: p.walletAddress,
            rank: p.rank,
            supplyPercent: p.supplyPercent,
            behaviorType: p.behaviorType,
            medianHoldTimeHours: p.medianHoldTimeHours,
            walletPnlSol: p.walletPnlSol,
            dataQualityTier: p.dataQualityTier,
          }, null, 2));
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST B — POST /intel/wallets/batch-hud
  // ═══════════════════════════════════════════════════════════════════════════
  section(`TEST B — POST /intel/wallets/batch-hud  (5cr)  — ${wallets.length} wallet(s)`);

  if (wallets.length === 0) {
    console.log('  ⊘  Skipped — no wallets provided');
  } else {
    console.log(`  wallets: ${wallets.join(', ')}\n`);
    const rB1 = await req('POST', '/intel/wallets/batch-hud', token, { wallets });
    show(rB1.status, rB1.data);

    const queuedJobs: Array<{ walletAddress: string; jobId: string }> = rB1.data?.queued ?? [];

    if (rB1.status === 200 && queuedJobs.length > 0) {
      console.log(`\n  → ${queuedJobs.length} wallet(s) queued. Polling until complete...`);
      for (const qj of queuedJobs) {
        console.log(`     wallet: ${qj.walletAddress}`);
        await pollUntilDone(qj.jobId, token);
      }

      section('TEST B2 — POST /intel/wallets/batch-hud  (5cr)  — second call after jobs complete');
      console.log('  Same wallets, jobs should be done now\n');
      const rB2 = await req('POST', '/intel/wallets/batch-hud', token, { wallets });
      show(rB2.status, rB2.data);
      console.log(`\n  → huds ready: ${Object.keys(rB2.data?.huds ?? {}).length}  |  still queued: ${(rB2.data?.queued ?? []).length}  |  skipped: ${(rB2.data?.skipped ?? []).length}`);
    } else if (rB1.status === 200) {
      const hudCount = Object.keys(rB1.data?.huds ?? {}).length;
      console.log(`\n  → All ${hudCount} wallet(s) returned HUD data immediately`);
    }
  }

  // Final balance
  const b1 = await req('GET', '/users/me/credits', token);
  const balAfter: number = b1.data?.balance ?? 0;
  console.log(`\n💳 Balance before: ${balBefore} cr  |  after: ${balAfter} cr  |  spent: ${balBefore - balAfter} cr`);
  console.log('\nDone.\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
