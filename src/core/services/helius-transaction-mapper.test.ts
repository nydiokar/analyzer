import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as pathMod from 'node:path';
import { mapHeliusTransactionsToIntermediateRecords } from './helius-transaction-mapper';
import { HeliusTransaction } from '../../types/helius-api';

/*
 * Integration-style test for the proportional redistribution logic.
 * Scenario: one transaction where the wallet sells 400 TEST tokens in two chunks
 *           and receives 4 WSOL.  Mapper should create two rows for TEST (out)
 *           with associatedSolValue 1 and 3 respectively.
 */

describe('HeliusTransactionMapper – proportional redistribution', () => {
  const WALLET = 'TestWallet1111111111111111111111111111111111';
  const TEST_MINT = 'TestTokenMint11111111111111111111111111111111';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  function makeTokenTransfer(from: string, to: string, amount: number, mint: string) {
    return {
      fromTokenAccount: `${from}TA`,
      toTokenAccount: `${to}TA`,
      fromUserAccount: from,
      toUserAccount: to,
      tokenAmount: amount,
      mint,
      tokenStandard: 'Fungible',
    };
  }

  it('splits associatedSolValue proportionally across transfer chunks', () => {
    const txn: HeliusTransaction = {
      description: '',
      type: 'SWAP',
      source: 'TEST',
      fee: 0,
      feePayer: WALLET,
      signature: 'TestSignature111',
      slot: 1,
      timestamp: 1,
      tokenTransfers: [
        // Two TEST chunks going OUT
        makeTokenTransfer(WALLET, 'Other1', 100, TEST_MINT),
        makeTokenTransfer(WALLET, 'Other2', 300, TEST_MINT),
        // 4 WSOL coming IN
        makeTokenTransfer('Liquidity', WALLET, 4, SOL_MINT),
      ],
      nativeTransfers: [],
      accountData: [],
      instructions: [],
      events: {},
      transactionError: undefined,
    } as HeliusTransaction;

    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);

    const testRows = analysisInputs.filter(r => r.mint === TEST_MINT);
    assert.strictEqual(testRows.length, 2, 'Should create exactly 2 rows for TEST token');

    // Ensure proportional distribution (1 / 3 split)
    // 100 of 400 = 25% => 1 SOL, 300/400 = 75% => 3 SOL
    const first = testRows.find(r => r.amount === 100) || testRows[0];
    const second = testRows.find(r => r.amount === 300) || testRows[1];

    assert.ok(Math.abs(first.associatedSolValue - 1) < 0.0001, `First chunk should have ~1 SOL, got ${first.associatedSolValue}`);
    assert.ok(Math.abs(second.associatedSolValue - 3) < 0.0001, `Second chunk should have ~3 SOL, got ${second.associatedSolValue}`);
    assert.ok(Math.abs(first.associatedSolValue + second.associatedSolValue - 4) < 0.0001, `Total should be ~4 SOL, got ${first.associatedSolValue + second.associatedSolValue}`);
  });
});

describe('HeliusTransactionMapper – Mapping Strategies', () => {
  const WALLET = 'TestWallet2222222222222222222222222222222222';
  const TOKEN_A_MINT = 'TokenAMint111111111111111111111111111111111';
  const TOKEN_B_MINT = 'TokenBMint111111111111111111111111111111111';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USD1_MINT = 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';

  function makeTokenTransfer(from: string, to: string, amount: number, mint: string) {
    return {
      fromTokenAccount: `${from}TA`,
      toTokenAccount: `${to}TA`,
      fromUserAccount: from,
      toUserAccount: to,
      tokenAmount: amount,
      mint,
      tokenStandard: 'Fungible',
    };
  }

  describe('SPL-to-SPL swap heuristic', () => {
    it('correctly assigns SOL value when WSOL is an intermediary', () => {
      const txn = {
        description: 'User swaps TOKEN_A for TOKEN_B via WSOL',
        type: 'SWAP',
        source: 'JUPITER',
        fee: 0.000005,
        feePayer: 'SomeOtherWalletPayer...',
        signature: 'TestSignatureSPLtoSPL',
        slot: 2,
        timestamp: 2,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'Pool1', 100, TOKEN_A_MINT), // User sends 100 TOKEN_A
          makeTokenTransfer('Pool1', WALLET, 2, SOL_MINT), // User receives 2 WSOL
          makeTokenTransfer(WALLET, 'Pool2', 2, SOL_MINT), // User sends 2 WSOL
          makeTokenTransfer('Pool2', WALLET, 50, TOKEN_B_MINT), // User receives 50 TOKEN_B
        ],
        nativeTransfers: [],
        accountData: [
          {
            account: 'any',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [
              // Mock net WSOL change of 0 for the user.
              { userAccount: WALLET, tokenAccount: `${WALLET}TA`, rawTokenAmount: { tokenAmount: '2000000000', decimals: 9 }, mint: SOL_MINT },
              { userAccount: WALLET, tokenAccount: `${WALLET}TA`, rawTokenAmount: { tokenAmount: '-2000000000', decimals: 9 }, mint: SOL_MINT },
            ],
          },
        ],
        events: {},
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);

      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);
      const tokenB_row = analysisInputs.find(r => r.mint === TOKEN_B_MINT);

      assert.ok(tokenA_row, 'Should create a record for TOKEN_A');
      assert.strictEqual(tokenA_row.direction, 'out');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - 2) < 0.0001, `TOKEN_A should have ~2 SOL value, got ${tokenA_row.associatedSolValue}`);

      assert.ok(tokenB_row, 'Should create a record for TOKEN_B');
      assert.strictEqual(tokenB_row.direction, 'in');
      assert.ok(Math.abs(tokenB_row.associatedSolValue - 2) < 0.0001, `TOKEN_B should have ~2 SOL value, got ${tokenB_row.associatedSolValue}`);
    });
  });

  describe('Fee-payer heuristic', () => {
    it('attributes swap to wallet when it is the feePayer but not in transfers', () => {
      const TRADER_WALLET = 'TraderWallet1111111111111111111111111111111';
      const txn = {
        description: 'Wallet is fee payer for another trader\'s swap',
        type: 'SWAP',
        source: 'JUPITER',
        fee: 0.000005,
        feePayer: WALLET, // Our wallet is the fee payer
        signature: 'TestSignatureFeePayer',
        slot: 3,
        timestamp: 3,
        tokenTransfers: [
          // The actual swap happens between TRADER_WALLET and a Pool, our wallet is not involved here.
          makeTokenTransfer(TRADER_WALLET, 'Pool', 100, TOKEN_A_MINT),
          makeTokenTransfer('Pool', TRADER_WALLET, 2, SOL_MINT),
        ],
        nativeTransfers: [],
        accountData: [],
        events: {
          swap: {
            tokenInputs: [{ mint: TOKEN_A_MINT, userAccount: TRADER_WALLET, tokenAmount: 100 }],
            tokenOutputs: [{ mint: SOL_MINT, userAccount: TRADER_WALLET, tokenAmount: 2 }],
          },
        },
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction; // Using unknown for simpler event mock

      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);

      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);
      const wsol_rows = analysisInputs.filter(r => r.mint === SOL_MINT);

      assert.ok(tokenA_row, 'Heuristic should create an OUT record for TOKEN_A');
      assert.strictEqual(tokenA_row.walletAddress, WALLET);
      assert.strictEqual(tokenA_row.direction, 'out');
      assert.strictEqual(tokenA_row.interactionType, 'SWAP_FEE_PAYER');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - 2) < 0.0001, `TOKEN_A row should have associated SOL value of 2, got ${tokenA_row.associatedSolValue}`);

      // The heuristic should NOT create a record for WSOL, as it's the value denominator.
      assert.strictEqual(wsol_rows.length, 0, 'Heuristic should not create a record for the value token (WSOL)');
    });
  });

  describe('Event Matcher logic', () => {
    it('finds consistent SOL value from innerSwaps and assigns it', () => {
      const INTERMEDIARY_SOL_AMOUNT = 5;
      const txn = {
        description: 'User swaps TOKEN_A for TOKEN_B, with events data for intermediary SOL',
        type: 'SWAP',
        source: 'JUPITER',
        fee: 0.000005,
        feePayer: 'SomeOtherWallet',
        signature: 'TestSignatureEventMatcher',
        slot: 4,
        timestamp: 4,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'Pool', 200, TOKEN_A_MINT), // Primary OUT
          makeTokenTransfer('Pool', WALLET, 100, TOKEN_B_MINT), // Primary IN
        ],
        nativeTransfers: [],
        accountData: [],
        events: {
          swap: {
            innerSwaps: [
              {
                tokenInputs: [{ mint: TOKEN_A_MINT, tokenAmount: 200 }],
                tokenOutputs: [{ mint: SOL_MINT, tokenAmount: INTERMEDIARY_SOL_AMOUNT }],
              },
              {
                tokenInputs: [{ mint: SOL_MINT, tokenAmount: INTERMEDIARY_SOL_AMOUNT }],
                tokenOutputs: [{ mint: TOKEN_B_MINT, tokenAmount: 100 }],
              },
            ],
          },
        },
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);

      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);
      const tokenB_row = analysisInputs.find(r => r.mint === TOKEN_B_MINT);

      assert.strictEqual(stats.eventMatcherConsistentSolFound, 1, 'Event matcher should find one consistent SOL value');

      assert.ok(tokenA_row, 'Should create a record for TOKEN_A');
      assert.strictEqual(tokenA_row.direction, 'out');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - INTERMEDIARY_SOL_AMOUNT) < 0.0001, `TOKEN_A should have ~${INTERMEDIARY_SOL_AMOUNT} SOL value, got ${tokenA_row.associatedSolValue}`);

      assert.ok(tokenB_row, 'Should create a record for TOKEN_B');
      assert.strictEqual(tokenB_row.direction, 'in');
      assert.ok(Math.abs(tokenB_row.associatedSolValue - INTERMEDIARY_SOL_AMOUNT) < 0.0001, `TOKEN_B should have ~${INTERMEDIARY_SOL_AMOUNT} SOL value, got ${tokenB_row.associatedSolValue}`);
    });
  });

  describe('Stable USD value handling', () => {
    it('prefers a single stable mint when multiple stable routes are consistent', () => {
      const USDC_VALUE = 10;
      const USD1_VALUE = 10.1;
      const txn = {
        description: 'Swap with consistent USDC + USD1 innerSwaps; choose preferred stable',
        type: 'SWAP',
        source: 'JUPITER',
        fee: 0.000005,
        feePayer: 'SomeOtherWallet',
        signature: 'TestSignatureStableEventMatcher',
        slot: 9,
        timestamp: 9,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'Pool', 100, TOKEN_A_MINT),
          makeTokenTransfer('Pool', WALLET, 50, TOKEN_B_MINT),
        ],
        nativeTransfers: [],
        accountData: [],
        events: {
          swap: {
            innerSwaps: [
              {
                tokenInputs: [{ mint: TOKEN_A_MINT, tokenAmount: 100 }],
                tokenOutputs: [
                  { mint: USDC_MINT, tokenAmount: USDC_VALUE },
                  { mint: USD1_MINT, tokenAmount: USD1_VALUE },
                ],
              },
              {
                tokenInputs: [
                  { mint: USDC_MINT, tokenAmount: USDC_VALUE },
                  { mint: USD1_MINT, tokenAmount: USD1_VALUE },
                ],
                tokenOutputs: [{ mint: TOKEN_B_MINT, tokenAmount: 50 }],
              },
            ],
          },
        },
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);

      assert.ok(tokenA_row, 'Should create a record for TOKEN_A');
      assert.ok(Math.abs(tokenA_row.associatedUsdcValue - USDC_VALUE) < 0.0001, `Should prefer USDC value ${USDC_VALUE}, got ${tokenA_row.associatedUsdcValue}`);
    });

    it('uses WSOL movement when stable routing nets to zero and no event data exists', () => {
      const TOTAL_WSOL_MOVEMENT = 2;
      const txn = {
        description: 'Stable routing in/out should not block WSOL movement heuristic',
        type: 'SWAP',
        source: 'UNKNOWN',
        fee: 0.000005,
        feePayer: WALLET,
        signature: 'TestSignatureStableRoutingWsol',
        slot: 10,
        timestamp: 10,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'Pool', 100, TOKEN_A_MINT),
          makeTokenTransfer('Pool', WALLET, 5, USD1_MINT),
          makeTokenTransfer(WALLET, 'Pool', 5, USD1_MINT),
          makeTokenTransfer('Pool', WALLET, TOTAL_WSOL_MOVEMENT, SOL_MINT),
        ],
        nativeTransfers: [],
        accountData: [],
        events: {},
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);

      assert.strictEqual(stats.associatedValueFromTotalMovement, 1, 'WSOL movement should drive value attribution');
      assert.ok(tokenA_row, 'Should have a record for TOKEN_A');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - TOTAL_WSOL_MOVEMENT) < 0.0001, `TOKEN_A should have ~${TOTAL_WSOL_MOVEMENT} SOL value, got ${tokenA_row.associatedSolValue}`);
    });
  });

  describe('Value Association Fallbacks', () => {
    it('uses total WSOL movement when event data is absent', () => {
      const TOTAL_WSOL_MOVEMENT = 0.5;
      const txn = {
        description: 'Swap without clear event data, relying on total WSOL movement',
        type: 'SWAP',
        source: 'UNKNOWN',
        fee: 0.000005,
        feePayer: 'SomeOtherWallet',
        signature: 'TestSignatureTotalMovement',
        slot: 5,
        timestamp: 5,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'SomeAccount', 50, TOKEN_A_MINT), // User sends 50 TOKEN_A
          // Simulating a swap where user gets 0.5 WSOL and sends it right back out
          // resulting in a total movement of 1.0, but let's test a simple in-out
          makeTokenTransfer('SomeAccount', WALLET, TOTAL_WSOL_MOVEMENT, SOL_MINT),
        ],
        nativeTransfers: [],
        accountData: [
          {
            account: 'any',
            nativeBalanceChange: 0,
            tokenBalanceChanges: [
              { userAccount: WALLET, tokenAccount: `${WALLET}TA`, rawTokenAmount: { tokenAmount: '500000000', decimals: 9 }, mint: SOL_MINT },
            ],
          },
        ],
        events: {}, // No swap event data
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);

      assert.strictEqual(stats.associatedValueFromTotalMovement, 1, 'Value should be derived from total movement heuristic');
      assert.ok(tokenA_row, 'Should have a record for TOKEN_A');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - TOTAL_WSOL_MOVEMENT) < 0.0001, `TOKEN_A should have ~${TOTAL_WSOL_MOVEMENT} SOL value, got ${tokenA_row.associatedSolValue}`);
    });

    it('ignores WSOL movement not involving the user when deriving swap value', () => {
      const USER_WSOL = 25;
      const ROUTER_WSOL = 25;
      const txn = {
        description: 'Router hop WSOL movement should not inflate user swap value',
        type: 'SWAP',
        source: 'UNKNOWN',
        fee: 0.000005,
        feePayer: WALLET,
        signature: 'TestSignatureUserWsolOnly',
        slot: 5,
        timestamp: 5,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'RouterA', USER_WSOL, SOL_MINT),
          makeTokenTransfer('RouterA', 'RouterB', ROUTER_WSOL, SOL_MINT),
          makeTokenTransfer('RouterB', WALLET, 1000, TOKEN_A_MINT),
        ],
        nativeTransfers: [],
        accountData: [],
        events: {}, // No swap event data
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);

      assert.ok(tokenA_row, 'Should have a record for TOKEN_A');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - USER_WSOL) < 0.0001, `TOKEN_A should have ~${USER_WSOL} SOL value, got ${tokenA_row.associatedSolValue}`);
    });

    it('uses net user SOL change when no WSOL movement exists', () => {
      const NET_SOL_CHANGE = -0.8; // User's SOL balance decreased
      const txn = {
        description: 'Swap without any WSOL movement, relying on net SOL change',
        type: 'SWAP',
        source: 'UNKNOWN',
        fee: 0.000005,
        feePayer: WALLET,
        signature: 'TestSignatureNetChange',
        slot: 6,
        timestamp: 6,
        tokenTransfers: [
          // User *receives* the token, so the SOL cost is the net change
          makeTokenTransfer('SomeAccount', WALLET, 20, TOKEN_A_MINT),
        ],
        nativeTransfers: [],
        accountData: [
          {
            account: WALLET,
            nativeBalanceChange: NET_SOL_CHANGE * 1e9, // Mock the native balance change in lamports
            tokenBalanceChanges: [],
          },
        ],
        events: {},
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);

      // Net SOL change is picked up in "Total Movement" heuristic (step 3) when there's no WSOL movement
      assert.strictEqual(stats.associatedValueFromTotalMovement, 1, 'Value should be derived from total movement heuristic (includes net change)');
      assert.ok(tokenA_row, 'Should have a record for TOKEN_A');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - Math.abs(NET_SOL_CHANGE)) < 0.0001, `TOKEN_A should have ~${Math.abs(NET_SOL_CHANGE)} SOL value, got ${tokenA_row.associatedSolValue}`);
    });

    it('skips net SOL change when it equals just the fee (airdrop scenario)', () => {
      const SMALL_FEE = 0.000005;
      const txn = {
        description: 'Airdrop where user only pays fee, no economic value exchanged',
        type: 'SWAP',
        source: 'UNKNOWN',
        fee: SMALL_FEE,
        feePayer: WALLET,
        signature: 'TestSignatureAirdrop',
        slot: 7,
        timestamp: 7,
        tokenTransfers: [
          // User receives tokens for free (airdrop)
          makeTokenTransfer('AirdropAccount', WALLET, 1000, TOKEN_A_MINT),
        ],
        nativeTransfers: [],
        accountData: [
          {
            account: WALLET,
            // Net change is approximately just the fee (user paid fee but got free tokens)
            nativeBalanceChange: -SMALL_FEE * 1e9,
            tokenBalanceChanges: [],
          },
        ],
        events: {},
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_row = analysisInputs.find(r => r.mint === TOKEN_A_MINT);

      // The net SOL change is just the fee, so it shouldn't be used as economic value
      // This is an airdrop with zero cost basis
      assert.ok(tokenA_row, 'Should have a record for TOKEN_A');
      assert.strictEqual(tokenA_row.associatedSolValue, 0, 'Airdrop should have 0 SOL cost basis, not the fee amount');
    });
  });

  describe('Miscellaneous Scenarios', () => {
    it('correctly processes native SOL transfers', () => {
      const txn = {
        description: 'Simple native SOL transfer',
        type: 'TRANSFER',
        source: 'SYSTEM_PROGRAM',
        fee: 0.000005,
        feePayer: WALLET,
        signature: 'TestSignatureNativeSol',
        slot: 7,
        timestamp: 7,
        tokenTransfers: [],
        nativeTransfers: [
          { fromUserAccount: WALLET, toUserAccount: 'Recipient', amount: 0.5 * 1e9 },
          { fromUserAccount: 'Sender', toUserAccount: WALLET, amount: 0.2 * 1e9 },
        ],
        accountData: [],
        events: {},
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const solRows = analysisInputs.filter(r => r.mint === SOL_MINT);
      const outgoingRow = solRows.find(r => r.direction === 'out');
      const incomingRow = solRows.find(r => r.direction === 'in');

      assert.strictEqual(solRows.length, 2, 'Should have two records for SOL');
      assert.ok(outgoingRow, 'Should have an outgoing SOL record');
      assert.ok(Math.abs(outgoingRow.amount - 0.5) < 0.0001, `Outgoing amount should be 0.5, got ${outgoingRow.amount}`);
      assert.ok(Math.abs(outgoingRow.associatedSolValue - 0.5) < 0.0001, 'Associated value should match amount');

      assert.ok(incomingRow, 'Should have an incoming SOL record');
      assert.ok(Math.abs(incomingRow.amount - 0.2) < 0.0001, `Incoming amount should be 0.2, got ${incomingRow.amount}`);
      assert.ok(Math.abs(incomingRow.associatedSolValue - 0.2) < 0.0001, 'Associated value should match amount');
    });

    it('identifies small outgoing transfers as fees and zeroes their value', () => {
      const txn = {
        description: 'Swap with a primary transfer and a small secondary "fee" transfer',
        type: 'SWAP',
        source: 'JUPITER',
        fee: 0.000005,
        feePayer: WALLET,
        signature: 'TestSignatureSmallFee',
        slot: 8,
        timestamp: 8,
        tokenTransfers: [
          makeTokenTransfer(WALLET, 'Pool', 100, TOKEN_A_MINT), // Primary transfer
          makeTokenTransfer(WALLET, 'FeeTaker', 0.1, TOKEN_A_MINT), // Small fee-like transfer
          makeTokenTransfer('Pool', WALLET, 5, SOL_MINT), // User receives 5 WSOL
        ],
        nativeTransfers: [],
        accountData: [],
        events: {},
        instructions: [],
        transactionError: undefined,
      } as unknown as HeliusTransaction;

      const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
      const tokenA_rows = analysisInputs.filter(r => r.mint === TOKEN_A_MINT);
      const primaryRow = tokenA_rows.find(r => Math.abs(r.amount) === 100);
      const feeRow = tokenA_rows.find(r => Math.abs(r.amount) === 0.1);

      assert.strictEqual(stats.smallOutgoingHeuristicApplied, 1, 'Small outgoing heuristic should be applied');
      
      assert.ok(primaryRow, 'Should have a record for the primary transfer');
      assert.ok(primaryRow.associatedSolValue > 0, 'Primary transfer should have an associated SOL value');

      assert.ok(feeRow, 'Should have a record for the fee transfer');
      assert.strictEqual(feeRow.associatedSolValue, 0, `Fee transfer's associated value should be zeroed out, got ${feeRow.associatedSolValue}`);
    });
  });
});

describe('HeliusTransactionMapper – Final Filtering Logic', () => {
    const WALLET = 'TestWallet3333333333333333333333333333333333';
    const TOKEN_A_MINT = 'TokenAMint111111111111111111111111111111111';
    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    function makeTokenTransfer(from: string, to: string, amount: number, mint: string) {
        return {
            fromTokenAccount: `${from}TA`, toTokenAccount: `${to}TA`, fromUserAccount: from, toUserAccount: to,
            tokenAmount: amount, mint, tokenStandard: 'Fungible',
        };
    }

    const mockTxHeader = (sig: string, type: string) => ({
        description: '', type, source: 'TEST', fee: 0, feePayer: WALLET, signature: sig, slot: 1, timestamp: 1,
        nativeTransfers: [], accountData: [], events: {}, instructions: [], transactionError: undefined,
    });

    it('keeps SOL rows with significant associated value in DeFi transactions (2026-01-26 fix)', () => {
        const txn = {
            ...mockTxHeader('DeFiTx', 'SWAP'),
            tokenTransfers: [
                makeTokenTransfer(WALLET, 'Other', 10, TOKEN_A_MINT),
                makeTokenTransfer('Other', WALLET, 1, SOL_MINT),
            ],
        } as unknown as HeliusTransaction;

        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
        // After Jan 26 fix: We now KEEP SOL/USDC transfers with significant associated value
        // This is correct - the 1 SOL has value and should be tracked
        assert.strictEqual(analysisInputs.length, 2, 'Should contain both TOKEN_A and SOL records');
        const tokenARow = analysisInputs.find(r => r.mint === TOKEN_A_MINT);
        const solRow = analysisInputs.find(r => r.mint === SOL_MINT);
        assert.ok(tokenARow, 'Should have TOKEN_A record');
        assert.ok(solRow, 'Should have SOL record with significant value');
        assert.ok(solRow.associatedSolValue >= 0.0001, 'SOL row should have significant associated value');
    });

    it('keeps significant standalone SOL transfers', () => {
        const txn = {
            ...mockTxHeader('DirectTransfer', 'TRANSFER'),
            tokenTransfers: [],
            nativeTransfers: [{ fromUserAccount: WALLET, toUserAccount: 'Recipient', amount: 0.5 * 1e9 }],
        } as unknown as HeliusTransaction;

        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
        assert.strictEqual(analysisInputs.length, 1, 'Should keep the significant SOL transfer record');
        assert.strictEqual(analysisInputs[0].mint, SOL_MINT);
        assert.ok(Math.abs(analysisInputs[0].amount - 0.5) < 0.0001);
    });

    it('removes dust standalone SOL transfers', () => {
        const txn = {
            ...mockTxHeader('DustTransfer', 'TRANSFER'),
            tokenTransfers: [],
            nativeTransfers: [{ fromUserAccount: 'Sender', toUserAccount: WALLET, amount: 0.0005 * 1e9 }],
        } as unknown as HeliusTransaction;

        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);
        assert.strictEqual(analysisInputs.length, 0, 'Should filter out the dust SOL transfer record');
    });
});

describe('HeliusTransactionMapper – Jito MEV Heuristic for UNKNOWN transactions', () => {
    const WALLET = 'TestWallet4444444444444444444444444444444444';
    const TOKEN_A_MINT = 'TokenAMint111111111111111111111111111111111';
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const JITO_PROGRAM_ID = 'jitodontfront111111111111111118694981111111';

    function makeTokenTransfer(from: string, to: string, amount: number, mint: string) {
        return {
            fromTokenAccount: `${from}TA`,
            toTokenAccount: `${to}TA`,
            fromUserAccount: from,
            toUserAccount: to,
            tokenAmount: amount,
            mint,
            tokenStandard: 'Fungible',
        };
    }

    it('processes an UNKNOWN transaction that has a Jito MEV interaction', () => {
        const txn = {
            description: 'UNKNOWN swap but with Jito MEV protection, should be processed',
            type: 'UNKNOWN',
            source: 'UNKNOWN',
            fee: 5000,
            feePayer: WALLET,
            signature: 'TestSignatureJitoPresent',
            slot: 9,
            timestamp: 9,
            tokenTransfers: [
                makeTokenTransfer(WALLET, 'Pool', 10, TOKEN_A_MINT),
                makeTokenTransfer('Pool', WALLET, 1, SOL_MINT),
            ],
            nativeTransfers: [],
            accountData: [],
            events: {},
            instructions: [
                {
                    accounts: [],
                    data: 'some_data',
                    programId: JITO_PROGRAM_ID,
                    innerInstructions: [],
                }
            ],
            transactionError: undefined,
        } as unknown as HeliusTransaction;

        const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);

        // After Jan 26 fix: SOL rows with significant value are now kept
        assert.strictEqual(analysisInputs.length, 2, 'Should process the transaction and generate two input records (TOKEN_A + SOL)');
        assert.strictEqual(stats.unknownTxSkippedNoJito, 0, 'Should not skip any transaction');
        const tokenARow = analysisInputs.find(r => r.mint === TOKEN_A_MINT);
        const solRow = analysisInputs.find(r => r.mint === SOL_MINT);
        assert.ok(tokenARow, 'Should have TOKEN_A record');
        assert.ok(solRow, 'Should have SOL record');
    });

    it('skips an UNKNOWN transaction that lacks a Jito MEV interaction', () => {
        const txn = {
            description: 'UNKNOWN transaction, likely liquidity provisioning, no Jito, should be skipped',
            type: 'UNKNOWN',
            source: 'UNKNOWN',
            fee: 5000,
            feePayer: WALLET,
            signature: 'TestSignatureJitoAbsent',
            slot: 10,
            timestamp: 10,
            tokenTransfers: [
                makeTokenTransfer(WALLET, 'LiquidityPool', 10, TOKEN_A_MINT),
                makeTokenTransfer(WALLET, 'LiquidityPool', 1, SOL_MINT),
            ],
            nativeTransfers: [],
            accountData: [],
            events: {},
            instructions: [ // No Jito program ID here
                {
                    accounts: [],
                    data: 'some_data',
                    programId: 'SomeOtherProgram111111111111111111111111111',
                    innerInstructions: [],
                }
            ],
            transactionError: undefined,
        } as unknown as HeliusTransaction;

        const { analysisInputs, stats } = mapHeliusTransactionsToIntermediateRecords(WALLET, [txn]);

        assert.strictEqual(analysisInputs.length, 0, 'Should skip the transaction entirely');
        assert.strictEqual(stats.unknownTxSkippedNoJito, 1, 'Should increment the skipped counter');
    });
});

describe('HeliusTransactionMapper - Liquidity-style transfer guard', () => {
  const OUTPUT_DIR = pathMod.join(process.cwd(), 'debug_output');
  const TOKEN_MINT = 'EiqNgtwFzHqTEa3UV57s2x4svjJF59URgBqnG3sCpump';
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const METEORA_DLMM_PROGRAM_ID = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

  function readFixture(filename: string): HeliusTransaction {
    const filePath = pathMod.join(OUTPUT_DIR, filename);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as HeliusTransaction;
  }

  it('keeps inventory but zeros economic value for the first DLMM receipt fixture', () => {
    const wallet = '9UhK6E1txXVQayGr7CqYhxAR2zc8NmCwWLdRZhtizu4b';
    const tx = readFixture('zmJh5PL7yCA8PkPeLUr6dsD7AD1VG8BRKGnd4kLDVUh4ckqo6FM3N9ThwPbysiGAa9HuxnYHX3eDnsjuSPconBB_raw.json');

    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(wallet, [tx]);

    assert.ok(analysisInputs.some((row) => row.mint === TOKEN_MINT), 'Should keep the token receipt rows for inventory');
    assert.ok(analysisInputs.every((row) => row.mint !== SOL_MINT), 'Temporary SOL mechanics should be filtered out');
    assert.ok(
      analysisInputs.every((row) => row.associatedSolValue === 0 && row.associatedUsdcValue === 0),
      'Liquidity-style receipt should not carry economic value attribution',
    );
  });

  it('keeps inventory but zeros economic value for the second DLMM receipt fixture', () => {
    const wallet = '2MhZ9uwE8entCKezwVkAZHQXBnfNktiWnM38RcGB5SF9';
    const tx = readFixture('5fnpFpd7XHKskgYGrkmcsp5d6ckcNmfhU8MF4xvov2a1VVDrVqf6bsd7Ph7ZMh14mEwS9CpEPBENFb3aGjug4Uyh_raw.json');

    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(wallet, [tx]);

    assert.ok(analysisInputs.some((row) => row.mint === TOKEN_MINT), 'Should keep the token receipt rows for inventory');
    assert.ok(analysisInputs.every((row) => row.mint !== SOL_MINT), 'Temporary SOL mechanics should be filtered out');
    assert.ok(
      analysisInputs.every((row) => row.associatedSolValue === 0 && row.associatedUsdcValue === 0),
      'Liquidity-style receipt should not carry economic value attribution',
    );
  });

  it('does not suppress a transfer-labeled AMM flow when token directions are opposite', () => {
    const wallet = 'TestWallet5555555555555555555555555555555555';
    const tempWsolAta = 'TempWsolAta5555555555555555555555555555555';
    const tokenMint = 'TokenCMint111111111111111111111111111111111';

    const tx = {
      description: 'Transfer-labeled AMM swap-like flow',
      type: 'TRANSFER',
      source: 'SYSTEM_PROGRAM',
      fee: 5000,
      feePayer: wallet,
      signature: 'TestSignatureLiquidityGuardCounterexample',
      slot: 11,
      timestamp: 11,
      tokenTransfers: [
        {
          fromTokenAccount: `${wallet}TokenAta`,
          toTokenAccount: 'PoolTokenAta',
          fromUserAccount: wallet,
          toUserAccount: 'PoolAuthority',
          tokenAmount: 100,
          mint: tokenMint,
          tokenStandard: 'Fungible',
        },
        {
          fromTokenAccount: 'PoolWsolAta',
          toTokenAccount: tempWsolAta,
          fromUserAccount: 'PoolAuthority',
          toUserAccount: wallet,
          tokenAmount: 2,
          mint: SOL_MINT,
          tokenStandard: 'Fungible',
        },
      ],
      nativeTransfers: [
        { fromUserAccount: wallet, toUserAccount: tempWsolAta, amount: 2039280 },
        { fromUserAccount: tempWsolAta, toUserAccount: wallet, amount: 2000000000 },
      ],
      accountData: [],
      events: {},
      instructions: [
        {
          accounts: [],
          data: 'amm',
          programId: METEORA_DLMM_PROGRAM_ID,
          innerInstructions: [],
        },
      ],
      transactionError: undefined,
    } as unknown as HeliusTransaction;

    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(wallet, [tx]);
    const tokenRow = analysisInputs.find((row) => row.mint === tokenMint);

    assert.ok(tokenRow, 'Should keep the token row');
    assert.ok(tokenRow.associatedSolValue > 0, 'Opposite-direction flow should still retain SOL attribution');
  });
});

describe('HeliusTransactionMapper - Fixture regression', () => {
  const OUTPUT_DIR = pathMod.join(process.cwd(), 'debug_output');
  const FLOAT_TOLERANCE = 1e-6;

  // Set UPDATE_FIXTURES=1 environment variable to regenerate fixture files
  const UPDATE_FIXTURES = process.env.UPDATE_FIXTURES === '1';

  function readJson(filename: string) {
    const filePath = pathMod.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  function writeJson(filename: string, data: any) {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const filePath = pathMod.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  function sortRows(rows: Array<Record<string, any>>) {
    return [...rows].sort((a, b) => {
      const keyA = `${a.signature}:${a.mint}:${a.direction}:${a.amount}`;
      const keyB = `${b.signature}:${b.mint}:${b.direction}:${b.amount}`;
      return keyA.localeCompare(keyB);
    });
  }

  function assertClose(actual: number | null | undefined, expected: number | null | undefined, label: string) {
    const normalizedActual = actual ?? null;
    const normalizedExpected = expected ?? null;
    if (normalizedActual === null || normalizedExpected === null) {
      assert.strictEqual(normalizedActual, normalizedExpected, `${label} should be ${normalizedExpected}`);
      return;
    }
    assert.ok(
      Math.abs(normalizedActual - normalizedExpected) < FLOAT_TOLERANCE,
      `${label} should be ${normalizedExpected}, got ${normalizedActual}`,
    );
  }

  function verifyFixture(signature: string) {
    const rawTx = readJson(`${signature}_raw.json`) as HeliusTransaction | null;
    let expectedRows = readJson(`${signature}_database_rows.json`) as Array<Record<string, any>> | null;

    // If raw transaction doesn't exist, skip the test with a helpful message
    if (!rawTx) {
      console.log(`⚠️  Skipping ${signature}: Missing _raw.json fixture file.`);
      console.log(`   Run: pnpm debug:mapper ${signature} -w <WALLET_ADDRESS>`);
      console.log(`   to generate the fixture files in debug_output/`);
      return;
    }

    // Extract wallet from existing fixture or use a placeholder
    const wallet = expectedRows?.[0]?.walletAddress || 'WALLET_ADDRESS_NEEDED';
    const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(wallet, [rawTx]);

    // If UPDATE_FIXTURES mode or expected rows don't exist, regenerate them
    if (UPDATE_FIXTURES || !expectedRows) {
      console.log(`📝 ${UPDATE_FIXTURES ? 'Updating' : 'Generating'} fixture for ${signature}`);
      writeJson(`${signature}_database_rows.json`, analysisInputs);
      expectedRows = analysisInputs;

      if (!UPDATE_FIXTURES) {
        console.log(`✅ Generated fixture file: ${signature}_database_rows.json`);
        return; // Skip comparison on first generation
      }
    }

    assert.ok(expectedRows.length > 0, 'Fixture should contain expected rows');

    assert.strictEqual(
      analysisInputs.length,
      expectedRows.length,
      `Expected ${expectedRows.length} rows, got ${analysisInputs.length}`,
    );

    const actualSorted = sortRows(analysisInputs);
    const expectedSorted = sortRows(expectedRows);

    for (let i = 0; i < expectedSorted.length; i += 1) {
      const actual = actualSorted[i] as Record<string, any>;
      const expected = expectedSorted[i];
      assert.strictEqual(actual.walletAddress, expected.walletAddress, 'walletAddress mismatch');
      assert.strictEqual(actual.signature, expected.signature, 'signature mismatch');
      assert.strictEqual(actual.timestamp, expected.timestamp, 'timestamp mismatch');
      assert.strictEqual(actual.mint, expected.mint, 'mint mismatch');
      assertClose(actual.amount, expected.amount, 'amount');
      assert.strictEqual(actual.direction, expected.direction, 'direction mismatch');
      assertClose(actual.associatedSolValue, expected.associatedSolValue, 'associatedSolValue');
      assertClose(actual.associatedUsdcValue, expected.associatedUsdcValue, 'associatedUsdcValue');
      assert.strictEqual(actual.interactionType, expected.interactionType, 'interactionType mismatch');
      assertClose(actual.feeAmount, expected.feeAmount, 'feeAmount');
      assertClose(actual.feePercentage, expected.feePercentage, 'feePercentage');
    }
  }

  // Re-enabled (2026-01-26): Auto-generates fixtures from debug_output/ _raw.json files
  //
  // How it works:
  // 1. First, generate raw transaction data using debug:mapper script:
  //    pnpm debug:mapper <SIGNATURE> -w <WALLET_ADDRESS>
  //    This creates <SIGNATURE>_raw.json in debug_output/
  //
  // 2. Run tests normally - they will auto-generate _database_rows.json fixtures
  //    from the _raw.json files on first run
  //
  // 3. To update all fixtures after mapper changes:
  //    UPDATE_FIXTURES=1 pnpm test
  //
  // 4. Keep debug_output/ in version control (remove from .gitignore) to preserve fixtures
  //
  it('matches USD1 routing fixture output', () => {
    verifyFixture('2qajRsuMmRyguEkuG94b52iFwvG6Lk45yQbSs9Fkay7MJqpfoCMQW9sVD3pRnCLG5C3a9JhQedYirVFnqNYoXwFM');
  });

  it('matches WSOL movement with stable routing fixture output', () => {
    verifyFixture('kCTmj2gogfiBKqch9QB8kw7UK1M26cW9cENK8fS6hXAeQ6USyDfy3aewCQXqJ6WchmYPYUiqE8zbubHK4M2KR3U');
  });

  it('matches SPL-to-SPL fixture output', () => {
    verifyFixture('3zpdKaPGK2cCN2AoaiVJfsTiYqBPeeYfRq8RXF5qHPi9t9JUvtrg6hH8UFw5Q3KrzPQ3BLcw2hyZzAcK2ufDvttB');
  });

  it('matches multi-hop stable routing fixture output', () => {
    verifyFixture('wdLCBpZFJXmV1uThjVNU3VuvzM44QR5v61oGq22BHPGWXJNUAtxjF9dCNFcmoikwgFLJxciAcPZzFbS8bsA7j79');
  });

  // 2026-01-26: Regression test for burn detection bug fix
  // Bug: SPL → USDC swaps were incorrectly flagged as burns when toUserAccount was empty
  // This fixture validates that token OUT correctly gets associatedUsdcValue from stable movement
  it('correctly maps SPL to stablecoin swap (not a burn) - regression for 2026-01-26 fix', () => {
    verifyFixture('7LvoT6YeDKCrkwMK6bFnaw8TKrJeo811V8pphX2S2X1J4YTAfb6Nq7ZKX2hk4PQSfCRNpXddTqMAXFLvudQbXvF');
  });

  // 2026-01-26: Regression test for the reverse case (buy)
  it('correctly maps stablecoin to SPL swap (buy) - regression for 2026-01-26 fix', () => {
    verifyFixture('5e2jKVQqazA4TFFTuMCXtLj57xj8mH9ccxLXyWfUo35LVFpUMd45aY4KHzpmh5RwAp8pzr8oCGD8aA6HnvXaXDNB');
  });
});
