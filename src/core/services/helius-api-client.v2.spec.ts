/* Self-contained V2 pagination + fallback smoke tests (no node:test runner)
   Runs with: npx ts-node -r tsconfig-paths/register src/core/services/helius-api-client.v2.spec.ts
*/
import { HeliusApiClient } from './helius-api-client';
import { SPL_TOKEN_PROGRAM_ID } from '../../config/constants';
import type { GetTokenAccountsByOwnerResult } from '../../types/helius-api';

const LARGE_WALLET = 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';

const makeTokenAccount = (pubkey: string, mint: string) => ({
  pubkey,
  account: {
    data: {
      parsed: {
        info: {
          mint,
          tokenAmount: { amount: '1', decimals: 6, uiAmount: 0.000001, uiAmountString: '0.000001' },
        },
        type: 'account',
      },
    },
    executable: false,
    lamports: 0,
    owner: SPL_TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  },
});

async function testV2Success(): Promise<void> {
  const client = new HeliusApiClient(
    { apiKey: 'test-key', network: 'mainnet', requestsPerSecond: 1000 },
    {} as any
  );

  let v2Page = 0;
  (client as any).api.post = async (_url: string, payload: any) => {
    const method = payload?.method;
    if (method === 'getTokenAccountsByOwnerV2') {
      v2Page += 1;
      if (v2Page === 1) {
        return {
          data: { jsonrpc: '2.0', id: '1', result: { accounts: [makeTokenAccount('acc1', 'mint1'), makeTokenAccount('acc2', 'mint2')], paginationKey: 'key-1', context: { slot: 111 } } }
        };
      }
      return {
        data: { jsonrpc: '2.0', id: '1', result: { accounts: [makeTokenAccount('acc3', 'mint3')], context: { slot: 112 } } }
      };
    }
    throw new Error(`Unexpected method ${method}`);
  };

  const out: GetTokenAccountsByOwnerResult = await client.getTokenAccountsByOwner(
    LARGE_WALLET,
    undefined,
    SPL_TOKEN_PROGRAM_ID,
    'confirmed',
    'jsonParsed'
  );

  if (!(out.value.length === 3)) throw new Error(`V2 Success: expected 3 accounts, got ${out.value.length}`);
  if (!(out.context.slot === 112)) throw new Error(`V2 Success: expected slot 112, got ${out.context.slot}`);
}

async function testV2FallbackToV1(): Promise<void> {
  const client = new HeliusApiClient(
    { apiKey: 'test-key', network: 'mainnet', requestsPerSecond: 1000 },
    {} as any
  );

  (client as any).api.post = async (_url: string, payload: any) => {
    const method = payload?.method;
    if (method === 'getTokenAccountsByOwnerV2') {
      return { data: { jsonrpc: '2.0', id: '1', error: { code: -32601, message: 'Method not found' } } };
    }
    if (method === 'getTokenAccountsByOwner') {
      return { data: { jsonrpc: '2.0', id: '1', result: { context: { slot: 333 }, value: [makeTokenAccount('v1-acc', 'mintX')] } } };
    }
    throw new Error(`Unexpected method ${method}`);
  };

  const out: GetTokenAccountsByOwnerResult = await client.getTokenAccountsByOwner(
    LARGE_WALLET,
    undefined,
    SPL_TOKEN_PROGRAM_ID,
    'confirmed',
    'jsonParsed'
  );

  if (!(out.value.length === 1)) throw new Error(`V2 Fallback: expected 1 account from V1, got ${out.value.length}`);
  if (!(out.context.slot === 333)) throw new Error(`V2 Fallback: expected slot 333, got ${out.context.slot}`);
  if (!((client as any).disableV2ForProcess === true)) throw new Error('V2 Fallback: expected disableV2ForProcess to be true');
}

(async () => {
  try {
    await testV2Success();
    console.log('PASS: V2 pagination aggregates and returns legacy shape');
    await testV2FallbackToV1();
    console.log('PASS: V2 hard-fail triggers V1 fallback and circuit breaker');
  } catch (e: any) {
    console.error('FAIL:', e?.message || e);
    process.exit(1);
  }
})();

