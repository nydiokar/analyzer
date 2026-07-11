/**
 * SPEC002_T04 — Metric-learning label extractor (READ-ONLY against source tables).
 *
 * Materializes the training-ready label ledger (MetricLearningLabel) from existing
 * operational data per the T03 pair contract:
 *   .ai/context/SPEC002_LABEL_READINESS_2026-07-07.md  (§4 pairs, §5 split, §6 thresholds)
 *
 * This script TRAINS NOTHING and SERVES NOTHING. It only reads source tables
 * (WalletHuntSnapshot, WalletHunt, RadarHolding, WalletVector) and writes the
 * additive MetricLearningLabel ledger. Re-running is idempotent — the unique
 * (walletA, walletB, source) key means no duplicate rows are produced.
 *
 * Rules implemented:
 *   - P1 positives: hunt cross-token co-occurrence. Within a hunt with >=2 distinct
 *     tokens, any two wallets that BOTH appear in >=2 of the hunt's tokens form a
 *     positive pair. weight = min(appearanceCount)/uniqueTokenCount (mirrors
 *     computeCandidates in wallet-hunt.service.ts).
 *   - N1 negatives: cross-hunt disjoint. One wallet from hunt A, one from hunt B,
 *     where A and B share NO tokens and the wallets never co-occur in any snapshot.
 *     Sampled to balance positives; hard-negative-mined by preferring pairs the
 *     engineered cosine (WalletVector <=>) currently rates as SIMILAR. The label
 *     still comes from cross-hunt disjointness — the cosine only orders sampling.
 *
 * Exclusions (T03 §4.3, dispatch §2):
 *   - Single-snapshot hunts (no confirmed cross-token pair).
 *   - Archived hunts are still valid label evidence (archive != delete) and are
 *     INCLUDED; only hunts that yield no cross-token confirmation are skipped.
 *   - RadarHolding 'unreviewed' -> unlabeled, excluded.
 *   - RadarHolding 'ignored' where reviewSource != 'analyst' -> excluded
 *     (dust/housekeeping pollution). Analyst-ignored are single (wallet,token)
 *     verdicts, not pairs, so they are only COUNTED in the summary as a future
 *     signal — never written as a self-pair or a training negative (T03 §4.3).
 *
 * Split (T03 §5): split unit is the connected COMPONENT of hunts (hunts linked by
 * a shared wallet), with a time-based OOS holdout, baked into splitBucket per row.
 * A ring's wallets can span multiple hunts; splitting per-hunt would leak the ring
 * across train/dev/oos, so the whole component goes to one bucket.
 *
 * Run (Windows / PowerShell):
 *   npx ts-node -r tsconfig-paths/register scripts/spec002-extract-labels.ts
 *   npx ts-node -r tsconfig-paths/register scripts/spec002-extract-labels.ts --dry-run
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../src/core/services/database-service';
import { isValidSolanaAddress } from '../src/api/shared/solana-address.pipe';

// ---- Tunables (kept conservative; §5 recommends N=4 weeks OOS) --------------
const OOS_WEEKS = 4;
const DEV_FRACTION = 0.2; // ~80/20 train/dev among non-OOS hunts
const NEGATIVE_BALANCE_RATIO = 1.0; // #negatives ≈ #positives
const HARD_NEGATIVE_TARGET_SHARE = 0.8; // prefer cosine-similar negatives
const TRIVIAL_NEGATIVE_CAP_SHARE = 0.2; // §4.2: cap easy negatives
const NEGATIVE_CANDIDATE_MULTIPLIER = 8; // reservoir over-sampling factor
const BATCH_SIZE = 500;
// Defensive cap: TOP_HOLDERS is RPC-bounded (~20), but `holders` is an untyped
// String[] and `sourceType` is a free string. Cap the holder set used for O(k^2)
// co-occurrence/pairing so a malformed oversized array cannot blow up memory.
const MAX_HOLDER_SET_SIZE = 500;

const P1_SOURCE = 'P1_hunt_cross_token';
const N1_SOURCE = 'N1_cross_hunt_disjoint';

type SplitBucket = 'train' | 'dev' | 'oos';

interface HuntSnapshotRow {
  huntId: string;
  tokenMint: string;
  holders: string[];
  capturedAt: Date;
}

interface HuntGroup {
  huntId: string;
  tokens: Set<string>;
  // wallet -> set of tokens it appears in within this hunt
  walletTokens: Map<string, Set<string>>;
  latestCapturedAt: Date;
  split: SplitBucket;
}

interface LabelRow {
  walletA: string;
  walletB: string;
  label: 'positive' | 'negative' | 'ambiguous';
  source: string;
  huntId: string | null;
  reviewerId: string | null;
  confidence: number | null;
  splitBucket: SplitBucket | null;
}

/** Canonicalize an unordered wallet pair so walletA < walletB. */
function orderPair(w1: string, w2: string): [string, string] {
  return w1 < w2 ? [w1, w2] : [w2, w1];
}

function pairKey(a: string, b: string): string {
  const [x, y] = orderPair(a, b);
  return `${x}|${y}`;
}

/** Deterministic 0..1 hash of a string (FNV-1a) for stable train/dev assignment. */
function hashUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 to unsigned, scale to [0,1)
  return (h >>> 0) / 0xffffffff;
}

/**
 * Minimal union-find over string keys. Used to group hunts into connected
 * components: any two hunts sharing a wallet belong to the same component and
 * therefore MUST land in the same split bucket. Splitting per-hunt (not per
 * component) leaks a ring's wallets across the train/dev/oos boundary — the exact
 * failure T03 §5 forbids.
 */
class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x);
    if (root === undefined) {
      this.parent.set(x, x);
      return x;
    }
    while (root !== x) {
      const next = this.parent.get(root)!;
      this.parent.set(root, this.parent.get(next) ?? next); // path halving
      x = root;
      root = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const warnings: string[] = [];

  // -------------------------------------------------------------------------
  // 1) Load hunt snapshots (INCLUDING archived hunts — archive != delete).
  //    Read-only. We only need holders + token + capturedAt per snapshot.
  // -------------------------------------------------------------------------
  const snapshots = (await prisma.walletHuntSnapshot.findMany({
    select: { huntId: true, tokenMint: true, holders: true, capturedAt: true },
  })) as HuntSnapshotRow[];

  // Group by hunt, validating wallet addresses (skip malformed with a counted warning).
  const hunts = new Map<string, HuntGroup>();
  let skippedMalformed = 0;
  let oversizedSnapshots = 0;
  // Normalize holder sets once (validate + cap + dedup) so every downstream pass
  // uses identical, bounded wallet lists.
  const normalizedHolders = new Map<string, string[]>(); // snapshot identity -> holders
  for (const s of snapshots) {
    let valid = Array.from(new Set(s.holders.filter(isValidSolanaAddress)));
    skippedMalformed += s.holders.length - valid.length;
    if (valid.length > MAX_HOLDER_SET_SIZE) {
      oversizedSnapshots++;
      valid = valid.slice(0, MAX_HOLDER_SET_SIZE);
    }
    // stable per-snapshot identity (hunt+token+source is unique per schema)
    normalizedHolders.set(`${s.huntId}|${s.tokenMint}`, valid);

    let group = hunts.get(s.huntId);
    if (!group) {
      group = {
        huntId: s.huntId,
        tokens: new Set(),
        walletTokens: new Map(),
        latestCapturedAt: s.capturedAt,
        split: 'train',
      };
      hunts.set(s.huntId, group);
    }
    group.tokens.add(s.tokenMint);
    if (s.capturedAt > group.latestCapturedAt) group.latestCapturedAt = s.capturedAt;
    for (const w of valid) {
      let toks = group.walletTokens.get(w);
      if (!toks) {
        toks = new Set();
        group.walletTokens.set(w, toks);
      }
      toks.add(s.tokenMint);
    }
  }
  if (skippedMalformed > 0) {
    warnings.push(`Skipped ${skippedMalformed} malformed/duplicate wallet address entries in snapshots.`);
  }
  if (oversizedSnapshots > 0) {
    warnings.push(`Truncated ${oversizedSnapshots} snapshots exceeding ${MAX_HOLDER_SET_SIZE} holders.`);
  }

  // Only hunts with >=2 distinct tokens can yield confirmed cross-token pairs.
  const eligibleHunts = [...hunts.values()].filter((h) => h.tokens.size >= 2);

  // -------------------------------------------------------------------------
  // 2) Split assignment (T03 §5): COMPONENT-grouped + time-based OOS holdout.
  //    A wallet shared across two hunts links them into one ring; both hunts must
  //    land in the same split or the ring leaks across train/dev/oos. So the split
  //    unit is the connected component of hunts (edges = shared wallet), NOT the
  //    individual hunt. OOS wins for a component if ANY of its hunts falls in the
  //    OOS window; otherwise the component hashes to train/dev by a stable key.
  // -------------------------------------------------------------------------
  const now = new Date();
  const oosThreshold = new Date(now.getTime() - OOS_WEEKS * 7 * 24 * 60 * 60 * 1000);

  const uf = new UnionFind();
  for (const h of eligibleHunts) uf.find(h.huntId); // ensure singleton components exist
  // Union hunts that share any wallet.
  const walletToHunts = new Map<string, string[]>();
  for (const h of eligibleHunts) {
    for (const wallet of h.walletTokens.keys()) {
      const arr = walletToHunts.get(wallet);
      if (arr) arr.push(h.huntId);
      else walletToHunts.set(wallet, [h.huntId]);
    }
  }
  for (const huntIds of walletToHunts.values()) {
    for (let i = 1; i < huntIds.length; i++) uf.union(huntIds[0], huntIds[i]);
  }

  // Compute per-component: whether it touches the OOS window, and a stable key
  // (min huntId in the component) for deterministic train/dev hashing.
  const componentOos = new Map<string, boolean>();
  const componentKey = new Map<string, string>();
  for (const h of eligibleHunts) {
    const root = uf.find(h.huntId);
    const touchesOos = h.latestCapturedAt >= oosThreshold;
    componentOos.set(root, (componentOos.get(root) ?? false) || touchesOos);
    const prevKey = componentKey.get(root);
    if (prevKey === undefined || h.huntId < prevKey) componentKey.set(root, h.huntId);
  }
  const componentSplit = new Map<string, SplitBucket>();
  for (const root of componentKey.keys()) {
    if (componentOos.get(root)) componentSplit.set(root, 'oos');
    else componentSplit.set(root, hashUnit(componentKey.get(root)!) < DEV_FRACTION ? 'dev' : 'train');
  }
  for (const h of eligibleHunts) {
    h.split = componentSplit.get(uf.find(h.huntId))!;
  }

  // -------------------------------------------------------------------------
  // 3) P1 positives — hunt cross-token co-occurrence.
  //    Within each eligible hunt: wallets appearing in >=2 tokens are "confirmed
  //    candidates". Every unordered pair among them is a positive.
  //    weight = min(appearanceCount)/uniqueTokenCount.
  // -------------------------------------------------------------------------
  // Canonical-pair-keyed so a pair confirmed in two hunts of the SAME component
  // becomes ONE ledger row (matching the unique key), keeping the max-confidence
  // evidence. The in-memory summary then matches what actually lands in the table.
  const positiveByPair = new Map<string, LabelRow>();

  for (const h of eligibleHunts) {
    const uniqueTokenCount = h.tokens.size;
    const confirmed: { wallet: string; appearances: number }[] = [];
    for (const [wallet, toks] of h.walletTokens) {
      if (toks.size >= 2) confirmed.push({ wallet, appearances: toks.size });
    }
    for (let i = 0; i < confirmed.length; i++) {
      for (let j = i + 1; j < confirmed.length; j++) {
        const [walletA, walletB] = orderPair(confirmed[i].wallet, confirmed[j].wallet);
        const key = pairKey(walletA, walletB);
        const weight =
          Math.min(confirmed[i].appearances, confirmed[j].appearances) / uniqueTokenCount;
        const existing = positiveByPair.get(key);
        if (existing === undefined || (existing.confidence ?? 0) < weight) {
          positiveByPair.set(key, {
            walletA,
            walletB,
            label: 'positive',
            source: P1_SOURCE,
            huntId: h.huntId,
            reviewerId: null,
            confidence: weight,
            splitBucket: h.split,
          });
        }
      }
    }
  }
  const positives: LabelRow[] = [...positiveByPair.values()];
  // Pairs already claimed as positive (canonical key) — never emit as negative.
  const positivePairKeys = new Set<string>(positiveByPair.keys());

  // Build a global wallet co-occurrence set: any two wallets that ever share a
  // snapshot (same hunt + token). Used to forbid "cross-hunt disjoint" negatives
  // between wallets that actually co-occur somewhere.
  const coOccur = new Set<string>();
  for (const valid of normalizedHolders.values()) {
    // valid is pre-validated, deduped, and capped at MAX_HOLDER_SET_SIZE, so this
    // O(k^2) pass is bounded.
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        coOccur.add(pairKey(valid[i], valid[j]));
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4) N1 negatives — cross-hunt disjoint, balanced, hard-negative-mined.
  //    Candidate = (wallet from hunt A, wallet from hunt B) where:
  //      - A and B are DIFFERENT hunts in the SAME split bucket (no train/dev/oos
  //        straddle — the §5 leakage guard),
  //      - A and B share NO tokens,
  //      - the two wallets NEVER co-occur in any snapshot,
  //      - the pair is not already a positive.
  //    We over-sample candidates, score by engineered cosine (prefer SIMILAR =
  //    hard negatives), and keep a balanced count per split.
  // -------------------------------------------------------------------------
  const negatives: LabelRow[] = [];
  let hardNegativeCount = 0;

  // Precompute per-split positive counts ONCE (avoid O(n^2) re-filtering).
  const positivesPerSplit: Record<SplitBucket, number> = { train: 0, dev: 0, oos: 0 };
  for (const p of positives) if (p.splitBucket) positivesPerSplit[p.splitBucket]++;
  // Group eligible hunts by split once.
  const huntsPerSplit: Record<SplitBucket, HuntGroup[]> = { train: [], dev: [], oos: [] };
  for (const h of eligibleHunts) huntsPerSplit[h.split].push(h);

  // Load engineered vectors for hard-negative mining (read-only). We fetch the
  // cosine distance on demand via a batched raw query rather than materializing
  // the full O(n^2) space.
  for (const split of ['train', 'dev', 'oos'] as SplitBucket[]) {
    const splitHunts = huntsPerSplit[split];
    const negativeTarget = Math.round(positivesPerSplit[split] * NEGATIVE_BALANCE_RATIO);
    if (negativeTarget === 0 || splitHunts.length < 2) continue;

    // Generate disjoint-hunt-pair candidates via bounded reservoir sampling.
    const candidateBudget = negativeTarget * NEGATIVE_CANDIDATE_MULTIPLIER;
    const candidates: { a: string; b: string; huntA: string; huntB: string }[] = [];
    const seenCandidate = new Set<string>();

    outer: for (let i = 0; i < splitHunts.length; i++) {
      for (let j = i + 1; j < splitHunts.length; j++) {
        const hA = splitHunts[i];
        const hB = splitHunts[j];
        // hunts must share no tokens
        let sharesToken = false;
        for (const t of hA.tokens) {
          if (hB.tokens.has(t)) {
            sharesToken = true;
            break;
          }
        }
        if (sharesToken) continue;

        const walletsA = [...hA.walletTokens.keys()];
        const walletsB = [...hB.walletTokens.keys()];
        for (const wa of walletsA) {
          for (const wb of walletsB) {
            const [x, y] = orderPair(wa, wb);
            if (x === y) continue;
            const key = pairKey(x, y);
            if (positivePairKeys.has(key)) continue; // never a positive
            if (coOccur.has(key)) continue; // wallets co-occur somewhere -> not disjoint
            if (seenCandidate.has(key)) continue;
            seenCandidate.add(key);
            candidates.push({ a: x, b: y, huntA: hA.huntId, huntB: hB.huntId });
            if (candidates.length >= candidateBudget) break outer;
          }
        }
      }
    }

    if (candidates.length === 0) continue;

    // Hard-negative mining: score candidates by engineered cosine similarity
    // (1 - distance). Prefer SIMILAR pairs. Missing vectors -> similarity 0 (easy).
    const scored = await scoreByCosineSimilarity(candidates);
    scored.sort((p, q) => q.similarity - p.similarity);

    const hardTarget = Math.round(negativeTarget * HARD_NEGATIVE_TARGET_SHARE);
    const trivialCap = Math.round(negativeTarget * TRIVIAL_NEGATIVE_CAP_SHARE);

    let hardTaken = 0;
    let trivialTaken = 0;
    let takenInSplit = 0;
    for (const c of scored) {
      if (takenInSplit >= negativeTarget) break;
      const isHard = c.similarity > 0; // has a real cosine signal above orthogonal
      if (isHard) {
        if (hardTaken >= hardTarget && trivialTaken >= trivialCap) break;
        if (hardTaken >= hardTarget) continue;
        hardTaken++;
        hardNegativeCount++;
      } else {
        if (trivialTaken >= trivialCap) continue;
        trivialTaken++;
      }
      negatives.push({
        walletA: c.a,
        walletB: c.b,
        label: 'negative',
        source: N1_SOURCE,
        huntId: null, // cross-hunt: not attributable to a single hunt
        reviewerId: null,
        confidence: null,
        splitBucket: split,
      });
      takenInSplit++;
    }
  }

  // -------------------------------------------------------------------------
  // 5) Ambiguous — analyst-ignored radar holdings (COUNTED, not written as pairs).
  //    Only reviewSource='analyst' + reviewStatus='ignored'. These are single
  //    (wallet, token) verdicts, not pairs — there is no natural second wallet, so
  //    the label table (whose invariant is walletA < walletB) is the wrong home for
  //    them. T03 §4.3 excludes analyst-ignored "until provenance is separable". We
  //    therefore only REPORT the count here as a future-signal indicator and never
  //    fabricate a self-pair or a training negative.
  // -------------------------------------------------------------------------
  const analystIgnoredRows = await prisma.radarHolding.findMany({
    where: { reviewStatus: 'ignored', reviewSource: 'analyst' },
    select: { wallet: true },
  });
  const analystIgnoredWallets = new Set(
    analystIgnoredRows.map((r) => r.wallet).filter(isValidSolanaAddress),
  );

  const allRows = [...positives, ...negatives];

  // -------------------------------------------------------------------------
  // 6) Idempotent upsert (one transaction per batch). The unique
  //    (walletA, walletB, source) key prevents duplicates on re-run.
  // -------------------------------------------------------------------------
  let written = 0;
  if (!dryRun) {
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);
      try {
        await prisma.$transaction(
          batch.map((row) =>
            prisma.metricLearningLabel.upsert({
              where: {
                walletA_walletB_source: {
                  walletA: row.walletA,
                  walletB: row.walletB,
                  source: row.source,
                },
              },
              create: {
                walletA: row.walletA,
                walletB: row.walletB,
                label: row.label,
                source: row.source,
                huntId: row.huntId,
                reviewerId: row.reviewerId,
                confidence: row.confidence,
                splitBucket: row.splitBucket,
              },
              update: {
                // Keep provenance current on re-extraction; pair+source is stable.
                label: row.label,
                huntId: row.huntId,
                reviewerId: row.reviewerId,
                confidence: row.confidence,
                splitBucket: row.splitBucket,
              },
            }),
          ),
        );
        written += batch.length;
      } catch (err) {
        // Backing-resource failure: reject the batch with a structured error,
        // never silently drop labels.
        throw new Error(
          `MetricLearningLabel batch write failed at rows ${i}..${i + batch.length}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7) Summary (dispatch §2.3, §5 report fields, §6 threshold verdict).
  // -------------------------------------------------------------------------
  const distinctWallets = new Set<string>();
  for (const r of allRows) {
    distinctWallets.add(r.walletA);
    distinctWallets.add(r.walletB);
  }
  const negativeTotal = negatives.length;
  const negativesPerSplit: Record<SplitBucket, number> = { train: 0, dev: 0, oos: 0 };
  for (const n of negatives) if (n.splitBucket) negativesPerSplit[n.splitBucket]++;
  const perSplit = (bucket: SplitBucket) => ({
    positives: positivesPerSplit[bucket],
    negatives: negativesPerSplit[bucket],
  });

  const summary = {
    dryRun,
    counts: {
      positive: positives.length,
      negative: negatives.length,
      analystIgnoredWallets: analystIgnoredWallets.size, // reported, not written
      total: allRows.length,
      written,
    },
    distinct: {
      wallets: distinctWallets.size,
      eligibleHunts: eligibleHunts.length,
      totalHuntsSeen: hunts.size,
      singleTokenHuntsExcluded: hunts.size - eligibleHunts.length,
    },
    hardNegativeShare:
      negativeTotal > 0 ? Math.round((hardNegativeCount / negativeTotal) * 1000) / 1000 : 0,
    split: {
      train: perSplit('train'),
      dev: perSplit('dev'),
      oos: perSplit('oos'),
      oosWindowWeeks: OOS_WEEKS,
    },
    warnings,
    thresholds: evaluateThresholds({
      positives: positives.length,
      hardNegatives: hardNegativeCount,
      eligibleHunts: eligibleHunts.length,
    }),
  };

  console.log(JSON.stringify(summary, null, 2));
}

/**
 * Score candidate pairs by engineered cosine similarity using the persisted
 * WalletVector (<=> is cosine DISTANCE; similarity = 1 - distance). Pairs where
 * either wallet lacks a current-version vector score 0 (treated as trivial/easy).
 * Batched to avoid N+1 and to keep memory bounded.
 */
async function scoreByCosineSimilarity(
  candidates: { a: string; b: string; huntA: string; huntB: string }[],
): Promise<{ a: string; b: string; huntA: string; huntB: string; similarity: number }[]> {
  const CHUNK = 500;
  const result: { a: string; b: string; huntA: string; huntB: string; similarity: number }[] = [];
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const values = Prisma.join(
      chunk.map((c) => Prisma.sql`(${c.a}, ${c.b})`),
    );
    const rows = await prisma.$queryRaw<{ a: string; b: string; similarity: number }[]>`
      WITH pairs("a", "b") AS (VALUES ${values})
      SELECT p."a", p."b",
             (1 - (va."vector" <=> vb."vector"))::float AS "similarity"
      FROM pairs p
      JOIN "WalletVector" va ON va."walletAddress" = p."a"
      JOIN "WalletVector" vb ON vb."walletAddress" = p."b"
       AND vb."schemaVersion" = va."schemaVersion"
    `;
    const simMap = new Map<string, number>();
    for (const r of rows) simMap.set(`${r.a}|${r.b}`, r.similarity);
    for (const c of chunk) {
      const sim = simMap.get(`${c.a}|${c.b}`) ?? 0;
      // clamp: cosine sim in [-1,1]; only positive similarity is a "hard" signal.
      result.push({ ...c, similarity: sim > 0 ? sim : 0 });
    }
  }
  return result;
}

/**
 * §6 threshold gate. The full pass/fail verdict needs real server counts
 * (AGENT_5 / SPEC_T05); against the local synthetic DB this reports the checks
 * it CAN evaluate and marks the rest as pending-real-data.
 */
function evaluateThresholds(input: {
  positives: number;
  hardNegatives: number;
  eligibleHunts: number;
}): Record<string, unknown> {
  return {
    verdict: 'PENDING_REAL_DATA',
    note: 'The §6 GO/NO-GO for a metric-learning job requires real label counts from AGENT_5 (SPEC_T05). Local synthetic counts prove plumbing only.',
    checks: {
      constructiblePositivePairs: { value: input.positives, min: 5000, pass: input.positives >= 5000 },
      hardNegativesAvailable: { value: input.hardNegatives, min: 2000, pass: input.hardNegatives >= 2000 },
      huntsWith2PlusSnapshots: { value: input.eligibleHunts, min: 50, pass: input.eligibleHunts >= 50 },
    },
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
