/**
 * test-intel-endpoints.ts
 *
 * Interactive integration test for all 5 IntelController endpoints.
 * Logs in with email/password (JWT), then hits each endpoint sequentially.
 * When GET /intel/wallet/:addr returns 202 (queued), polls the job until
 * complete, then calls it again to get the actual 200 response.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-intel-endpoints.ts
 *
 * Optional env vars:
 *   API_URL      — defaults to http://localhost:3001
 *   TEST_WALLET  — skip the prompt for wallet address
 *   TEST_MINT    — skip the prompt for token mint
 */

import * as readline from 'readline';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API  = `${BASE}/api/v1`;

// ── readline helper ────────────────────────────────────────────────────────────

function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      let buf = '';
      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(buf);
        } else if (ch === '\u0003') {
          process.exit();
        } else if (ch === '\u007F' || ch === '\b') {
          if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
        } else {
          buf += ch;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
    }
  });
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

async function req(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* leave as string */ }
  return { status: res.status, data };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Poll a BullMQ job until completed/failed ───────────────────────────────────

async function pollJob(jobId: string, token: string): Promise<'completed' | 'failed'> {
  const maxWaitMs = 5 * 60 * 1000; // 5 minutes
  const intervalMs = 4000;
  const started = Date.now();

  process.stdout.write(`  ⏳ Polling`);
  while (Date.now() - started < maxWaitMs) {
    await sleep(intervalMs);
    const r = await req('GET', `/jobs/${jobId}`, token);
    if (r.status === 200 && r.data?.status) {
      const st: string = r.data.status;  // field is "status" not "state"
      process.stdout.write(` [${st}]`);
      if (st === 'completed') { process.stdout.write('\n'); return 'completed'; }
      if (st === 'failed')    { process.stdout.write('\n'); return 'failed'; }
    } else if (r.status === 404) {
      // Job may have been cleaned up after completion — treat as done
      process.stdout.write(` [not found — assuming completed]\n`);
      return 'completed';
    }
  }
  process.stdout.write(' [timeout]\n');
  return 'failed';
}

// ── Display helpers ────────────────────────────────────────────────────────────

function section(title: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function show(status: number, data: any) {
  const icon = status >= 200 && status < 300 ? '✅' : status === 402 ? '🔒' : '❌';
  console.log(`${icon}  HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║            Intel Endpoints — Integration Test               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${API}\n`);

  // ── Login ──────────────────────────────────────────────────────────────────
  const email    = await prompt('Email: ');
  const password = await prompt('Password: ', true);

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginData: any = await loginRes.json();
  if (!loginRes.ok) {
    console.error(`\n❌ Login failed (${loginRes.status}):`, loginData);
    process.exit(1);
  }
  const token = loginData.access_token as string;
  console.log(`\n✅ Logged in as: ${loginData.user?.email ?? email}`);

  // ── Addresses ──────────────────────────────────────────────────────────────
  let wallet = process.env.TEST_WALLET ?? '';
  let mint   = process.env.TEST_MINT ?? '';
  if (!wallet) wallet = await prompt('\nWallet address (for GET /intel/wallet tests, Enter to skip): ');
  if (!mint)   mint   = await prompt('Token mint    (for holder-profiles tests, Enter to skip): ');

  // ── Balance before ─────────────────────────────────────────────────────────
  section('0. Credit balance before');
  const b0 = await req('GET', '/users/me/credits', token);
  const balBefore: number = b0.data?.balance ?? 0;
  console.log(`✅  HTTP ${b0.status}  →  Balance: ${balBefore} cr`);

  // ── Test 1: GET /intel/wallet/:addr ───────────────────────────────────────
  if (wallet) {
    section(`1. GET /intel/wallet/:addr  (5cr)  →  ${wallet}`);
    let r1 = await req('GET', `/intel/wallet/${wallet}`, token);
    show(r1.status, r1.data);

    if (r1.status === 202 && r1.data?.jobId) {
      console.log('\n  → Data was stale/missing — job queued. Polling until complete...');
      const outcome = await pollJob(r1.data.jobId, token);
      if (outcome === 'completed') {
        console.log('\n  → Job complete. Calling GET /intel/wallet/:addr again to get data...');
        r1 = await req('GET', `/intel/wallet/${wallet}`, token);
        show(r1.status, r1.data);
      } else {
        console.log('  ❌ Job failed or timed out — skipping data fetch');
      }
    }
  } else {
    console.log('\n⊘  Test 1 skipped — no wallet provided');
  }

  // ── Test 2: GET /intel/wallet/:addr/tokens ────────────────────────────────
  if (wallet) {
    section(`2. GET /intel/wallet/:addr/tokens  (3cr)  →  ${wallet}`);
    const r2 = await req('GET', `/intel/wallet/${wallet}/tokens`, token);
    show(r2.status, r2.data);
  } else {
    console.log('\n⊘  Test 2 skipped — no wallet provided');
  }

  // ── Test 3: GET /intel/wallet/:addr/hud ──────────────────────────────────
  if (wallet) {
    section(`3. GET /intel/wallet/:addr/hud  (1cr)  →  ${wallet}`);
    const r3 = await req('GET', `/intel/wallet/${wallet}/hud`, token);
    show(r3.status, r3.data);
  } else {
    console.log('\n⊘  Test 3 skipped — no wallet provided');
  }

  // ── Test 4: POST /intel/token/:mint/holders ───────────────────────────────
  if (mint) {
    section(`4. POST /intel/token/:mint/holders  (20cr)  →  mint: ${mint}  topN: 5`);
    const r4 = await req('POST', `/intel/token/${mint}/holders`, token, { topN: 5 });
    show(r4.status, r4.data);

    if (r4.status === 202 && r4.data?.jobId) {
      console.log('\n  → Holder-profiles job queued. Polling until complete...');
      const outcome = await pollJob(r4.data.jobId, token);
      if (outcome === 'completed') {
        console.log('\n  → Fetching result via by-key ...');
        const resultRes = await req('GET', `/jobs/result/by-key?key=${encodeURIComponent(r4.data.resultKey)}`, token);
        const fullBytes = Buffer.byteLength(JSON.stringify(resultRes.data), 'utf8');
        console.log(`✅  HTTP ${resultRes.status}  →  ${fullBytes} bytes (${(fullBytes / 1024).toFixed(1)} KB)  profiles: ${resultRes.data?.profiles?.length ?? '?'}`);
      }
    }
  } else {
    console.log('\n⊘  Test 4 skipped — no mint provided');
  }

  // ── Test 5: POST /intel/wallets/batch-hud ────────────────────────────────
  if (wallet) {
    const batchWallets = [wallet];
    section(`5. POST /intel/wallets/batch-hud  (5cr)  →  ${batchWallets.length} wallet(s)`);
    const r5 = await req('POST', `/intel/wallets/batch-hud`, token, { wallets: batchWallets });
    show(r5.status, r5.data);
  } else {
    console.log('\n⊘  Test 5 skipped — no wallet provided');
  }

  // ── Test 6: POST /intel/token/:mint/holders/agent ─────────────────────────
  if (!mint) mint = (await prompt('\nToken mint for agent test (Enter to skip): ')).trim();
  if (mint) {
    section(`6. POST /intel/token/:mint/holders/agent  (20cr)  →  mint: ${mint}  topN: 5`);
    const r6 = await req('POST', `/intel/token/${mint}/holders/agent`, token, { topN: 5 });
    show(r6.status, r6.data);

    if (r6.status === 202 && r6.data?.jobId) {
      console.log('\n  → Holder-profiles/agent job queued. Polling until complete...');
      const outcome = await pollJob(r6.data.jobId, token);
      if (outcome === 'completed') {
        const jobId = r6.data.jobId as string;

        console.log('\n  → Fetching agent result via GET /intel/jobs/result/agent/holder-profiles/:jobId ...');
        const agentRes = await req('GET', `/intel/jobs/result/agent/holder-profiles/${jobId}`, token);
        const agentBytes = Buffer.byteLength(JSON.stringify(agentRes.data), 'utf8');
        show(agentRes.status, agentRes.data);
        if (agentRes.status === 200) {
          const agg = agentRes.data?.aggregate;
          console.log(`\n  ── Aggregate summary ──`);
          console.log(`     totalHolders      : ${agg?.totalHolders}  (analyzed: ${agg?.analyzedHolders})`);
          console.log(`     top1SupplyPct     : ${agg?.top1SupplyPct}%  top5: ${agg?.top5SupplyPct}%  (excl. LP/system)`);
          console.log(`     avgWalletPnlSol   : ${agg?.avgWalletPnlSol}`);
          if (Array.isArray(agg?.behaviorDistribution)) {
            console.log(`     behaviorDistrib   : ${agg.behaviorDistribution.map((b: any) => `${b.behaviorType}×${b.count}(${b.supplyPct}%)`).join(', ')}`);
          }
          console.log(`\n  ── Payload size ──`);
          console.log(`     agent result      : ${agentBytes} bytes  (${(agentBytes / 1024).toFixed(1)} KB)`);

          // Also fetch via generic by-key to confirm whitelist works
          const agentKey = r6.data.agentResultKey as string;
          if (agentKey) {
            console.log(`\n  → Also fetching via GET /jobs/result/by-key?key=${agentKey} (whitelist check)...`);
            const byKey = await req('GET', `/jobs/result/by-key?key=${encodeURIComponent(agentKey)}`, token);
            console.log(`  ${byKey.status === 200 ? '✅' : '❌'}  HTTP ${byKey.status} — by-key path ${byKey.status === 200 ? 'OK' : 'FAILED'}`);
          }

          // Compare size against full result
          const fullResultKey = r6.data.resultKey as string;
          if (fullResultKey) {
            console.log(`\n  → Fetching full result via by-key for size comparison...`);
            const fullRes = await req('GET', `/jobs/result/by-key?key=${encodeURIComponent(fullResultKey)}`, token);
            if (fullRes.status === 200) {
              const fullBytes = Buffer.byteLength(JSON.stringify(fullRes.data), 'utf8');
              const reduction = Math.round((1 - agentBytes / fullBytes) * 100);
              console.log(`     full result       : ${fullBytes} bytes  (${(fullBytes / 1024).toFixed(1)} KB)`);
              console.log(`     size reduction    : ${reduction}%`);
            }
          }
        }
      }
    }
  } else {
    console.log('\n⊘  Test 6 skipped — no mint provided');
  }

  // ── Test 7: POST /intel/wallets/similarity/agent ──────────────────────────
  // Requires at least 2 wallets — use the provided wallet + prompt for a second
  let wallet2 = process.env.TEST_WALLET2 ?? '';
  if (!wallet2) wallet2 = (await prompt('\nWallet(s) for similarity/agent — paste 1 or 2 addresses space-separated (Enter to skip): ')).trim();

  // Support "addr1 addr2" or "addr1, addr2" or just a second address alongside wallet
  const extraWallets = wallet2.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const similarityWallets = [...new Set([...(wallet ? [wallet] : []), ...extraWallets])];

  if (similarityWallets.length >= 2) {
    section(`7. POST /intel/wallets/similarity/agent  (20cr)  →  ${similarityWallets.length} wallets`);
    const r7 = await req('POST', `/intel/wallets/similarity/agent`, token, {
      wallets: similarityWallets,
    });
    show(r7.status, r7.data);

    if (r7.status === 202 && r7.data?.jobId) {
      console.log('\n  → Similarity/agent job queued. Polling until complete...');
      const outcome = await pollJob(r7.data.jobId, token);
      if (outcome === 'completed') {
        const requestId = r7.data.requestId as string;

        console.log('\n  → Fetching agent result via GET /intel/jobs/result/agent/similarity/:requestId ...');
        const agentRes = await req('GET', `/intel/jobs/result/agent/similarity/${requestId}`, token);
        const agentBytes = Buffer.byteLength(JSON.stringify(agentRes.data), 'utf8');
        show(agentRes.status, agentRes.data);
        if (agentRes.status === 200) {
          const meta = agentRes.data?.metadata;
          console.log(`\n  ── Payload size ──`);
          console.log(`     agent result      : ${agentBytes} bytes  (${(agentBytes / 1024).toFixed(1)} KB)`);
          console.log(`     coordinationScore : ${agentRes.data?.coordinationScore}  wallets: ${meta?.walletsAnalyzed}  pairs: ${meta?.totalPairs}  flagged: ${meta?.flaggedPairs}`);

          // Also verify by-key whitelist
          const agentKey = r7.data.agentResultKey as string;
          if (agentKey) {
            console.log(`\n  → Also fetching via GET /jobs/result/by-key?key=${agentKey} (whitelist check)...`);
            const byKey = await req('GET', `/jobs/result/by-key?key=${encodeURIComponent(agentKey)}`, token);
            console.log(`  ${byKey.status === 200 ? '✅' : '❌'}  HTTP ${byKey.status} — by-key path ${byKey.status === 200 ? 'OK' : 'FAILED'}`);
          }

          // Size comparison against full result
          const fullResultKey = r7.data.resultKey as string;
          if (fullResultKey) {
            console.log(`\n  → Fetching full result via by-key for size comparison...`);
            const fullRes = await req('GET', `/jobs/result/by-key?key=${encodeURIComponent(fullResultKey)}`, token);
            if (fullRes.status === 200) {
              const fullBytes = Buffer.byteLength(JSON.stringify(fullRes.data), 'utf8');
              const reduction = Math.round((1 - agentBytes / fullBytes) * 100);
              console.log(`     full result       : ${fullBytes} bytes  (${(fullBytes / 1024).toFixed(1)} KB)`);
              console.log(`     size reduction    : ${reduction}%`);
            }
          }
        }
      }
    }
  } else {
    console.log('\n⊘  Test 7 skipped — need at least 2 wallet addresses (paste space-separated or set TEST_WALLET + TEST_WALLET2)');
  }

  // ── Balance after ──────────────────────────────────────────────────────────
  section('8. Credit balance after');
  const b1 = await req('GET', '/users/me/credits', token);
  const balAfter: number = b1.data?.balance ?? 0;
  console.log(`✅  HTTP ${b1.status}  →  Balance: ${balAfter} cr`);
  console.log(`\n  → Balance before : ${balBefore} cr`);
  console.log(`  → Balance after  : ${balAfter} cr`);
  console.log(`  → Credits spent  : ${balBefore - balAfter} cr`);
  console.log(`  (Tests 1+2+3+5 = 14cr baseline; Test 4 = 20cr; Test 6 = 20cr; Test 7 = 20cr)`);
  console.log('\nDone.\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
