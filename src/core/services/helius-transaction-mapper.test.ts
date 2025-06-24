import expect from 'node:test';
import * as assert from 'node:assert';
import { mapHeliusTransactionsToIntermediateRecords } from './helius-transaction-mapper';
import { HeliusTransaction } from '../../types/helius-api';

/*
 * Integration-style test for the proportional redistribution logic.
 * Scenario: one transaction where the wallet sells 400 TEST tokens in two chunks
 *           and receives 4 WSOL.  Mapper should create two rows for TEST (out)
 *           with associatedSolValue 1 and 3 respectively.
 */

expect('HeliusTransactionMapper – proportional redistribution', () => {
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

  expect('splits associatedSolValue proportionally across transfer chunks', () => {
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

expect('HeliusTransactionMapper – Mapping Strategies', () => {
  const WALLET = 'TestWallet2222222222222222222222222222222222';
  const TOKEN_A_MINT = 'TokenAMint111111111111111111111111111111111';
  const TOKEN_B_MINT = 'TokenBMint111111111111111111111111111111111';
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

  expect('SPL-to-SPL swap heuristic', () => {
    expect('correctly assigns SOL value when WSOL is an intermediary', () => {
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

  expect('Fee-payer heuristic', () => {
    expect('attributes swap to wallet when it is the feePayer but not in transfers', () => {
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

  expect('Event Matcher logic', () => {
    expect('finds consistent SOL value from innerSwaps and assigns it', () => {
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

  expect('Value Association Fallbacks', () => {
    expect('uses total WSOL movement when event data is absent', () => {
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

    expect('uses net user SOL change as a final fallback', () => {
      const NET_SOL_CHANGE = -0.8; // User's SOL balance decreased
      const txn = {
        description: 'Swap without any other clear signals, relying on net SOL change',
        type: 'SWAP',
        source: 'UNKNOWN',
        fee: 0.000005,
        feePayer: WALLET,
        signature: 'TestSignatureNetChange',
        slot: 6,
        timestamp: 6,
        tokenTransfers: [
          // This time user *receives* the token, so the SOL cost is the net change
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

      assert.strictEqual(stats.associatedValueFromNetChange, 1, 'Value should be derived from net change heuristic');
      assert.ok(tokenA_row, 'Should have a record for TOKEN_A');
      assert.ok(Math.abs(tokenA_row.associatedSolValue - Math.abs(NET_SOL_CHANGE)) < 0.0001, `TOKEN_A should have ~${Math.abs(NET_SOL_CHANGE)} SOL value, got ${tokenA_row.associatedSolValue}`);
    });
  });

  expect('Miscellaneous Scenarios', () => {
    expect('correctly processes native SOL transfers', () => {
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

    expect('identifies small outgoing transfers as fees and zeroes their value', () => {
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