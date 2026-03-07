#!/usr/bin/env ts-node
/**
 * generate-wallet.ts
 *
 * Generates a fresh Solana keypair and prints the public + private keys.
 * Use for creating agent wallets, treasury wallets, test wallets, etc.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/generate-wallet.ts
 */

import { Keypair } from '@solana/web3.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = require('bs58/src/cjs/index.cjs') as { default: { encode: (b: Uint8Array) => string } };

const kp = Keypair.generate();

console.log('\n🔑  New Solana Wallet');
console.log('━'.repeat(60));
console.log('Public key  (wallet address):', kp.publicKey.toBase58());
console.log('Private key (base58, KEEP SECRET):', bs58.default.encode(kp.secretKey));
console.log('━'.repeat(60));
console.log('Fund this wallet before use:');
console.log('  SOL  — ~0.01 SOL for transaction fees');
console.log('  USDC — $1 covers ~13 x402 test calls at $0.075 each\n');
