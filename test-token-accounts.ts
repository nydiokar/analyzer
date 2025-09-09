#!/usr/bin/env node

import { HeliusApiClient } from './src/core/services/helius-api-client';
import { HELIUS_CONFIG } from './src/config/constants';
import dotenv from 'dotenv';

dotenv.config();

async function testTokenAccounts() {
  const whaleWallet = 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';
  const emptyWallet = 'BVi97iJ2HDaMWSNEMuDd49gZH9HxQzXSMdoUKgpnaLVs'; // From your logs showing Count: 0
  
  console.log('🧪 Testing Helius V2 Token Accounts API');
  console.log('==========================================');
  
  const client = new HeliusApiClient({
    apiKey: process.env.HELIUS_API_KEY!,
    baseUrl: process.env.HELIUS_RPC_URL!,
    requestsPerSecond: HELIUS_CONFIG.DEFAULT_RPS,
  }, null as any);

  // Test 1: Whale wallet (should have lots of tokens)
  console.log(`\n🐋 Testing whale wallet: ${whaleWallet}`);
  try {
    const result1 = await client.getTokenAccountsByOwner(whaleWallet);
    console.log(`✅ Result: ${result1.value.length} token accounts found`);
    if (result1.value.length > 0) {
      console.log(`   First token: ${JSON.stringify(result1.value[0], null, 2).slice(0, 200)}...`);
    }
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }

  // Test 2: Empty wallet (should have 0 tokens)  
  console.log(`\n🔍 Testing empty wallet: ${emptyWallet}`);
  try {
    const result2 = await client.getTokenAccountsByOwner(emptyWallet);
    console.log(`✅ Result: ${result2.value.length} token accounts found`);
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }

  console.log('\n✨ Test completed!');
  process.exit(0);
}

testTokenAccounts().catch(console.error);