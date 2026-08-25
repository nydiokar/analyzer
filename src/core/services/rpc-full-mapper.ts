/**
 * Clean, balance-delta-first mapper for Helius RPC-full transactions
 * (`getTransactionsForAddress` / `getTransaction` with transactionDetails:"full").
 *
 * WHY A SEPARATE MAPPER:
 * The legacy Enhanced mapper (`helius-transaction-mapper.ts`) is built around the
 * Enhanced `/v0/transactions` shape and carries a large amount of complexity that
 * exists purely to work around Enhanced's defects — the WSOL lamport-scaling bug,
 * `events.swap`-gated fee-payer heuristics, relay de-duplication, SPL-to-SPL
 * reverse-engineering. Enhanced is also not a source of truth: it silently labels
 * swaps on programs it can't parse (e.g. term9YPb, FLASHX) as `TRANSFER` with
 * `associatedSolValue = 0`, destroying cost basis.
 *
 * RPC-full gives us the ground truth directly: pre/post native + token balances.
 * A swap's net effect is exactly the balance delta — it already nets out every
 * router hop, wrap/unwrap and intermediary churn, in reliable raw units. This mapper
 * derives `SwapAnalysisInput` rows from those deltas, only falling back to transfer
 * legs for the one thing deltas can't show: the notional of a token->token swap
 * whose SOL leg passes between AMM pools without touching the wallet.
 *
 * OUTPUT: `SwapAnalysisInput`-shaped rows (pre-enrichment). One row per
 * (mint, direction) per tx — netted, since downstream FIFO/PnL aggregates per mint.
 *
 * SCOPE: read-only / out-of-band. NOT wired into the production sync path. Validated
 * via the shadow harness against persisted baselines before any adoption.
 */

const SOL_MINT = 'So11111111111111111111111111111111111111112'; // native SOL and WSOL share this mint
const STABLE_MINTS = new Set<string>([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', // USD1
]);

// Known AMM/liquidity programs whose position-NFT movements must NOT be classified as token swaps.
// In jsonParsed RPC-full responses, custom programs like these carry no `program` friendly name —
// only `programId` (the raw pubkey). The Enhanced mapper reads the same set from `instruction.programId`.
const LIQUIDITY_PROGRAM_IDS = new Set<string>([
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM
]);

const LAMPORTS_PER_SOL = 1_000_000_000;
// Below this, native/SOL movement is treated as fee/rent noise, not economic value.
const SOL_SIGNIFICANCE = 0.001;
const STABLE_SIGNIFICANCE = 0.01;

/**
 * Returns true if any top-level or inner instruction in the transaction was
 * dispatched to a known AMM/liquidity program.
 *
 * In jsonParsed RPC-full responses each instruction carries `programId` (the
 * raw pubkey string) regardless of whether Solana/Helius knows a friendly name
 * for it. This is the equivalent of `hasLiquidityProgramInteraction` in the
 * Enhanced mapper, which reads the same `instruction.programId` field from
 * Helius's Enhanced-API shape.
 */
function touchesLiquidityProgram(raw: any): boolean {
  const top: any[] = raw?.transaction?.message?.instructions || [];
  for (const ix of top) {
    if (ix?.programId && LIQUIDITY_PROGRAM_IDS.has(ix.programId)) return true;
  }
  for (const group of raw?.meta?.innerInstructions || []) {
    for (const ix of group?.instructions || []) {
      if (ix?.programId && LIQUIDITY_PROGRAM_IDS.has(ix.programId)) return true;
    }
  }
  return false;
}

export interface RpcFullMappedRow {
  walletAddress: string;
  signature: string;
  timestamp: number;
  mint: string;
  amount: number;
  direction: 'in' | 'out';
  associatedSolValue: number;
  associatedUsdcValue: number;
  interactionType: string;
  feeAmount: number | null;
  feePercentage: number | null;
}

export interface RpcFullMapResult {
  rows: RpcFullMappedRow[];
  /** Per-signature notes for validation/triangulation (not persisted). */
  flags: Record<string, string[]>;
}

function accountKeysOf(raw: any): string[] {
  const msg = raw?.transaction?.message;
  const stat: string[] = (msg?.accountKeys || []).map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  return [
    ...stat,
    ...(raw?.meta?.loadedAddresses?.writable || []),
    ...(raw?.meta?.loadedAddresses?.readonly || []),
  ];
}

function signatureOf(raw: any): string {
  if (typeof raw?.signature === 'string') return raw.signature;
  if (Array.isArray(raw?.transaction?.signatures)) return raw.transaction.signatures[0] || '';
  return '';
}

interface MintDelta {
  /** net raw (post - pre) summed across wallet-owned token accounts for this mint */
  rawDelta: bigint;
  decimals: number;
}

/** Net token delta per mint, restricted to token accounts OWNED by `wallet`. */
function ownedTokenDeltas(raw: any, wallet: string): Map<string, MintDelta> {
  const byAccount = new Map<number, { pre: bigint; post: bigint; mint: string; owner: string; decimals: number }>();
  const ingest = (bals: any[], which: 'pre' | 'post') => {
    for (const b of bals || []) {
      const cur = byAccount.get(b.accountIndex) || {
        pre: 0n,
        post: 0n,
        mint: b.mint,
        owner: b.owner,
        decimals: b.uiTokenAmount?.decimals ?? 0,
      };
      cur.mint = b.mint;
      cur.owner = b.owner;
      cur.decimals = b.uiTokenAmount?.decimals ?? cur.decimals;
      cur[which] = BigInt(b.uiTokenAmount?.amount || '0');
      byAccount.set(b.accountIndex, cur);
    }
  };
  ingest(raw?.meta?.preTokenBalances, 'pre');
  ingest(raw?.meta?.postTokenBalances, 'post');

  const byMint = new Map<string, MintDelta>();
  for (const acct of byAccount.values()) {
    if (acct.owner !== wallet) continue;
    const cur = byMint.get(acct.mint) || { rawDelta: 0n, decimals: acct.decimals };
    cur.rawDelta += acct.post - acct.pre;
    cur.decimals = acct.decimals;
    byMint.set(acct.mint, cur);
  }
  return byMint;
}

/**
 * Largest single SOL-denominated and stable transfer anywhere in the tx (top + inner).
 * Used as the notional for token->token swaps where the value leg is routed between AMM
 * pools and never nets into the wallet's balance. The SOL leg may be either WSOL token
 * transfers OR native-SOL system transfers (many routers settle hops in native SOL, not
 * WSOL) — both are the same denomination, so we take the max single hop across both.
 */
function largestRoutedNotional(raw: any): { wsol: number; stable: number } {
  const top: any[] = raw?.transaction?.message?.instructions || [];
  const inner: any[] = (raw?.meta?.innerInstructions || []).flatMap((g: any) => g?.instructions || []);

  // token account -> mint, for resolving plain `transfer` (no mint field) legs.
  const taMint = new Map<string, { mint: string; decimals: number }>();
  const ak = accountKeysOf(raw);
  for (const b of [...(raw?.meta?.preTokenBalances || []), ...(raw?.meta?.postTokenBalances || [])]) {
    const ta = ak[b.accountIndex];
    if (ta) taMint.set(ta, { mint: b.mint, decimals: b.uiTokenAmount?.decimals ?? 0 });
  }

  let wsol = 0;
  let stable = 0;
  for (const ix of [...top, ...inner]) {
    // Native-SOL system transfers (the routed SOL leg when no WSOL token is used).
    if (ix?.program === 'system') {
      const st = ix?.parsed?.type;
      if (st === 'transfer' || st === 'transferWithSeed') {
        const lamports = Number(ix.parsed.info?.lamports || 0);
        if (lamports > 0) wsol = Math.max(wsol, lamports / LAMPORTS_PER_SOL);
      }
      continue;
    }
    if (ix?.program !== 'spl-token' && ix?.program !== 'spl-token-2022') continue;
    const t = ix?.parsed?.type;
    if (t !== 'transfer' && t !== 'transferChecked') continue;
    const info = ix.parsed.info;
    let mint: string | undefined = info.mint;
    let ui: number | undefined = info.tokenAmount?.uiAmount;
    if (!mint) {
      const resolved = taMint.get(info.source) || taMint.get(info.destination);
      if (resolved) {
        mint = resolved.mint;
        if (ui === undefined) ui = Number(info.amount || 0) / Math.pow(10, resolved.decimals);
      }
    }
    if (mint === undefined || ui === undefined) continue;
    if (mint === SOL_MINT) wsol = Math.max(wsol, Math.abs(ui));
    else if (STABLE_MINTS.has(mint)) stable = Math.max(stable, Math.abs(ui));
  }
  return { wsol, stable };
}

function pickDominantStable(stableNet: Map<string, number>): { mint: string; value: number } | null {
  const order = ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB'];
  let best: { mint: string; value: number } | null = null;
  for (const m of order) {
    const v = Math.abs(stableNet.get(m) || 0);
    if (v >= STABLE_SIGNIFICANCE && (!best || v > best.value)) best = { mint: m, value: v };
  }
  if (best) return best;
  // fall back to any stable
  for (const [m, v] of stableNet) {
    if (Math.abs(v) >= STABLE_SIGNIFICANCE && (!best || Math.abs(v) > best.value)) best = { mint: m, value: Math.abs(v) };
  }
  return best;
}

function mapOne(raw: any, wallet: string, flags: Record<string, string[]>): RpcFullMappedRow[] {
  if (!raw?.transaction || !raw?.meta) return [];
  if (raw.meta.err) return []; // failed tx — no economic effect
  const signature = signatureOf(raw);
  const timestamp = raw.blockTime ?? 0;
  const fee = raw.meta.fee ?? 0;
  const ak = accountKeysOf(raw);
  const walletIdx = ak.indexOf(wallet);
  const isFeePayer = ak[0] === wallet;
  const isLiquidityTx = touchesLiquidityProgram(raw);
  const addFlag = (f: string) => {
    (flags[signature] = flags[signature] || []).push(f);
  };

  // --- net deltas ---
  const rawNativeDelta = walletIdx >= 0 ? (raw.meta.postBalances[walletIdx] ?? 0) - (raw.meta.preBalances[walletIdx] ?? 0) : 0;
  // Add back the FULL network fee (base + priority/bot fee) so the SOL notional is a
  // PURE cost basis — the fee is recorded separately on the swap's `feeAmount` line
  // instead of being folded into cost. This keeps FIFO inventory clean (cost = what was
  // paid for the token) and keeps `totalFeesPaidInSol` honest downstream (the similarity
  // service uses `totalFeesPaidInSol > 0` as its "actively traded, paid fees" signal).
  // The fee is only the fee-payer's, so it's added back / recorded only when this wallet
  // signed (paid) the tx. Net PnL is conserved: the fee moves from cost into the fee line.
  const feeSol = isFeePayer ? fee / LAMPORTS_PER_SOL : 0;
  const nativeDeltaSol = (rawNativeDelta + (isFeePayer ? fee : 0)) / LAMPORTS_PER_SOL;

  const mintDeltas = ownedTokenDeltas(raw, wallet);
  let wsolNet = 0;
  const stableNet = new Map<string, number>();
  const assetLegs: Array<{ mint: string; ui: number; direction: 'in' | 'out' }> = [];
  for (const [mint, d] of mintDeltas) {
    if (d.rawDelta === 0n) continue;
    const ui = Number(d.rawDelta) / Math.pow(10, d.decimals);
    if (mint === SOL_MINT) {
      wsolNet += ui;
    } else if (STABLE_MINTS.has(mint)) {
      stableNet.set(mint, (stableNet.get(mint) || 0) + ui);
    } else {
      assetLegs.push({ mint, ui: Math.abs(ui), direction: ui > 0 ? 'in' : 'out' });
    }
  }

  // Combined SOL the wallet realized (native + owned WSOL). Same mint, so additive.
  const netSol = nativeDeltaSol + wsolNet;
  const dominantStable = pickDominantStable(stableNet);

  // Direction of the wallet's net value movement (used to tell swaps from liquidity
  // ops). In a swap the value moves OPPOSITE the asset; in add/remove liquidity the
  // value and asset move the SAME direction.
  const solDir: 'in' | 'out' | null = Math.abs(netSol) >= SOL_SIGNIFICANCE ? (netSol > 0 ? 'in' : 'out') : null;
  const stableSign = dominantStable ? Math.sign(stableNet.get(dominantStable.mint) || 0) : 0;
  const stableDir: 'in' | 'out' | null = stableSign > 0 ? 'in' : stableSign < 0 ? 'out' : null;

  const assetsIn = assetLegs.filter((l) => l.direction === 'in');
  const assetsOut = assetLegs.filter((l) => l.direction === 'out');
  const hasAsset = assetLegs.length > 0;

  let solNotional = Math.abs(netSol) >= SOL_SIGNIFICANCE ? Math.abs(netSol) : 0;
  let stableNotional = dominantStable ? dominantStable.value : 0;

  const rows: RpcFullMappedRow[] = [];
  const push = (mint: string, direction: 'in' | 'out', amount: number, sol: number, usdc: number, interactionType: string) => {
    rows.push({
      walletAddress: wallet,
      signature,
      timestamp,
      mint,
      amount,
      direction,
      associatedSolValue: sol,
      associatedUsdcValue: usdc,
      interactionType,
      feeAmount: null,
      feePercentage: null,
    });
  };

  // Attach the fee-payer's SOL fee to ONE swapped-token leg (the real traded token,
  // never the SOL/stable value leg), mirroring the legacy mapper's one-fee-per-signature
  // attribution. The analyzer sums `feeAmount` into `totalFeesPaidInSol` per token, so
  // putting it on a single leg avoids double-counting on token<->token swaps.
  const attachFee = () => {
    if (feeSol <= 0) return;
    const leg = rows.find(
      (r) => r.interactionType === 'SWAP' && r.mint !== SOL_MINT && !STABLE_MINTS.has(r.mint),
    );
    if (!leg) return;
    leg.feeAmount = feeSol;
    leg.feePercentage = leg.associatedSolValue > 0 ? (feeSol / leg.associatedSolValue) * 100 : null;
  };

  if (hasAsset) {
    const splToSpl = assetsIn.length > 0 && assetsOut.length > 0;

    if (splToSpl) {
      // token <-> token swap notional comes from the routed leg between pools, since
      // the wallet's net SOL/stable on a pure SPL-to-SPL is just rent/fee noise (the
      // value passes between AMMs without netting into the wallet). Pick a SINGLE
      // routing medium — WSOL is the common intermediary; only fall back to a stable
      // when there's no significant WSOL leg. Assigning both would double-count a swap
      // that has one notional value. Prefer the larger of realized-vs-routed so dust
      // never masks the real notional.
      const routed = largestRoutedNotional(raw);
      if (routed.wsol >= SOL_SIGNIFICANCE) {
        solNotional = Math.max(solNotional, routed.wsol);
        stableNotional = 0;
        addFlag('spl-to-spl-routed-sol-notional');
      } else if (routed.stable > stableNotional) {
        stableNotional = routed.stable;
        solNotional = 0;
        addFlag('spl-to-spl-routed-stable-notional');
      }
    } else {
      // Single-direction asset movement. This is a swap ONLY if the wallet's value
      // (SOL/stable) moved in the OPPOSITE direction (buy: asset in / value out;
      // sell: asset out / value in). If value moved the SAME direction as the asset,
      // this is an add/remove-liquidity deposit/withdrawal, not a trade — carry no
      // swap value (matches the baseline's 0-value accounting for LP ops).
      const assetDir: 'in' | 'out' = assetsIn.length > 0 ? 'in' : 'out';
      const opposite: 'in' | 'out' = assetDir === 'in' ? 'out' : 'in';
      const solOpposes = solDir === opposite;
      const stableOpposes = stableDir === opposite;
      if (!solOpposes) solNotional = 0;
      if (!stableOpposes) stableNotional = 0;
      if ((solDir && !solOpposes) || (stableDir && !stableOpposes)) {
        addFlag('value-same-direction-as-asset:liquidity-or-non-swap');
      }
    }

    // LP position open/close: transaction touches a known AMM program AND the only
    // non-value asset legs are true 0-decimal, raw-amount-1 position NFTs.
    //
    // Safety: we check BOTH decimals===0 AND rawDelta===±1n. Checking only uiAmount===1
    // is NOT safe — a 9-decimal token trading exactly 1e9 raw units also produces
    // uiAmount=1. Position NFT mints (Raydium CLMM, Orca Whirlpool) are provably
    // 0-decimal with raw supply=1. Fungible tokens that happen to trade at ui=1 will
    // have decimals>0, so they fall through to normal SWAP classification.
    const onlyPositionNfts =
      assetLegs.length > 0 &&
      assetLegs.every((l) => {
        if (STABLE_MINTS.has(l.mint) || l.mint === SOL_MINT) return false;
        const delta = mintDeltas.get(l.mint);
        return (
          delta !== undefined &&
          delta.decimals === 0 &&
          (delta.rawDelta === 1n || delta.rawDelta === -1n)
        );
      });
    if (isLiquidityTx && onlyPositionNfts) {
      // Determine open vs close by whether the position NFT is entering or leaving.
      const dir = assetsIn.length > 0 && assetsOut.length === 0 ? 'in' : 'out';
      const lpType = dir === 'in' ? 'ADD_LIQUIDITY' : 'REMOVE_LIQUIDITY';
      addFlag(`lp-position-${lpType.toLowerCase()}`);
      for (const l of assetLegs) {
        push(l.mint, l.direction, l.ui, solNotional, stableNotional, lpType);
      }
      attachFee();
      return rows;
    }

    // A token<->token movement is always a swap (you don't "transfer" by exchanging two
    // different tokens) even if we couldn't recover its notional from opaque routing.
    const interactionType = splToSpl || solNotional > 0 || stableNotional > 0 ? 'SWAP' : 'TRANSFER';

    // Distribute notional across legs in each direction proportionally by |amount|.
    // For the common 1-leg-per-direction case this assigns the full notional. Both
    // directions carry the notional (double entry: out = proceeds, in = cost basis).
    const distribute = (legs: typeof assetLegs) => {
      const total = legs.reduce((a, l) => a + l.ui, 0) || 1;
      if (legs.length > 1) addFlag('multi-asset-leg-split');
      for (const l of legs) {
        const share = l.ui / total;
        push(l.mint, l.direction, l.ui, solNotional * share, stableNotional * share, interactionType);
      }
    };
    distribute(assetsOut);
    distribute(assetsIn);
    attachFee();
    return rows;
  }

  // --- no asset: pure value movement (SOL/stable only) ---
  const valueToValue = !!solDir && !!stableDir && solDir !== stableDir;
  const interactionType = valueToValue ? 'SWAP' : 'TRANSFER';

  if (solDir) push(SOL_MINT, solDir, Math.abs(netSol), Math.abs(netSol), 0, interactionType);
  for (const [mint, v] of stableNet) {
    if (Math.abs(v) < STABLE_SIGNIFICANCE) continue;
    push(mint, v > 0 ? 'in' : 'out', Math.abs(v), 0, Math.abs(v), interactionType);
  }
  attachFee();
  if (rows.length === 0) addFlag('no-economic-rows');
  return rows;
}

/**
 * Map RPC-full transactions for a single wallet into `SwapAnalysisInput`-shaped rows.
 * @param walletAddress the wallet being analyzed
 * @param rawTxs standard RPC `transaction`+`meta` objects (full + jsonParsed)
 */
export function mapRpcFullToSwapAnalysisInputs(walletAddress: string, rawTxs: any[]): RpcFullMapResult {
  const flags: Record<string, string[]> = {};
  const rows: RpcFullMappedRow[] = [];
  for (const raw of rawTxs) {
    for (const r of mapOne(raw, walletAddress, flags)) rows.push(r);
  }
  return { rows, flags };
}
