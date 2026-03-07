#!/usr/bin/env ts-node
/**
 * intel-agent-test.ts
 *
 * Verifies the three IntelController endpoints using the X402 agent flow:
 *
 * Test A — 402 gate:
 *   GET /intel/wallet/:addr (no auth, no payment) → 402 with required:5 in body
 *
 * Test B — 200 with data (analyzed wallet):
 *   GET /intel/wallet/:addr + X-Payment → 200 with summary + hud fields
 *
 * Test C — /hud endpoint:
 *   GET /intel/wallet/:addr/hud + X-Payment → 200 with hud data
 *
 * Test D — /tokens endpoint:
 *   GET /intel/wallet/:addr/tokens + X-Payment → 200 with token list
 *
 * Required env vars (same as x402-agent-test.ts):
 *   AGENT_PRIVKEY    — Base58-encoded Solana keypair with USDC on mainnet
 *   HELIUS_API_KEY   — For RPC
 *   TEST_WALLET_ADDR — A wallet address that has already been analyzed
 *   API_BASE_URL     — Defaults to http://localhost:3001/api/v1
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/intel-agent-test.ts
 */

import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = (require('bs58') as { default: { decode: (s: string) => Uint8Array } }).default;

const API_BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const AGENT_PRIVKEY = process.env.AGENT_PRIVKEY ?? '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? '';
const TEST_WALLET_ADDR = process.env.TEST_WALLET_ADDR ?? '';
const USDC_DECIMALS = 6;

function log(msg: string) { console.log(`[intel-test] ${msg}`); }
function pass(msg: string) { console.log(`[intel-test] ✅  ${msg}`); }
function fail(msg: string) { console.error(`[intel-test] ❌  ${msg}`); process.exit(1); }

// ---------------------------------------------------------------------------
// Build a signed X-Payment header for a given amount (base units)
// ---------------------------------------------------------------------------
async function buildXPaymentHeader(
  connection: Connection,
  agentKeypair: Keypair,
  usdcMint: PublicKey,
  treasury: PublicKey,
  amountBaseUnits: bigint,
  network: string,
): Promise<string> {
  const agentAta = await getAssociatedTokenAddress(usdcMint, agentKeypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(usdcMint, treasury);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const ix = createTransferCheckedInstruction(
    agentAta, usdcMint, treasuryAta,
    agentKeypair.publicKey, amountBaseUnits, USDC_DECIMALS, [], TOKEN_PROGRAM_ID,
  );
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: agentKeypair.publicKey });
  tx.add(ix);
  tx.sign(agentKeypair);

  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: { transaction: tx.serialize().toString('base64') },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!AGENT_PRIVKEY) fail('Set AGENT_PRIVKEY');
  if (!HELIUS_API_KEY) fail('Set HELIUS_API_KEY');
  if (!TEST_WALLET_ADDR) fail('Set TEST_WALLET_ADDR to an already-analyzed wallet');

  const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, 'confirmed');
  const agentKeypair = Keypair.fromSecretKey(bs58.decode(AGENT_PRIVKEY));
  log(`Agent wallet : ${agentKeypair.publicKey.toBase58()}`);
  log(`Target wallet: ${TEST_WALLET_ADDR}`);
  log(`API base     : ${API_BASE}\n`);

  const intelUrl = `${API_BASE}/intel/wallet/${TEST_WALLET_ADDR}`;

  // -------------------------------------------------------------------------
  // Test A — 402 gate: unauthenticated request must return 402 with required:5
  // -------------------------------------------------------------------------
  log('Test A: 402 gate — unauthenticated GET /intel/wallet/:addr');
  let x402Payload: any;
  try {
    await axios.get(intelUrl);
    fail('Expected 402 but got 200');
  } catch (err) {
    const e = err as AxiosError;
    if (e.response?.status !== 402) fail(`Expected 402, got ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    x402Payload = e.response!.data as any;
    if (x402Payload.required !== 5) fail(`required should be 5, got ${x402Payload.required}`);
    pass(`402 returned with required:${x402Payload.required}`);
    log(`  Full 402 body:\n${JSON.stringify(x402Payload, null, 2)}`);
  }

  // -------------------------------------------------------------------------
  // Test B — 200 with data: X-Payment → GET /intel/wallet/:addr
  // -------------------------------------------------------------------------
  log('\nTest B: 200 with data — GET /intel/wallet/:addr + X-Payment');
  const accept = x402Payload.accepts[0];
  const usdcMint = new PublicKey(accept.asset);
  const treasury = new PublicKey(accept.payTo);
  const network = accept.network;

  const headerB = await buildXPaymentHeader(
    connection, agentKeypair, usdcMint, treasury,
    BigInt(accept.maxAmountRequired), network,
  );

  try {
    const res = await axios.get(intelUrl, { headers: { 'X-Payment': headerB } });
    const data = res.data as any;
    if (res.status !== 200 && res.status !== 202) fail(`Expected 200 or 202, got ${res.status}`);
    if (data.status !== 'ok') {
      // Could be 202 queued if wallet was stale — that's also valid
      if (data.status === 'queued') {
        pass(`202 queued — wallet was stale/missing, job queued: ${data.jobId}`);
        log('  (Re-run after analysis completes to get 200 with data)');
        log(`  Monitor: ${data.monitoringUrl}`);
        return; // Can't verify data fields until analysis completes
      }
      fail(`Expected status "ok", got "${data.status}": ${JSON.stringify(data)}`);
    }
    if (!data.summary) fail('Missing summary field in response');
    if (!('hud' in data)) fail('Missing hud field in response');
    pass(`200 with status:"ok"`);
    log(`  summary.lastAnalyzedAt : ${data.summary.lastAnalyzedAt}`);
    log(`  summary.realizedPnl    : ${data.summary.realizedPnl}`);
    log(`  hud present            : ${data.hud !== null}`);
    log(`  behavior present       : ${data.behavior !== null}`);
    log(`  pnl present            : ${data.pnl !== null}`);
    log(`  Full response:\n${JSON.stringify(data, null, 2)}`);
  } catch (err) {
    const e = err as AxiosError;
    fail(`GET /intel/wallet/:addr failed: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
  }

  // -------------------------------------------------------------------------
  // Test C — /hud endpoint (1cr)
  // -------------------------------------------------------------------------
  log('\nTest C: GET /intel/wallet/:addr/hud + X-Payment');
  // Need a fresh tx (new blockhash, each tx is unique)
  let hudX402: any;
  try {
    await axios.get(`${intelUrl}/hud`);
  } catch (err) {
    hudX402 = (err as AxiosError).response?.data;
  }
  if (hudX402) {
    const headerC = await buildXPaymentHeader(
      connection, agentKeypair, usdcMint, treasury,
      BigInt(hudX402.accepts[0].maxAmountRequired), network,
    );
    try {
      const res = await axios.get(`${intelUrl}/hud`, { headers: { 'X-Payment': headerC } });
      pass(`200 from /hud — required:${hudX402.required}cr`);
      log(`  HUD keys: ${Object.keys(res.data).join(', ')}`);
    } catch (err) {
      const e = err as AxiosError;
      fail(`/hud failed: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Test D — /tokens endpoint (3cr)
  // -------------------------------------------------------------------------
  log('\nTest D: GET /intel/wallet/:addr/tokens + X-Payment');
  let tokensX402: any;
  try {
    await axios.get(`${intelUrl}/tokens`);
  } catch (err) {
    tokensX402 = (err as AxiosError).response?.data;
  }
  if (tokensX402) {
    const headerD = await buildXPaymentHeader(
      connection, agentKeypair, usdcMint, treasury,
      BigInt(tokensX402.accepts[0].maxAmountRequired), network,
    );
    try {
      const res = await axios.get(`${intelUrl}/tokens`, { headers: { 'X-Payment': headerD } });
      const data = res.data as any;
      pass(`200 from /tokens — required:${tokensX402.required}cr, total tokens: ${data.total}`);
    } catch (err) {
      const e = err as AxiosError;
      fail(`/tokens failed: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
    }
  }

  log('\n🎉  All Intel endpoint tests passed.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
