#!/usr/bin/env ts-node
/**
 * x402-agent-test.ts
 *
 * Simulates a fully autonomous agent negotiating the X402 payment handshake.
 * No API key or JWT required — the agent authenticates via their Solana wallet.
 *
 * Step 1 — GET /endpoint (no auth) → expect 402 with x402 payload
 * Step 2 — Read treasury, mint, required amount from the 402 payload
 * Step 3 — Build + sign a USDC transferChecked transaction to treasury
 * Step 4 — Encode as PaymentPayload (base64 JSON) → X-Payment header
 * Step 5 — GET /endpoint + X-Payment → expect 200
 * Step 6 — Retry same X-Payment → expect 402 replay rejection
 *
 * Required env vars:
 *   AGENT_PRIVKEY   — Base58-encoded Solana keypair (must hold USDC on mainnet)
 *   HELIUS_API_KEY  — For RPC
 *   API_BASE_URL    — Defaults to http://localhost:3001/api/v1
 *   TEST_WALLET_ADDR — Wallet to analyze (defaults to a known address)
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/x402-agent-test.ts
 */

import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

// bs58 uses package exports incompatible with moduleResolution:node — CJS path directly
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = require('bs58/src/cjs/index.cjs') as { default: { decode: (s: string) => Uint8Array } };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = (process.env.API_BASE_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const AGENT_PRIVKEY = process.env.AGENT_PRIVKEY ?? '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? '';
const TEST_WALLET_ADDR = process.env.TEST_WALLET_ADDR ?? 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKdAN';
const USDC_DECIMALS = 6;
const TARGET_PATH = `/wallets/${TEST_WALLET_ADDR}/behavior-analysis`;

function log(msg: string): void {
  console.log(`[x402-agent] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!AGENT_PRIVKEY) {
    console.error('❌  Set AGENT_PRIVKEY (base58 Solana private key with USDC)');
    process.exit(1);
  }
  if (!HELIUS_API_KEY) {
    console.error('❌  Set HELIUS_API_KEY');
    process.exit(1);
  }

  const connection = new Connection(
    `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
    'confirmed',
  );

  const agentKeypair = Keypair.fromSecretKey(bs58.default.decode(AGENT_PRIVKEY));
  log(`Agent wallet: ${agentKeypair.publicKey.toBase58()}`);

  // ---------------------------------------------------------------------------
  // Step 1 — Hit endpoint with no auth, expect 402 + x402 payload
  // ---------------------------------------------------------------------------
  log(`\nStep 1: GET ${API_BASE}${TARGET_PATH} (no auth)`);

  let x402Payload: any;
  try {
    await axios.get(`${API_BASE}${TARGET_PATH}`);
    console.error('❌  Expected 402 but got 200 — endpoint has no @RequireCredits?');
    process.exit(1);
  } catch (err) {
    const axErr = err as AxiosError;
    if (axErr.response?.status !== 402) {
      // 401 means auth guard blocked us before x402 check — this is wrong
      console.error(`❌  Got ${axErr.response?.status} — expected 402 with x402 payload`);
      console.error('Response:', axErr.response?.data);
      process.exit(1);
    }

    x402Payload = axErr.response.data;
    log(`✅  Got 402`);
    console.log(JSON.stringify(x402Payload, null, 2));

    if (!x402Payload?.x402Version || !Array.isArray(x402Payload?.accepts)) {
      console.error('❌  Not a valid x402 payload (missing x402Version or accepts[])');
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2 — Extract payment requirements
  // ---------------------------------------------------------------------------
  const accept = x402Payload.accepts[0];
  const usdcMint = new PublicKey(accept.asset);
  const treasury = new PublicKey(accept.payTo);
  const amountBaseUnits = BigInt(accept.maxAmountRequired);

  log(`\nStep 2: Payment requirements`);
  log(`  Treasury : ${treasury.toBase58()}`);
  log(`  USDC mint: ${usdcMint.toBase58()}`);
  log(`  Amount   : ${amountBaseUnits} base units ($${(Number(amountBaseUnits) / 10 ** USDC_DECIMALS).toFixed(4)})`);

  // ---------------------------------------------------------------------------
  // Step 3 — Build + sign USDC transferChecked transaction
  // ---------------------------------------------------------------------------
  log(`\nStep 3: Building USDC transferChecked transaction`);

  const agentAta = await getAssociatedTokenAddress(usdcMint, agentKeypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(usdcMint, treasury);

  log(`  Agent ATA  : ${agentAta.toBase58()}`);
  log(`  Treasury ATA: ${treasuryAta.toBase58()}`);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const ix = createTransferCheckedInstruction(
    agentAta,
    usdcMint,
    treasuryAta,
    agentKeypair.publicKey,
    amountBaseUnits,
    USDC_DECIMALS,
    [],
    TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: agentKeypair.publicKey });
  tx.add(ix);
  tx.sign(agentKeypair);

  const txBytes = tx.serialize();
  log(`  Signed tx (${txBytes.length} bytes)`);

  // ---------------------------------------------------------------------------
  // Step 4 — Encode as x402 PaymentPayload (base64 JSON)
  // ---------------------------------------------------------------------------
  log(`\nStep 4: Encoding X-Payment header`);

  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: accept.network,
    payload: { transaction: txBytes.toString('base64') },
  };

  const xPaymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  log(`  Header length: ${xPaymentHeader.length} chars`);

  // ---------------------------------------------------------------------------
  // Step 5 — Retry with X-Payment header, expect 200
  // ---------------------------------------------------------------------------
  log(`\nStep 5: GET ${API_BASE}${TARGET_PATH} with X-Payment header`);

  try {
    const response = await axios.get(`${API_BASE}${TARGET_PATH}`, {
      headers: { 'X-Payment': xPaymentHeader },
    });
    log(`✅  Got ${response.status} — agent payment flow succeeded!`);
    log(`  Response keys: ${Object.keys(response.data).join(', ')}`);
  } catch (err) {
    const axErr = err as AxiosError;
    console.error(`❌  Got ${axErr.response?.status}:`, axErr.response?.data);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 6 — Same header again → must be rejected as replay
  // ---------------------------------------------------------------------------
  log(`\nStep 6: Replay protection check (same X-Payment header)`);

  try {
    await axios.get(`${API_BASE}${TARGET_PATH}`, {
      headers: { 'X-Payment': xPaymentHeader },
    });
    console.error('❌  Replay was accepted — replay protection is broken!');
    process.exit(1);
  } catch (err) {
    const axErr = err as AxiosError;
    if (axErr.response?.status === 402) {
      log(`✅  Replay correctly rejected with 402`);
    } else {
      console.error(`❌  Unexpected status on replay: ${axErr.response?.status}`);
      process.exit(1);
    }
  }

  log(`\n🎉  All steps passed — X402 autonomous agent payment flow working end-to-end.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
