/**
 * Interactive integration test for the Wallet Hunt feature.
 *
 * Prompts for credentials, authenticates, then exercises all endpoints.
 * Run: npx ts-node -r tsconfig-paths/register src/scripts/test-wallet-hunt.ts
 */

import * as readline from 'readline';

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const API_PREFIX = '/api/v1';

// ─── Helpers ────────────────────────────────────────────────────────

function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      // Mask password input
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      let password = '';
      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(password);
        } else if (ch === '\u0003') {
          process.exit();
        } else if (ch === '\u007F' || ch === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          password += ch;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function pass(label: string, detail?: string) {
  passCount++;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail: string) {
  failCount++;
  console.log(`  ✗ ${label} — ${detail}`);
}

function skip(label: string, reason: string) {
  skipCount++;
  console.log(`  ⊘ ${label} — SKIPPED: ${reason}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

async function api(
  method: string,
  path: string,
  token: string,
  body?: any,
): Promise<{ status: number; data: any; ok: boolean }> {
  const url = `${BASE_URL}${API_PREFIX}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { status: res.status, data, ok: res.ok };
}

// ─── Main Test Flow ─────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          Wallet Hunt — Integration Test Suite           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Target: ${BASE_URL}${API_PREFIX}`);
  console.log();

  // ── Auth ──
  section('Authentication');

  const email = await prompt('Email: ');
  const password = await prompt('Password: ', true);

  if (!email || !password) {
    console.log('\nNo credentials provided. Cannot test authenticated endpoints.');
    process.exit(1);
  }

  let token: string;
  try {
    const res = await fetch(`${BASE_URL}${API_PREFIX}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginData: any = await res.json();

    if (!res.ok) {
      fail('Login', `${res.status} — ${loginData.message || JSON.stringify(loginData)}`);
      console.log('\nCannot proceed without authentication. Check your credentials.');
      process.exit(1);
    }

    token = loginData.access_token;
    pass('Login', `Authenticated as ${loginData.user?.displayName || loginData.user?.email || email}`);
  } catch (err) {
    fail('Login', `Connection failed — ${(err as Error).message}. Is the server running?`);
    process.exit(1);
  }

  // ── Verify auth works ──
  const meRes = await api('GET', '/auth/me', token);
  if (meRes.ok) {
    pass('Auth check (GET /auth/me)', `userId=${meRes.data.id}`);
  } else {
    fail('Auth check', `${meRes.status} — ${meRes.data?.message || 'Unknown error'}`);
    console.log('\nAuth token not working. Aborting.');
    process.exit(1);
  }

  // ── Clean slate: list existing hunts ──
  section('Pre-flight: Check existing hunts');

  const listRes = await api('GET', '/wallet-hunts', token);
  if (listRes.ok) {
    pass('GET /wallet-hunts', `Found ${listRes.data.length} existing hunt(s)`);
    if (listRes.data.length >= 5) {
      console.log('\n  ⚠ You already have 5 hunts (the max). The create test will verify the limit error.');
    }
  } else {
    fail('GET /wallet-hunts', `${listRes.status} — ${listRes.data?.message}`);
    console.log('\nList endpoint broken. Aborting.');
    process.exit(1);
  }

  const existingHuntCount = listRes.data.length;

  // ── Create hunt ──
  section('Create Hunt');

  let huntId: string | null = null;

  if (existingHuntCount >= 5) {
    // Test that limit enforcement works
    const createRes = await api('POST', '/wallet-hunts', token, { name: 'Test Hunt (should fail)' });
    if (createRes.status === 400) {
      pass('POST /wallet-hunts (at limit)', `Correctly blocked: ${createRes.data.message}`);
    } else {
      fail('POST /wallet-hunts (at limit)', `Expected 400, got ${createRes.status}`);
    }
    skip('Remaining tests', 'Cannot create a test hunt — you have 5 existing hunts. Delete one and re-run.');
    printSummary();
    process.exit(0);
  }

  const createRes = await api('POST', '/wallet-hunts', token, { name: `Test Hunt ${Date.now()}` });
  if (createRes.status === 201) {
    huntId = createRes.data.id;
    pass('POST /wallet-hunts', `Created hunt id=${huntId}, name="${createRes.data.name}"`);
  } else {
    fail('POST /wallet-hunts', `${createRes.status} — ${createRes.data?.message}`);
    console.log('\nCannot proceed without a hunt. Aborting.');
    process.exit(1);
  }

  // Verify it shows in list
  const listRes2 = await api('GET', '/wallet-hunts', token);
  if (listRes2.ok && listRes2.data.length === existingHuntCount + 1) {
    pass('GET /wallet-hunts (after create)', `Count went from ${existingHuntCount} to ${listRes2.data.length}`);
  } else {
    fail('GET /wallet-hunts (after create)', `Expected ${existingHuntCount + 1} hunts, got ${listRes2.data?.length}`);
  }

  // ── Validation: create with missing name ──
  const badCreateRes = await api('POST', '/wallet-hunts', token, {});
  if (badCreateRes.status === 400) {
    pass('POST /wallet-hunts (no name)', `Validation caught: ${badCreateRes.status}`);
  } else {
    fail('POST /wallet-hunts (no name)', `Expected 400, got ${badCreateRes.status}`);
  }

  // ── Get hunt detail (empty) ──
  section('Get Hunt Detail (empty)');

  const detailRes = await api('GET', `/wallet-hunts/${huntId}`, token);
  if (detailRes.ok) {
    const d = detailRes.data;
    const snapshotCount = d.snapshots?.length ?? -1;
    const candidateCount = d.candidates?.length ?? -1;
    if (snapshotCount === 0 && candidateCount === 0) {
      pass('GET /wallet-hunts/:id (empty)', 'Correct: 0 snapshots, 0 candidates');
    } else {
      fail('GET /wallet-hunts/:id (empty)', `Expected 0/0, got ${snapshotCount} snapshots, ${candidateCount} candidates`);
    }
  } else {
    fail('GET /wallet-hunts/:id', `${detailRes.status} — ${detailRes.data?.message}`);
  }

  // ── Add snapshot ──
  section('Add Snapshots');

  // Use a well-known token mint for testing — we'll prompt the user
  console.log();
  console.log('  To test snapshot capture, we need a token mint address.');
  console.log('  The system will fetch top holders from the Solana RPC.');
  console.log();

  const tokenMint1 = await prompt('  Token mint #1 (or press Enter to skip snapshot tests): ');

  let snapshotId: string | null = null;

  if (!tokenMint1) {
    skip('Add snapshot #1', 'No token mint provided');
    skip('Add snapshot #2', 'No token mint provided');
    skip('Duplicate snapshot check', 'No token mint provided');
    skip('Candidate computation', 'No token mint provided');
  } else {
    // Snapshot 1
    console.log('  Fetching top holders (RPC call)...');
    const snap1Res = await api('POST', `/wallet-hunts/${huntId}/snapshots`, token, {
      tokenMint: tokenMint1,
      sourceType: 'TOP_HOLDERS',
      note: 'Test snapshot 1',
    });

    if (snap1Res.status === 201) {
      snapshotId = snap1Res.data.snapshot.id;
      const holderCount = snap1Res.data.snapshot.holderCount;
      const candidateCount = snap1Res.data.candidates.length;
      pass('POST /snapshots (token #1)', `${holderCount} holders captured, ${candidateCount} candidates (expect all with 1 snapshot)`);
    } else {
      fail('POST /snapshots (token #1)', `${snap1Res.status} — ${snap1Res.data?.message}`);
    }

    // Duplicate check
    if (snapshotId) {
      const dupRes = await api('POST', `/wallet-hunts/${huntId}/snapshots`, token, {
        tokenMint: tokenMint1,
        sourceType: 'TOP_HOLDERS',
      });
      if (dupRes.status === 400) {
        pass('POST /snapshots (duplicate)', `Correctly rejected: ${dupRes.data.message}`);
      } else {
        fail('POST /snapshots (duplicate)', `Expected 400, got ${dupRes.status}`);
      }
    }

    // Snapshot 2 — different token for intersection
    const tokenMint2 = await prompt('  Token mint #2 (for intersection test, Enter to skip): ');

    if (!tokenMint2) {
      skip('Add snapshot #2', 'No second token mint provided');
      skip('Candidate intersection', 'No second token mint provided');
    } else {
      console.log('  Fetching top holders (RPC call)...');
      const snap2Res = await api('POST', `/wallet-hunts/${huntId}/snapshots`, token, {
        tokenMint: tokenMint2,
        sourceType: 'TOP_HOLDERS',
        note: 'Test snapshot 2',
      });

      if (snap2Res.status === 201) {
        const holderCount = snap2Res.data.snapshot.holderCount;
        const candidateCount = snap2Res.data.candidates.length;
        pass('POST /snapshots (token #2)', `${holderCount} holders captured, ${candidateCount} candidate(s) in intersection`);

        if (candidateCount > 0) {
          const top = snap2Res.data.candidates[0];
          pass('Candidate shape', `Top candidate: ${top.walletAddress.slice(0, 8)}... (${top.appearanceCount} tokens, confidence=${top.confidence})`);
        } else {
          pass('Candidate intersection', 'No overlapping wallets — normal for unrelated tokens');
        }
      } else {
        fail('POST /snapshots (token #2)', `${snap2Res.status} — ${snap2Res.data?.message}`);
      }
    }

    // Invalid token mint
    const badSnapRes = await api('POST', `/wallet-hunts/${huntId}/snapshots`, token, {
      tokenMint: 'not-a-valid-address',
      sourceType: 'TOP_HOLDERS',
    });
    if (badSnapRes.status === 400) {
      pass('POST /snapshots (bad mint)', `Validation caught: ${badSnapRes.status}`);
    } else {
      fail('POST /snapshots (bad mint)', `Expected 400, got ${badSnapRes.status}`);
    }

    // Invalid source type
    const badSourceRes = await api('POST', `/wallet-hunts/${huntId}/snapshots`, token, {
      tokenMint: tokenMint1,
      sourceType: 'FAKE_SOURCE',
    });
    if (badSourceRes.status === 400) {
      pass('POST /snapshots (bad source)', `Validation caught: ${badSourceRes.status}`);
    } else {
      fail('POST /snapshots (bad source)', `Expected 400, got ${badSourceRes.status}`);
    }
  }

  // ── Get hunt detail (with data) ──
  section('Get Hunt Detail (with snapshots)');

  const detail2Res = await api('GET', `/wallet-hunts/${huntId}`, token);
  if (detail2Res.ok) {
    const d = detail2Res.data;
    pass('GET /wallet-hunts/:id', `${d.snapshots.length} snapshot(s), ${d.candidates.length} candidate(s)`);

    // Verify lastVisitedAt was updated
    const visited = new Date(d.hunt.lastVisitedAt);
    const now = new Date();
    const diffMs = now.getTime() - visited.getTime();
    if (diffMs < 10000) {
      pass('lastVisitedAt updated', `Updated ${diffMs}ms ago`);
    } else {
      fail('lastVisitedAt updated', `Last visited ${diffMs}ms ago — expected recent`);
    }
  } else {
    fail('GET /wallet-hunts/:id', `${detail2Res.status}`);
  }

  // ── Track candidate ──
  section('Track Candidate');

  if (detail2Res.ok && detail2Res.data.candidates.length > 0) {
    const candidateWallet = detail2Res.data.candidates[0].walletAddress;
    const trackRes = await api('POST', `/wallet-hunts/${huntId}/candidates/${candidateWallet}/track`, token);
    if (trackRes.status === 201) {
      pass('POST /candidates/:wallet/track', `Tracked ${candidateWallet.slice(0, 8)}...`);
    } else if (trackRes.status === 409) {
      pass('POST /candidates/:wallet/track', `Already tracked (409) — that's fine`);
    } else {
      fail('POST /candidates/:wallet/track', `${trackRes.status} — ${trackRes.data?.message}`);
    }
  } else if (detail2Res.ok && detail2Res.data.snapshots.length > 0) {
    // No candidates but we have snapshots — use a holder from the first snapshot
    skip('Track candidate', 'No candidates to track (need 2+ token overlap)');
  } else {
    skip('Track candidate', 'No snapshot data available');
  }

  // Track with invalid wallet
  const badTrackRes = await api('POST', `/wallet-hunts/${huntId}/candidates/invalid-wallet/track`, token);
  if (badTrackRes.status === 400) {
    pass('POST /candidates/:wallet/track (bad address)', 'Validation caught');
  } else {
    fail('POST /candidates/:wallet/track (bad address)', `Expected 400, got ${badTrackRes.status}`);
  }

  // ── Remove snapshot ──
  section('Remove Snapshot');

  if (snapshotId) {
    const removeSnapRes = await api('DELETE', `/wallet-hunts/${huntId}/snapshots/${snapshotId}`, token);
    if (removeSnapRes.status === 204) {
      pass('DELETE /snapshots/:id', `Removed snapshot ${snapshotId.slice(0, 8)}...`);
    } else {
      fail('DELETE /snapshots/:id', `${removeSnapRes.status} — ${removeSnapRes.data?.message}`);
    }

    // Verify removal
    const detail3Res = await api('GET', `/wallet-hunts/${huntId}`, token);
    if (detail3Res.ok) {
      const removed = !detail3Res.data.snapshots.find((s: any) => s.id === snapshotId);
      if (removed) {
        pass('Snapshot removal verified', `${detail3Res.data.snapshots.length} snapshot(s) remain`);
      } else {
        fail('Snapshot removal verified', 'Snapshot still present after delete');
      }
    }
  } else {
    skip('Remove snapshot', 'No snapshot was created');
  }

  // Remove non-existent snapshot
  const badRemoveRes = await api('DELETE', `/wallet-hunts/${huntId}/snapshots/nonexistent-id`, token);
  if (badRemoveRes.status === 404) {
    pass('DELETE /snapshots/:id (not found)', 'Correctly returned 404');
  } else {
    fail('DELETE /snapshots/:id (not found)', `Expected 404, got ${badRemoveRes.status}`);
  }

  // ── Ownership check ──
  section('Ownership Enforcement');

  // We can't easily test with a different user, but we can test with a fake hunt ID
  const fakeHuntRes = await api('GET', '/wallet-hunts/nonexistent-hunt-id', token);
  if (fakeHuntRes.status === 404) {
    pass('GET /wallet-hunts/:id (not found)', 'Correctly returned 404');
  } else {
    fail('GET /wallet-hunts/:id (not found)', `Expected 404, got ${fakeHuntRes.status}`);
  }

  // ── Delete hunt (cleanup) ──
  section('Delete Hunt (cleanup)');

  const deleteRes = await api('DELETE', `/wallet-hunts/${huntId}`, token);
  if (deleteRes.status === 204) {
    pass('DELETE /wallet-hunts/:id', `Deleted test hunt ${huntId!.slice(0, 8)}...`);
  } else {
    fail('DELETE /wallet-hunts/:id', `${deleteRes.status} — ${deleteRes.data?.message}`);
  }

  // Verify deletion
  const listRes3 = await api('GET', '/wallet-hunts', token);
  if (listRes3.ok && listRes3.data.length === existingHuntCount) {
    pass('Deletion verified', `Back to ${existingHuntCount} hunt(s)`);
  } else {
    fail('Deletion verified', `Expected ${existingHuntCount} hunts, got ${listRes3.data?.length}`);
  }

  // Delete non-existent
  const badDeleteRes = await api('DELETE', `/wallet-hunts/${huntId}`, token);
  if (badDeleteRes.status === 404) {
    pass('DELETE /wallet-hunts/:id (already deleted)', 'Correctly returned 404');
  } else {
    fail('DELETE /wallet-hunts/:id (already deleted)', `Expected 404, got ${badDeleteRes.status}`);
  }

  // ── Summary ──
  printSummary();
}

function printSummary() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passCount} passed, ${failCount} failed, ${skipCount} skipped${' '.repeat(Math.max(0, 24 - String(passCount + failCount + skipCount).length))}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
