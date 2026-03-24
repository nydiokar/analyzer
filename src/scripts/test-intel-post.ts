/**
 * test-intel-post.ts
 *
 * Tests the three POST Intel endpoints + GET /intel/pricing:
 *   GET  /intel/pricing                         (public)
 *   POST /intel/token/:mint/holders             (20cr)
 *   POST /intel/wallets/similarity              (20cr)
 *   POST /intel/token/:mint/holders/deep        (35cr)
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

async function req(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
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
  const icon = status >= 200 && status < 300 ? '✅' : status === 402 ? '🔒' : '❌';
  console.log(`${icon}  HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Intel POST Endpoints — Focused Integration Test          ║');
  console.log('║  /holders (20cr)  /similarity (20cr)  /holders/deep (35cr)  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 0 — GET /intel/pricing  (public, no auth)
  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST 0 — GET /intel/pricing  (public — no auth required)');
  const pricingRes = await req('GET', '/pricing');
  show(pricingRes.status, pricingRes.data);
  if (pricingRes.status === 200 && Array.isArray(pricingRes.data?.endpoints)) {
    const relevant = pricingRes.data.endpoints.filter((e: any) =>
      ['/intel/token/:mint/holders', '/intel/wallets/similarity', '/intel/token/:mint/holders/deep'].includes(e.path),
    );
    if (relevant.length) {
      console.log('\n  → Relevant POST endpoints from pricing:');
      for (const e of relevant) {
        console.log(`     ${e.method.padEnd(4)} ${e.path.padEnd(35)}  ${e.credits}cr  ($${e.usdEquivalent})`);
        if (e.changedFromCredits !== undefined) {
          console.log(`           ↳ changed from ${e.changedFromCredits}cr`);
        }
      }
    }
  }

  // Login
  console.log('');
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
  const mint         = await prompt('\nToken mint for holders endpoints (Enter to skip A & C): ');
  const walletsInput = await prompt('Wallet addresses (comma-separated, min 2 for TEST B similarity — not needed for /deep): ');
  const wallets      = walletsInput.split(',').map(w => w.trim()).filter(Boolean);

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST A — POST /intel/token/:mint/holders  (20cr)
  // ═══════════════════════════════════════════════════════════════════════════
  section('TEST A — POST /intel/token/:mint/holders  (20cr)');

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
  // TEST B — POST /intel/wallets/similarity  (20cr)
  // ═══════════════════════════════════════════════════════════════════════════
  section(`TEST B — POST /intel/wallets/similarity  (20cr)  — ${wallets.length} wallet(s)`);

  if (wallets.length < 2) {
    console.log('  ⊘  Skipped — need at least 2 wallet addresses');
  } else {
    console.log(`  wallets: ${wallets.join(', ')}\n`);
    const rB = await req('POST', '/intel/wallets/similarity', token, { wallets });
    show(rB.status, rB.data);

    if (rB.status === 202 && rB.data?.jobId) {
      console.log('\n  → Polling similarity job...');
      const outcome = await pollUntilDone(rB.data.jobId, token);
      if (outcome === 'completed') {
        console.log('\n  → Fetching similarity result...');
        const resultB = await req('GET', `/jobs/${rB.data.jobId}/result`, token);
        show(resultB.status, resultB.data);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST C — POST /intel/token/:mint/holders/deep  (35cr)
  // No wallets[] needed — processor auto-discovers holders and chains similarity.
  // Flow: POST → 202 → poll holderProfiles.jobId → poll similarity.resultKey
  // ═══════════════════════════════════════════════════════════════════════════
  section(`TEST C — POST /intel/token/:mint/holders/deep  (35cr)`);

  if (!mint) {
    console.log('  ⊘  Skipped — no mint provided');
  } else {
    console.log(`  mint: ${mint}  topN: 5\n`);
    const rC = await req('POST', `/intel/token/${mint}/holders/deep`, token, { topN: 5 });
    show(rC.status, rC.data);

    if (rC.status === 202) {
      const holderJobId  = rC.data?.holderProfiles?.jobId;
      const resultKey    = rC.data?.similarity?.resultKey;  // e.g. "similarity:result:intel-holders-deep-sim-..."

      if (holderJobId) {
        console.log('\n  → Polling holder-profiles job...');
        const hpOutcome = await pollUntilDone(holderJobId, token);
        if (hpOutcome === 'completed') {
          console.log('  → Fetching holder-profiles result...');
          const holdersResult = await req('GET', `/jobs/${holderJobId}/result`, token);
          const profiles: any[] = holdersResult.data?.result?.profiles ?? holdersResult.data?.profiles ?? [];
          console.log(`  ✅ HTTP ${holdersResult.status}  —  ${profiles.length} profile(s)`);
          for (const p of profiles.slice(0, 5)) {
            console.log(`    #${p.rank ?? '?'}  ${p.walletAddress?.slice(0, 12)}...  ${String(p.supplyPercent?.toFixed(2) ?? '?').padStart(6)}%  ${p.behaviorType ?? 'n/a'}  pnl=${p.walletPnlSol ?? 'n/a'}  tier=${p.dataQualityTier ?? 'n/a'}`);
          }
        }
      }

      if (resultKey) {
        console.log(`\n  → Polling similarity result key: ${resultKey}`);
        // Similarity job is chained — poll by result key until it appears (max 5 min)
        const deadline = Date.now() + 5 * 60 * 1000;
        let simResult: any = null;
        while (Date.now() < deadline) {
          await sleep(4000);
          const r = await req('GET', `/jobs/result/by-key?key=${encodeURIComponent(resultKey)}`, token);
          process.stdout.write(` [${r.status}]`);
          if (r.status === 200 && r.data && typeof r.data === 'object') {
            simResult = r.data;
            process.stdout.write('\n');
            break;
          }
          // 404 = not ready yet, keep polling; anything else = stop
        }
        if (simResult) {
          console.log('\n  Similarity result (summary):');
          const pairs: any[] = simResult?.pairwiseSimilarities ?? [];
          console.log(`  vectorTypeUsed : ${simResult?.vectorTypeUsed ?? 'n/a'}`);
          console.log(`  pairs computed : ${pairs.length}`);
          // Print top 5 pairs by binaryScore, strip bulky fields
          const topPairs = pairs
            .slice()
            .sort((a: any, b: any) => (b.binaryScore ?? b.similarityScore ?? 0) - (a.binaryScore ?? a.similarityScore ?? 0))
            .slice(0, 5)
            .map((p: any) => ({
              walletA: p.walletA?.slice(0, 8) + '...',
              walletB: p.walletB?.slice(0, 8) + '...',
              binaryScore: p.binaryScore ?? p.similarityScore,
              capitalScore: p.capitalScore,
              sharedTokens: p.binarySharedTokenCount ?? p.sharedTokenCount ?? p.sharedTokens?.length,
            }));
          console.log('  top pairs:');
          console.log(JSON.stringify(topPairs, null, 2));
        } else {
          console.log('\n  ⚠️  Similarity result not ready within timeout');
        }
      }
    }
  }

  // Final balance
  const b1 = await req('GET', '/users/me/credits', token);
  const balAfter: number = b1.data?.balance ?? 0;
  console.log(`\n💳 Balance before: ${balBefore} cr  |  after: ${balAfter} cr  |  spent: ${balBefore - balAfter} cr`);
  console.log('\nDone.\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
