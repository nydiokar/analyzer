/**
 * test-agent-holder-by-key.ts
 *
 * Narrow integration check for the agent holder-profiles result path:
 * 1. login
 * 2. queue POST /intel/token/:mint/holders/agent
 * 3. poll GET /jobs/:jobId until completed
 * 4. fetch agentResultKey via GET /jobs/result/by-key first
 * 5. fetch the same agentResultKey again to confirm cached re-read
 * 6. optionally fetch the dedicated hydration endpoint for parity
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/test-agent-holder-by-key.ts
 *
 * Optional env vars:
 *   API_URL
 *   TEST_EMAIL
 *   TEST_PASSWORD
 *   TEST_MINT
 *   TEST_TOP_N
 */

import * as readline from 'readline';

const BASE = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API = `${BASE}/api/v1`;

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
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          buf += ch;
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

async function req(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Leave as raw text if not JSON
  }

  return { status: res.status, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(jobId: string, token: string): Promise<'completed' | 'failed'> {
  const maxWaitMs = 5 * 60 * 1000;
  const intervalMs = 4000;
  const startedAt = Date.now();

  process.stdout.write(`Polling job ${jobId}`);
  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(intervalMs);
    const response = await req('GET', `/jobs/${jobId}`, token);
    const data = response.data as { status?: string } | undefined;
    const status = data?.status;
    process.stdout.write(` [${status ?? response.status}]`);

    if (status === 'completed') {
      process.stdout.write('\n');
      return 'completed';
    }
    if (status === 'failed') {
      process.stdout.write('\n');
      return 'failed';
    }
  }

  process.stdout.write(' [timeout]\n');
  return 'failed';
}

function section(title: string): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log(title);
  console.log('='.repeat(72));
}

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function login(): Promise<string> {
  const envEmail = process.env.TEST_EMAIL?.trim();
  const envPassword = process.env.TEST_PASSWORD?.trim();
  const email = envEmail || await prompt('Email: ');
  const password = envPassword || await prompt('Password: ', true);

  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json() as { access_token?: string; user?: { email?: string } };
  assertOk(res.ok, `Login failed with HTTP ${res.status}`);
  assertOk(data.access_token, 'Login response missing access_token');
  console.log(`Logged in as ${data.user?.email ?? email}`);
  return data.access_token;
}

async function main(): Promise<void> {
  console.log(`Target API: ${API}`);

  const token = await login();
  const mint = process.env.TEST_MINT?.trim() || await prompt('Token mint: ');
  const topN = Number(process.env.TEST_TOP_N ?? '20');

  assertOk(mint, 'Token mint is required');
  assertOk(Number.isInteger(topN) && topN >= 1 && topN <= 50, 'TEST_TOP_N must be an integer between 1 and 50');

  section('1. Queue agent holder analysis');
  const queued = await req('POST', `/intel/token/${mint}/holders/agent`, token, { topN });
  console.log(JSON.stringify(queued.data, null, 2));
  assertOk(queued.status === 202, `Expected 202 from queue endpoint, got ${queued.status}`);

  const queueData = queued.data as {
    jobId?: string;
    resultKey?: string;
    agentResultKey?: string;
  };

  assertOk(queueData.jobId, 'Queue response missing jobId');
  assertOk(queueData.resultKey, 'Queue response missing resultKey');
  assertOk(queueData.agentResultKey, 'Queue response missing agentResultKey');

  section('2. Poll job to completion');
  const outcome = await pollJob(queueData.jobId, token);
  assertOk(outcome === 'completed', `Job did not complete successfully: ${outcome}`);

  section('3. Fetch agentResultKey via /jobs/result/by-key first');
  const firstByKey = await req(
    'GET',
    `/jobs/result/by-key?key=${encodeURIComponent(queueData.agentResultKey)}`,
    token,
  );
  console.log(`HTTP ${firstByKey.status}`);
  assertOk(firstByKey.status === 200, `Expected 200 from first by-key agent fetch, got ${firstByKey.status}`);

  const firstAgent = firstByKey.data as {
    aggregate?: { totalHolders?: number };
    profiles?: unknown[];
    metadata?: { tokenMint?: string };
  };

  assertOk(firstAgent.aggregate, 'Agent result missing aggregate');
  assertOk(Array.isArray(firstAgent.profiles), 'Agent result missing profiles array');
  console.log(`aggregate.totalHolders = ${firstAgent.aggregate?.totalHolders}`);
  console.log(`profiles.length = ${firstAgent.profiles.length}`);
  console.log(`metadata.tokenMint = ${firstAgent.metadata?.tokenMint ?? 'n/a'}`);

  section('4. Fetch the same agentResultKey again');
  const secondByKey = await req(
    'GET',
    `/jobs/result/by-key?key=${encodeURIComponent(queueData.agentResultKey)}`,
    token,
  );
  console.log(`HTTP ${secondByKey.status}`);
  assertOk(secondByKey.status === 200, `Expected 200 from second by-key agent fetch, got ${secondByKey.status}`);

  section('5. Compare with full result key');
  const fullByKey = await req(
    'GET',
    `/jobs/result/by-key?key=${encodeURIComponent(queueData.resultKey)}`,
    token,
  );
  console.log(`HTTP ${fullByKey.status}`);
  assertOk(fullByKey.status === 200, `Expected 200 from full result fetch, got ${fullByKey.status}`);

  const fullResult = fullByKey.data as { profiles?: unknown[] };
  console.log(`full profiles.length = ${Array.isArray(fullResult.profiles) ? fullResult.profiles.length : 'n/a'}`);

  section('6. Optional parity check via dedicated hydration endpoint');
  const directAgent = await req(
    'GET',
    `/intel/jobs/result/agent/holder-profiles/${queueData.jobId}`,
    token,
  );
  console.log(`HTTP ${directAgent.status}`);
  assertOk(directAgent.status === 200, `Expected 200 from dedicated agent endpoint, got ${directAgent.status}`);

  console.log('\nPASS: agent by-key flow works before dedicated hydration endpoint is required.');
}

main().catch((error) => {
  console.error('\nFAIL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
