/**
 * ============================================================================
 * ARCHITECTURAL DEBT & FUTURE REFACTOR PLAN
 * ============================================================================
 *
 * CURRENT STATE (2025-01-18):
 * This mapper applies value attribution heuristics to ALL transactions without
 * first classifying transaction patterns. This leads to:
 * - Edge cases where burns are mapped as swaps (rent reclaim treated as value)
 * - Conflicting heuristics (e.g., both WSOL and stable significant → neither assigned)
 * - Difficult debugging (cascading if-else chains obscure logic flow)
 * - Fragile patching (each new edge case requires another band-aid)
 *
 * ROOT CAUSE:
 * Helius `type` field is unreliable (many transactions marked "UNKNOWN" including
 * burns, complex DeFi ops, and legitimate swaps through unrecognized aggregators).
 * We can't trust their classification, so we must derive our own from raw data.
 *
 * INTENDED REFACTOR (Future Work):
 *
 * Phase 1: Pattern Detection (classify BEFORE value attribution)
 * ---------------------------------------------------------------
 * Detect transaction patterns from raw tokenTransfers/nativeTransfers:
 *
 *   BURN: token OUT to empty/null address
 *     → value = 0 (no economic exchange, SOL movement is rent reclaim)
 *
 *   AIRDROP: token IN only, no significant value OUT (except tiny fees)
 *     → value = 0 (free tokens, fee is transaction cost not purchase price)
 *
 *   SIMPLE_SWAP: token OUT + stable/SOL IN (or inverse), direct exchange
 *     → value = stable/SOL movement (90% of cases, straightforward)
 *
 *   ROUTED_SWAP: token OUT + intermediary hops (WSOL, multiple stables)
 *     → apply complex heuristics (SPL-to-SPL, event matching, etc.)
 *
 *   TRANSFER: token OUT to known address, no value IN
 *     → cost basis from inventory (FIFO), not from this transaction
 *
 * Phase 2: Targeted Value Attribution (apply logic based on pattern)
 * -------------------------------------------------------------------
 * switch (pattern) {
 *   case BURN:
 *   case AIRDROP:
 *     associatedValue = 0; // Skip all heuristics
 *     break;
 *
 *   case SIMPLE_SWAP:
 *     associatedValue = stableMovement || solMovement; // Direct mapping
 *     break;
 *
 *   case ROUTED_SWAP:
 *     associatedValue = applyRoutingHeuristics(...); // Complex logic here
 *     break;
 * }
 *
 * BENEFITS:
 * - Explicit logic paths (no cascading conditionals)
 * - Easier debugging (pattern detection separate from value attribution)
 * - Fewer edge cases (patterns caught early before heuristics apply)
 * - Better maintainability (new patterns don't break existing logic)
 *
 * CURRENT WORKAROUNDS (until refactor):
 * - Burn detection added (2025-01-18) to skip value attribution for burns
 * - Stable preference over SOL when both significant (2025-01-18)
 * - WSOL lamport bug mitigation (2025-10-27, improved 2025-01-18)
 * - Small outgoing transfer detection for fees
 * - Proportional redistribution for chunked transfers
 *
 * TODO: Schedule this refactor when bandwidth allows (~500 lines rewrite)
 * ============================================================================
 */

import { createLogger } from '@/core/utils/logger';
import { Prisma } from '@prisma/client';
import { HeliusTransaction, TokenTransfer } from '@/types/helius-api';
import { TRANSACTION_MAPPING_CONFIG } from '../../config/constants';

const logger = createLogger('HeliusTransactionMapper');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USD1_MINT = 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';
const STABLE_MINTS = new Set<string>([USDC_MINT, USDT_MINT, USD1_MINT]);
const STABLE_MINT_PREFERENCE = [USDC_MINT, USDT_MINT, USD1_MINT];
const STABLE_VALUE_TOLERANCE = 0.03; // 3% tolerance for stable-to-stable routing differences
const STABLE_DUST_RATIO = 0.01; // Ignore stable values <1% of the max when multiple stables appear
const STABLE_NET_DOMINANCE = 0.1; // Require net movement >=10% of max side to treat as value (not routing)
const INTERMEDIATE_NET_EPSILON = 1e-6; // Drop zero-net intermediate tokens within a single signature
const LAMPORTS_PER_SOL = 1e9;
const SOL_SIGNIFICANCE_THRESHOLD = 0.0001; // 0.0001 SOL (~$0.02 at $200/SOL)
const STABLE_SIGNIFICANCE_THRESHOLD = 1.0; // 1.0 USDC/USDT/USD1 ($1 minimum for significance)
const NATIVE_SOL_LAMPORT_THRESHOLD = TRANSACTION_MAPPING_CONFIG.NATIVE_SOL_LAMPORT_THRESHOLD;
const FEE_PRECISION_THRESHOLD = 0.000000001; // Avoid assigning near-zero fees
const FEE_TRANSFER_THRESHOLD_SOL = TRANSACTION_MAPPING_CONFIG.FEE_TRANSFER_THRESHOLD_SOL;
const FEE_TRANSFER_VALUE_RATIO = TRANSACTION_MAPPING_CONFIG.FEE_TRANSFER_VALUE_RATIO;
const GROSS_NATIVE_SOL_IN_RATIO_LIMIT = TRANSACTION_MAPPING_CONFIG.GROSS_NATIVE_SOL_IN_RATIO_LIMIT;
const FEE_SELF_HEALING_PERCENT_THRESHOLD = TRANSACTION_MAPPING_CONFIG.FEE_SELF_HEALING_PERCENT_THRESHOLD;
// const TOKEN_FEE_AMOUNT_MATCH_TOLERANCE = 0.001; // 0.1% tolerance for matching token fee amounts (commented out as we are trying a new heuristic)
const TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD = 0.05; // 5% - Heuristic for mapper-level fee identification
const FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_SOL = 0.1; // Min SOL value for fee-payer heuristic
const FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_USDC = 1.0; // Min USDC value for fee-payer heuristic
const SOL_DUST_TRANSFER_THRESHOLD = TRANSACTION_MAPPING_CONFIG.SOL_DUST_TRANSFER_THRESHOLD;
const ROUTED_WSOL_NET_SETTLEMENT_RATIO_THRESHOLD = 1.5;
const LIQUIDITY_PROGRAM_IDS = new Set<string>([
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap AMM
]);

function isStableMint(mint?: string | null): boolean {
  return !!mint && STABLE_MINTS.has(mint);
}

function pickStableValueByPreference(
  stableValues: Map<string, number>,
  tolerance: number,
): { mint: string; value: number } | null {
  const entries = Array.from(stableValues.entries()).filter(([, value]) => value > 0);
  if (entries.length === 0) return null;
  if (entries.length === 1) return { mint: entries[0][0], value: entries[0][1] };

  const values = entries.map(([, value]) => value);
  const maxValue = Math.max(...values);
  const dustCutoff = maxValue * STABLE_DUST_RATIO;
  const filteredEntries = entries.filter(([, value]) => value >= dustCutoff);
  const effectiveEntries = filteredEntries.length > 0 ? filteredEntries : entries;
  if (effectiveEntries.length === 1) return { mint: effectiveEntries[0][0], value: effectiveEntries[0][1] };

  const effectiveValues = effectiveEntries.map(([, value]) => value);
  const effectiveMax = Math.max(...effectiveValues);
  const effectiveMin = Math.min(...effectiveValues);
  if (effectiveMax <= 0) return null;

  const withinTolerance = (effectiveMax - effectiveMin) / effectiveMax <= tolerance;
  if (!withinTolerance) return null;

  for (const mint of STABLE_MINT_PREFERENCE) {
    const match = effectiveEntries.find(([entryMint]) => entryMint === mint);
    if (match) return { mint: match[0], value: match[1] };
  }

  return { mint: effectiveEntries[0][0], value: effectiveEntries[0][1] };
}

function hasLiquidityProgramInteraction(tx: HeliusTransaction): boolean {
  for (const instruction of tx.instructions || []) {
    if (LIQUIDITY_PROGRAM_IDS.has(instruction.programId)) {
      return true;
    }
    for (const innerInstruction of instruction.innerInstructions || []) {
      if (LIQUIDITY_PROGRAM_IDS.has(innerInstruction.programId)) {
        return true;
      }
    }
  }
  return false;
}

function hasTemporaryWsolLifecycle(
  tx: HeliusTransaction,
  walletAddressLower: string,
): boolean {
  const candidateAccounts = new Set<string>();

  for (const transfer of tx.tokenTransfers || []) {
    if (transfer.mint !== SOL_MINT) continue;

    if (transfer.toUserAccount?.toLowerCase() === walletAddressLower && transfer.toTokenAccount) {
      candidateAccounts.add(transfer.toTokenAccount);
    }
    if (transfer.fromUserAccount?.toLowerCase() === walletAddressLower && transfer.fromTokenAccount) {
      candidateAccounts.add(transfer.fromTokenAccount);
    }
  }

  if (candidateAccounts.size === 0) {
    return false;
  }

  const instructionMentionsAccount = (account: string): boolean => {
    for (const instruction of tx.instructions || []) {
      if (instruction.accounts?.includes(account)) {
        return true;
      }
      for (const innerInstruction of instruction.innerInstructions || []) {
        if (innerInstruction.accounts?.includes(account)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const tokenAccount of candidateAccounts) {
    const fundedByWallet = (tx.nativeTransfers || []).some(
      (transfer) =>
        transfer.fromUserAccount?.toLowerCase() === walletAddressLower &&
        transfer.toUserAccount === tokenAccount &&
        Number(transfer.amount) > 0,
    );
    const closedBackToWallet = (tx.nativeTransfers || []).some(
      (transfer) =>
        transfer.fromUserAccount === tokenAccount &&
        transfer.toUserAccount?.toLowerCase() === walletAddressLower &&
        Number(transfer.amount) > 0,
    );
    const touchedInInstructions = instructionMentionsAccount(tokenAccount);

    if (closedBackToWallet && (fundedByWallet || touchedInInstructions)) {
      return true;
    }
  }

  return false;
}

function isConfirmedLiquidityStyleTransfer(
  tx: HeliusTransaction,
  walletAddressLower: string,
): boolean {
  if (tx.events?.swap) return false;
  if (!hasLiquidityProgramInteraction(tx)) return false;
  if (!hasTemporaryWsolLifecycle(tx, walletAddressLower)) return false;

  const meaningfulTokenFlows = new Map<string, number>();

  for (const transfer of tx.tokenTransfers || []) {
    const mint = transfer.mint;
    if (!mint) continue;

    const amount = Math.abs(safeParseAmount(transfer));
    if (amount === 0) continue;

    const threshold =
      mint === SOL_MINT ? SOL_SIGNIFICANCE_THRESHOLD :
      isStableMint(mint) ? STABLE_SIGNIFICANCE_THRESHOLD :
      INTERMEDIATE_NET_EPSILON;

    if (amount < threshold) continue;

    const isFromUser = transfer.fromUserAccount?.toLowerCase() === walletAddressLower;
    const isToUser = transfer.toUserAccount?.toLowerCase() === walletAddressLower;

    if (isFromUser && !isToUser) {
      meaningfulTokenFlows.set(mint, (meaningfulTokenFlows.get(mint) || 0) - amount);
    } else if (isToUser && !isFromUser) {
      meaningfulTokenFlows.set(mint, (meaningfulTokenFlows.get(mint) || 0) + amount);
    }
  }

  const flowEntries = Array.from(meaningfulTokenFlows.entries()).filter(
    ([, flow]) => Math.abs(flow) > INTERMEDIATE_NET_EPSILON,
  );

  if (flowEntries.length < 2) return false;

  const allIncoming = flowEntries.every(([, flow]) => flow > 0);
  const allOutgoing = flowEntries.every(([, flow]) => flow < 0);
  if (!allIncoming && !allOutgoing) return false;

  const hasValueLeg = flowEntries.some(([mint]) => mint === SOL_MINT || isStableMint(mint));
  const hasNonValueLeg = flowEntries.some(([mint]) => mint !== SOL_MINT && !isStableMint(mint));

  return hasValueLeg && hasNonValueLeg;
}

function shouldPreferNetSettlementForRoutedWsolSwap(
  tx: HeliusTransaction,
  walletAddressLower: string,
  userAccounts: Set<string>,
  finalNetUserSolChange: number,
): boolean {
  if ((tx.type?.toUpperCase() || 'UNKNOWN') !== 'SWAP') return false;
  if (tx.events?.swap) return false;
  if (!hasTemporaryWsolLifecycle(tx, walletAddressLower)) return false;
  if (!hasLiquidityProgramInteraction(tx)) return false;

  let userWsolIn = 0;
  let userWsolOut = 0;
  let nonValueInCount = 0;
  let nonValueOutCount = 0;

  for (const transfer of tx.tokenTransfers || []) {
    const mint = transfer.mint;
    if (!mint) continue;

    const amount = Math.abs(safeParseAmount(transfer));
    if (amount === 0) continue;

    const fromUser =
      transfer.fromUserAccount?.toLowerCase() === walletAddressLower ||
      (transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount));
    const toUser =
      transfer.toUserAccount?.toLowerCase() === walletAddressLower ||
      (transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount));

    if ((!fromUser && !toUser) || (fromUser && toUser)) continue;

    if (mint === SOL_MINT) {
      if (toUser) userWsolIn += amount;
      else userWsolOut += amount;
      continue;
    }

    if (isStableMint(mint)) continue;

    if (toUser) nonValueInCount += 1;
    else nonValueOutCount += 1;
  }

  const hasOneDirectionNonValueFlow =
    (nonValueInCount > 0 && nonValueOutCount === 0) ||
    (nonValueOutCount > 0 && nonValueInCount === 0);
  if (!hasOneDirectionNonValueFlow) return false;

  if (userWsolIn < SOL_SIGNIFICANCE_THRESHOLD || userWsolOut < SOL_SIGNIFICANCE_THRESHOLD) {
    const isSellSettlementPattern =
      nonValueOutCount > 0 &&
      nonValueInCount === 0 &&
      userWsolIn >= SOL_SIGNIFICANCE_THRESHOLD;

    return isSellSettlementPattern;
  }

  const absNetSolChange = Math.abs(finalNetUserSolChange);
  if (absNetSolChange < SOL_SIGNIFICANCE_THRESHOLD) return false;

  if (nonValueOutCount > 0 && nonValueInCount === 0) {
    return true;
  }

  const grossUserWsolMovement = userWsolIn + userWsolOut;
  return grossUserWsolMovement > absNetSolChange * ROUTED_WSOL_NET_SETTLEMENT_RATIO_THRESHOLD;
}

// --- Add MappingStats Interface ---
/**
 * Interface for collecting statistics during the Helius transaction mapping process.
 * Tracks various counts related to transaction processing, errors, and generated records.
 */
interface MappingStats {
  /** Total number of Helius transactions received for processing. */
  totalTransactionsReceived: number;
  /** Number of transactions skipped due to an error during their processing. */
  transactionsSkippedError: number;
  /** Number of transactions successfully processed without critical errors (may still have warnings). */
  transactionsSuccessfullyProcessed: number;
  /** Total number of SwapAnalysisInput records generated from all processed transactions. */
  analysisInputsGenerated: number;
  /** Number of native SOL transfer events processed. */
  nativeSolTransfersProcessed: number;
  /** Total number of SPL token transfer events processed. */
  tokenTransfersProcessed: number;
  /** Number of WSOL (Wrapped SOL) token transfer events processed. */
  wsolTransfersProcessed: number;
  /** Number of stablecoin transfer events processed (USDC/USDT/USD1). */
  usdcTransfersProcessed: number;
  /** Number of other (non-WSOL, non-stable) SPL token transfer events processed. */
  otherTokenTransfersProcessed: number;
  /** Number of times the fee payer heuristic was applied to attribute swaps. */
  feePayerHeuristicApplied: number;
  /** Number of records for which a fee amount was calculated and assigned. */
  feesCalculated: number;
  /** Number of times the fee self-healing guard zeroed out suspect values. */
  feeSelfHealingTriggered: number;
  // --- New Counters ---
  /** Number of attempts made by the event matcher to find intermediary values. */
  eventMatcherAttempts: number;
  /** Number of times the event matcher identified primary input/output mints for a swap. */
  eventMatcherPrimaryMintsIdentified: number;
  /** Number of times the event matcher found a consistent SOL value as an intermediary. */
  eventMatcherConsistentSolFound: number;
  /** Number of times the event matcher found a consistent stable value as an intermediary. */
  eventMatcherConsistentUsdcFound: number;
  /** Number of times the event matcher found both SOL and stable values or other ambiguities. */
  eventMatcherAmbiguous: number;
  /** Number of times the event matcher could not find a consistent intermediary value. */
  eventMatcherNoConsistentValue: number;
  /** Number of SPL-to-SPL swaps detected (typically using WSOL as intermediary). */
  splToSplSwapDetections: number;
  /** Number of records where associated SOL/stable value was derived from SPL-to-SPL detection. */
  associatedValueFromSplToSpl: number;
  /** Number of records where associated SOL/stable value was derived from the event matcher. */
  associatedValueFromEventMatcher: number;
  /** Number of records where associated SOL/stable value was derived from total WSOL/stable movement. */
  associatedValueFromTotalMovement: number;
  /** Number of records where associated SOL/stable value was derived from net user SOL/stable change. */
  associatedValueFromNetChange: number;
  /** Number of times the small outgoing transfer heuristic was applied to identify potential fees. */
  smallOutgoingHeuristicApplied: number;
  /** Number of potential SwapAnalysisInput records skipped due to having an identical record key already processed for the same transaction. */
  skippedDuplicateRecordKey: number;
  /** A count of transactions categorized by their Helius `type` (e.g., SWAP, TRANSFER). */
  countByInteractionType: { [type: string]: number };
  /** 
   * Number of UNKNOWN transactions skipped because they were detected as liquidity operations.
   * NOTE: Variable name kept as 'unknownTxSkippedNoJito' to match database schema.
   * The logic now filters based on token flow direction, not Jito protection.
   */
  unknownTxSkippedNoJito: number;
  // --- End New Counters ---
}
// --- End MappingStats Interface ---

// --- Add MappingResult Interface ---
/**
 * Represents the result of the Helius transaction mapping process.
 * Contains the generated SwapAnalysisInput records and the collected mapping statistics.
 */
export interface MappingResult {
  /** An array of `SwapAnalysisInputCreateData` objects ready to be saved to the database. */
  analysisInputs: SwapAnalysisInputCreateData[];
  /** An object containing statistics collected during the mapping process. */
  stats: MappingStats;
}
// --- End MappingResult Interface ---

// Define the output type matching Prisma's expectations
type SwapAnalysisInputCreateData = Prisma.SwapAnalysisInputCreateInput;

/**
 * Converts lamports to SOL, returning the absolute value.
 * Handles undefined, null, string, and number inputs.
 *
 * @param lamports The amount in lamports. Can be a number, string, null, or undefined.
 * @returns The equivalent amount in SOL (absolute value), or 0 if input is invalid or cannot be parsed.
 */
function lamportsToSol(lamports: number | string | undefined | null): number {
    if (lamports === undefined || lamports === null) return 0;
    const num = typeof lamports === 'string' ? parseFloat(lamports) : Number(lamports);
    return isNaN(num) ? 0 : Math.abs(num) / LAMPORTS_PER_SOL;
}

/**
 * Safely parses the token amount from the `rawTokenAmount` structure found in Helius `accountData.tokenBalanceChanges`.
 * Handles potential BigInts and scaling based on decimals.
 *
 * @param rawAmountData The object possibly containing `tokenAmount` and `decimals`. Expected structure: `{ tokenAmount: string | number, decimals: number }`.
 * @returns The scaled, signed token amount as a number, or 0 if parsing fails or data is missing.
 */
function parseRawTokenAmount(rawAmountData: any): number {
    if (!rawAmountData || rawAmountData.tokenAmount === undefined || rawAmountData.decimals === undefined) {
        return 0;
    }
    try {
        const { tokenAmount, decimals } = rawAmountData;
        const raw = BigInt(String(tokenAmount));
        const scaledAmount = Number(raw) / Math.pow(10, decimals);
        return isNaN(scaledAmount) ? 0 : scaledAmount; // Return the signed amount
    } catch (e) {
        logger.warn('Error parsing rawTokenAmount', { data: rawAmountData, error: e });
        return 0;
    }
}

/**
 * Safely parses the token amount directly from the `tokenAmount` field within a `TokenTransfer` object.
 * Assumes this `tokenAmount` is already correctly scaled (human-readable).
 *
 * @param transfer The Helius `TokenTransfer` object or a similar structure containing `tokenAmount`.
 * @returns The token amount as a number, or 0 if parsing fails or data is missing.
 */
function safeParseAmount(transfer: TokenTransfer | any): number { 
  if (!transfer || transfer.tokenAmount === undefined || transfer.tokenAmount === null) {
    return 0;
  }
  try {
    const amount = typeof transfer.tokenAmount === 'number'
        ? transfer.tokenAmount
        : parseFloat(String(transfer.tokenAmount));
    return isNaN(amount) ? 0 : amount; // Return signed amount
  } catch (e) {
    logger.warn('Error in safeParseAmount (direct tokenAmount parsing)', { data: transfer, error: e });
    return 0;
  }
}

/**
 * Analyzes transaction event data to find a consistent
 * intermediary WSOL or stable value linking the user's primary input token to their
 * primary output token for the overall swap.
 *
 * @param tx The full HeliusTransaction object.
 * @param userAccounts A Set containing the user's main wallet address and associated token accounts.
 * @returns An object containing the matched solValue or usdcValue, and primary mints, or defaults if ambiguous/not found.
 */
function findIntermediaryValueFromEvent(
    tx: HeliusTransaction,
    userAccounts: Set<string>,
    stats: MappingStats
): { solValue: number; usdcValue: number; primaryOutMint: string | null; primaryInMint: string | null } {
    stats.eventMatcherAttempts++;
    const defaultValue = { solValue: 0, usdcValue: 0, primaryOutMint: null, primaryInMint: null };

    if (!tx.events?.swap || !Array.isArray(tx.events.swap.innerSwaps)) {
        stats.eventMatcherNoConsistentValue++;
        return defaultValue;
    }
    const swapEvent = tx.events.swap;

    // 1. Identify User's Primary In/Out Tokens (Heuristic from top-level transfers)
    let primaryOutMint: string | null = null;
    let primaryInMint: string | null = null;
    for (const transfer of tx.tokenTransfers || []) {
        const mint = transfer.mint;
        if (!mint || mint === SOL_MINT || isStableMint(mint)) continue;

        const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
        const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);

        if (fromUserTA && !toUserTA) primaryOutMint = mint;
        if (toUserTA && !fromUserTA) primaryInMint = mint;
    }

    const currentResult = { ...defaultValue, primaryOutMint, primaryInMint };

    if (!primaryOutMint || !primaryInMint) {
        // logger.debug(`Event Matcher: Could not identify primary user IN/OUT non-WSOL/stable mints. Sig: ${tx.signature}`); // Removed debug
        stats.eventMatcherNoConsistentValue++;
        return currentResult;
    }
    stats.eventMatcherPrimaryMintsIdentified++;
    // logger.debug(`Event Matcher: Identified Primary OUT: ${primaryOutMint}, Primary IN: ${primaryInMint}. Sig: ${tx.signature}`); // Removed debug

    // 2. Scan innerSwaps for values associated with these primaries
    let total_wsol_from_sell = 0;
    const totalStableFromSell = new Map<string, number>();
    let total_wsol_to_buy = 0;
    const totalStableToBuy = new Map<string, number>();
    const significanceThreshold = 0.00001; // Threshold for considering inner swap amounts

    try {
        for (const innerSwap of swapEvent.innerSwaps || []) {
            const sellsPrimaryOut = (innerSwap.tokenInputs || []).some((inp: any) => inp.mint === primaryOutMint);
            if (sellsPrimaryOut) {
                for (const output of innerSwap.tokenOutputs || []) {
                    const amount = Math.abs(safeParseAmount(output));
                    if (output.mint === SOL_MINT && amount >= significanceThreshold) total_wsol_from_sell += amount;
                    if (isStableMint(output.mint) && amount >= significanceThreshold) {
                        totalStableFromSell.set(output.mint, (totalStableFromSell.get(output.mint) || 0) + amount);
                    }
                }
            }

            const buysPrimaryIn = (innerSwap.tokenOutputs || []).some((out: any) => out.mint === primaryInMint);
            if (buysPrimaryIn) {
                for (const input of innerSwap.tokenInputs || []) {
                     const amount = Math.abs(safeParseAmount(input));
                    if (input.mint === SOL_MINT && amount >= significanceThreshold) total_wsol_to_buy += amount;
                    if (isStableMint(input.mint) && amount >= significanceThreshold) {
                        totalStableToBuy.set(input.mint, (totalStableToBuy.get(input.mint) || 0) + amount);
                    }
                }
            }
        }
        // logger.debug(`Event Matcher: Calculated Values - SOL Sell: ${total_wsol_from_sell.toFixed(9)}, SOL Buy: ${total_wsol_to_buy.toFixed(9)}, Stable Sell/Buy calculated via per-mint totals. Sig: ${tx.signature}`); // Removed debug

        // 3. Consistency Check & Decision
        const tolerance = 0.01; // Allow 1% difference
        let solConsistent = false;
        let stableConsistent = false;
        let selectedStableValue = 0;

        if (total_wsol_from_sell >= significanceThreshold && total_wsol_to_buy >= significanceThreshold) {
            solConsistent = Math.abs(total_wsol_from_sell - total_wsol_to_buy) <= tolerance * Math.max(total_wsol_from_sell, total_wsol_to_buy);
        }
        const consistentStableValues = new Map<string, number>();
        for (const [mint, fromSell] of totalStableFromSell.entries()) {
            const toBuy = totalStableToBuy.get(mint) || 0;
            if (fromSell >= significanceThreshold && toBuy >= significanceThreshold) {
                const consistent = Math.abs(fromSell - toBuy) <= tolerance * Math.max(fromSell, toBuy);
                if (consistent) {
                    consistentStableValues.set(mint, fromSell);
                }
            }
        }
        const selectedStable = pickStableValueByPreference(consistentStableValues, tolerance);
        if (selectedStable) {
            stableConsistent = true;
            selectedStableValue = selectedStable.value;
        }

        if (solConsistent && !stableConsistent) {
            // logger.debug(`Event Matcher: Found consistent SOL value: ${total_wsol_from_sell.toFixed(9)}. Sig: ${tx.signature}`); // Removed debug
            currentResult.solValue = total_wsol_from_sell;
            stats.eventMatcherConsistentSolFound++;
            return currentResult;
        } else if (stableConsistent && !solConsistent) {
            // logger.debug(`Event Matcher: Found consistent stable value: ${selectedStableValue.toFixed(9)}. Sig: ${tx.signature}`); // Removed debug
            currentResult.usdcValue = selectedStableValue;
            stats.eventMatcherConsistentUsdcFound++;
            return currentResult;
        } else {
             if (solConsistent || stableConsistent) {
                 logger.warn(`Event Matcher: Ambiguous - Cannot choose between consistent SOL (${solConsistent}) and stable (${stableConsistent}). Sig: ${tx.signature}`);
                 stats.eventMatcherAmbiguous++;
             } else {
                 // logger.debug(`Event Matcher: No single consistent intermediary value found. Sig: ${tx.signature}`); // Removed debug
                 stats.eventMatcherNoConsistentValue++;
             }
            return currentResult; // Return with values still 0
        }

    } catch (error) {
        logger.error(`Error during 'Matching Value' event processing. Sig: ${tx.signature}`, { error });
        stats.eventMatcherNoConsistentValue++;
        return currentResult; // Return identified mints even if error occurs
    }
}

/**
 * Main entry-point for the mapper.
 *
 * Steps per transaction
 * 1. Skip errored transactions, initialise per-tx stats.
 * 2. Build a quick lookup Set (`userAccounts`) that contains the wallet address and
 *    every token account that belongs to the wallet inside this transaction.
 * 3. Compute net user changes (native SOL, WSOL, stablecoins) & heuristics values that
 *    will later be used to price SPL legs that are not SOL/stable themselves.
 * 4. Process Native SOL transfers – always push rows, value = amount.
 * 5. Apply the "fee-payer" heuristics that attribute swap legs to the wallet
 *    when it acted as fee payer for a routing contract.
 * 6. Process every SPL `tokenTransfer` and use a *tiered* strategy to derive
 *    `associatedSolValue` / `associatedUsdcValue` (event matcher, WSOL
 *    intermediary, total movement, net change etc.).
 *    NOTE: `associatedUsdcValue` is the *stable USD value* and can come from
 *    USDC/USDT/USD1. We only assign one stable value per leg (within tolerance)
 *    to avoid double counting when a route hops through multiple stables.
 * 7. NEW (2025-06-24): After all rows for this transaction are created we run a
 *    proportional redistribution that guarantees the **aggregate** SOL/stable
 *    value is correct while avoiding double counting when the same
 *    `mint+direction` appears in multiple chunks.
 * 8. Update mapping statistics and return `{ analysisInputs, stats }` for bulk
 *    insertion into the DB.
 *
 * Performance: everything is O(N) over `tokenTransfers`; the final redistribution
 * is another O(M) where `M ≤ N` and therefore negligible.
 *
 * @param walletAddress – lowercase wallet address we are mapping for.
 * @param transactions  – full HeliusTransaction objects for this wallet.
 * @returns MappingResult with rows ready for Prisma createMany.
 */
export function mapHeliusTransactionsToIntermediateRecords(
  walletAddress: string,
  transactions: HeliusTransaction[],
): MappingResult {
  const analysisInputs: SwapAnalysisInputCreateData[] = [];
  const lowerWalletAddress = walletAddress.toLowerCase();

  const mappingStats: MappingStats = {
    totalTransactionsReceived: transactions.length,
    transactionsSkippedError: 0,
    transactionsSuccessfullyProcessed: 0,
    analysisInputsGenerated: 0,
    nativeSolTransfersProcessed: 0,
    tokenTransfersProcessed: 0,
    wsolTransfersProcessed: 0,
    usdcTransfersProcessed: 0,
    otherTokenTransfersProcessed: 0,
    feePayerHeuristicApplied: 0,
    feesCalculated: 0,
    feeSelfHealingTriggered: 0,
    // --- Initialize New Counters ---
    eventMatcherAttempts: 0,
    eventMatcherPrimaryMintsIdentified: 0,
    eventMatcherConsistentSolFound: 0,
    eventMatcherConsistentUsdcFound: 0,
    eventMatcherAmbiguous: 0,
    eventMatcherNoConsistentValue: 0,
    splToSplSwapDetections: 0,
    associatedValueFromSplToSpl: 0,
    associatedValueFromEventMatcher: 0,
    associatedValueFromTotalMovement: 0,
    associatedValueFromNetChange: 0,
    smallOutgoingHeuristicApplied: 0,
    skippedDuplicateRecordKey: 0,
    countByInteractionType: {},
    unknownTxSkippedNoJito: 0,
    // --- End Initialize New Counters ---
  };
  const feeSelfHealingExamples: string[] = [];

  for (const tx of transactions) {
    if (tx.transactionError) {
      // logger.debug(`Skipping tx ${tx.signature} due to transaction error.`); // Removed debug
      mappingStats.transactionsSkippedError++; // Increment counter
      continue;
    }

    // --- Liquidity Operation Detection Heuristic (Configurable) ---
    // This heuristic filters out UNKNOWN transactions that are likely liquidity add/remove operations
    // rather than actual swaps. This prevents inflation of swap analysis data with non-trading activity.
    //
    // Detection Logic:
    // 1. Only applies to UNKNOWN transaction types (Helius doesn't classify them as SWAP)
    // 2. Analyzes user's token flow pattern in the transaction
    // 3. Liquidity operations: User provides/removes both tokens in same direction (both in OR both out)
    // 4. Swaps: User sends one token and receives another (opposite directions)
    // 5. Conservative approach: Only filters when pattern is clearly liquidity, allows ambiguous cases through
    if (TRANSACTION_MAPPING_CONFIG.ENABLE_LIQUIDITY_FILTERING) {
      const interactionTypeForCheck = tx.type?.toUpperCase() || 'UNKNOWN';
      if (interactionTypeForCheck === 'UNKNOWN') {
        // Get user's token transfers for this transaction
        const userTokenTransfers = (tx.tokenTransfers || []).filter(
          (transfer) => 
            transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress ||
            transfer.toUserAccount?.toLowerCase() === lowerWalletAddress
        );

        // Skip if no user token activity (not a DeFi transaction)
        if (userTokenTransfers.length === 0) {
          mappingStats.unknownTxSkippedNoJito++; // for now unknownTxSkippedNoJito is misleading, it should be unknownTxSkippedLiquidityOperation but we need to change the database schema first
          continue;
        }

        // Analyze token flow directions for the user
        const userTokenFlow = new Map<string, number>(); // mint -> net flow (positive = received, negative = sent)
        
        for (const transfer of userTokenTransfers) {
          const mint = transfer.mint;
          if (!mint) continue;
          
          const amount = safeParseAmount(transfer);
          const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
          
          if (isFromUser && !isToUser) {
            // User sent this token
            userTokenFlow.set(mint, (userTokenFlow.get(mint) || 0) - Math.abs(amount));
          } else if (isToUser && !isFromUser) {
            // User received this token
            userTokenFlow.set(mint, (userTokenFlow.get(mint) || 0) + Math.abs(amount));
          }
          // Self-transfers (isFromUser && isToUser) are ignored as they don't change net position
        }

        // Determine if this is a liquidity operation
        // Liquidity: User's tokens flow in the same direction (both positive or both negative)
        // Swap: User's tokens flow in opposite directions (one positive, one negative)
        const tokenFlows = Array.from(userTokenFlow.values()).filter(flow => Math.abs(flow) > 0.000001); // Filter out dust
        

        
        if (tokenFlows.length >= 2) {
          const allPositive = tokenFlows.every(flow => flow > 0);
          const allNegative = tokenFlows.every(flow => flow < 0);
          
          if (allPositive || allNegative) {
            // User received both tokens OR sent both tokens = liquidity operation
            mappingStats.unknownTxSkippedNoJito++; // for now unknownTxSkippedNoJito is misleading, it should be unknownTxSkippedLiquidityOperation but we need to change the database schema first
            continue;
          }
          // Mixed directions = swap operation, allow through
        }
        // Single token flow or no significant flows = allow through (could be fee payments, etc.)
      }
    }
    // --- End Liquidity Operation Detection Heuristic ---

    let inputsGeneratedThisTransaction = 0; // Track inputs for current transaction

    try {
      const processedRecordKeys = new Set<string>();
      let feeAssignedForSignature = false;
      const lowerWalletAddress = walletAddress.toLowerCase(); // Ensure this is defined early

      // Commenting out userPaidTokenFeesMap as we are trying a new broader heuristic first
      /*
      const userPaidTokenFeesMap = new Map<string, number[]>();
      if (tx.events?.swap?.tokenFees) {
        for (const feeEntry of tx.events.swap.tokenFees) {
          if (feeEntry.userAccount?.toLowerCase() === lowerWalletAddress && feeEntry.mint && feeEntry.rawTokenAmount) {
            const feeAmount = parseRawTokenAmount(feeEntry.rawTokenAmount);
            if (Math.abs(feeAmount) > 0) { 
              if (!userPaidTokenFeesMap.has(feeEntry.mint)) {
                userPaidTokenFeesMap.set(feeEntry.mint, []);
              }
              userPaidTokenFeesMap.get(feeEntry.mint)!.push(Math.abs(feeAmount)); 
            }
          }
        }
      }
      */

      const userAccounts = new Set<string>([lowerWalletAddress]);
      for (const ad of tx.accountData || []) {
          if (ad.tokenBalanceChanges) {
              for (const tbc of ad.tokenBalanceChanges) {
                  if (tbc.userAccount?.toLowerCase() === lowerWalletAddress && tbc.tokenAccount) {
                      userAccounts.add(tbc.tokenAccount);
                  }
              }
          }
      }
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress && transfer.fromTokenAccount) {
              userAccounts.add(transfer.fromTokenAccount);
          }
          if (transfer.toUserAccount?.toLowerCase() === lowerWalletAddress && transfer.toTokenAccount) {
              userAccounts.add(transfer.toTokenAccount);
          }
      }

      // Calculate the net change in Native SOL, WSOL, and stablecoins for the user
      let netNativeSolChange = 0;
      let wsolChange = 0;
      const stableNetChanges = new Map<string, number>();

      for (const ad of tx.accountData || []) {
           if (ad.account.toLowerCase() === lowerWalletAddress) {
               netNativeSolChange = lamportsToSol(ad.nativeBalanceChange);
           }
           if (ad.tokenBalanceChanges) {
               for (const tbc of ad.tokenBalanceChanges) {
                   if (tbc.userAccount?.toLowerCase() === lowerWalletAddress) {
                       const changeAmount = parseRawTokenAmount(tbc.rawTokenAmount);
                       if (tbc.mint === SOL_MINT) wsolChange += changeAmount;
                       if (isStableMint(tbc.mint)) {
                           stableNetChanges.set(tbc.mint, (stableNetChanges.get(tbc.mint) || 0) + changeAmount);
                       }
                   }
               }
           }
      }
      const finalNetUserSolChange = netNativeSolChange + wsolChange;
      const stableNetChangeAbs = new Map<string, number>();
      for (const [mint, change] of stableNetChanges.entries()) {
          stableNetChangeAbs.set(mint, Math.abs(change));
      }
      const selectedStableNetChange = pickStableValueByPreference(stableNetChangeAbs, STABLE_VALUE_TOLERANCE);
      const finalNetUserStableChange = selectedStableNetChange?.value ?? 0;
      // logger.debug(`[DEBUG_VALUECALC] Tx ${tx.signature}: Net Native SOL Change=${netNativeSolChange.toFixed(9)}, WSOL Change=${wsolChange.toFixed(9)}, Stable Change=${finalNetUserStableChange.toFixed(9)} -> Final Net SOL=${finalNetUserSolChange.toFixed(9)}`);

      // Calculate gross native SOL flows (for cases where net change is near zero but user spent SOL)
      // This handles pump.fun and similar patterns where SOL is received and immediately spent
      let grossNativeSolOut = 0;
      let grossNativeSolIn = 0;
      for (const transfer of tx.nativeTransfers || []) {
          const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
          if (isFromUser || isToUser) {
              const rawLamports = transfer.amount;
              if (rawLamports !== undefined && rawLamports !== null) {
                  const lamportsNum = typeof rawLamports === 'string' ? parseInt(rawLamports, 10) : Number(rawLamports);
                  if (!isNaN(lamportsNum) && lamportsNum > 0) {
                      const solAmount = lamportsToSol(lamportsNum);
                      if (isFromUser) grossNativeSolOut += solAmount;
                      if (isToUser) grossNativeSolIn += solAmount;
                  }
              }
          }
      }

      // Calculate the total absolute movement and largest transfer of WSOL/stablecoins
      // Only count transfers involving the user (exclude router/router hops) to avoid double-counting.
      let totalWsolMovement = 0;
      let largestWsolTransfer = 0;
      let largestWsolTransferForSplDetection = 0; // Count ALL WSOL transfers for SPL-to-SPL detection
      let totalWsolForSplValue = 0; // Sum of ALL WSOL transfers for SPL-to-SPL value calculation
      // Track WSOL in/out separately so we can use the dominant side rather than summing both.
      // When WSOL is a relay (user receives then re-sends same amount), the gross sum double-counts.
      let totalWsolIn = 0;
      let totalWsolOut = 0;
      const stableFlows = new Map<string, { in: number; out: number }>();
      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.mint === SOL_MINT) {
              let wsolAmount = Math.abs(safeParseAmount(transfer));

              // HELIUS BUG MITIGATION: Apply same self-healing logic as main WSOL processing (lines 791-870)
              // This ensures totalWsolMovement and largestWsolTransfer are correctly calculated
              if (wsolAmount > 1000) {
                  const scaledAmount = wsolAmount / LAMPORTS_PER_SOL;
                  const expectedSolChange = Math.abs(finalNetUserSolChange);

                  const rawDiff = Math.abs(wsolAmount - expectedSolChange);
                  const scaledDiff = Math.abs(scaledAmount - expectedSolChange);

                  // Convert if scaled is 10x+ closer to expected
                  if (scaledDiff < rawDiff * 0.1) {
                      wsolAmount = scaledAmount;
                  } else if (wsolAmount > 1000000 && scaledAmount < 0.001) {
                      // Edge case: millions+ that scale to dust
                      wsolAmount = scaledAmount;
                  }
              }

              // Track WSOL transfers for SPL-to-SPL detection and value calculation (count ALL transfers)
              if (wsolAmount > largestWsolTransferForSplDetection) largestWsolTransferForSplDetection = wsolAmount;
              totalWsolForSplValue += wsolAmount;

              const fromUser =
                transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress ||
                (transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount));
              const toUser =
                transfer.toUserAccount?.toLowerCase() === lowerWalletAddress ||
                (transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount));

              // Ignore transfers not involving the user and internal user self-moves.
              // This check only applies to totalWsolMovement/largestWsolTransfer for the movement heuristic
              if (!fromUser && !toUser) continue;
              if (fromUser && toUser) continue;

              if (toUser) totalWsolIn += wsolAmount;
              else totalWsolOut += wsolAmount;
              if (wsolAmount > largestWsolTransfer) largestWsolTransfer = wsolAmount;
          }
          if (isStableMint(transfer.mint)) {
              const stableAmount = Math.abs(safeParseAmount(transfer));
              const fromUser =
                transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress ||
                (transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount));
              const toUser =
                transfer.toUserAccount?.toLowerCase() === lowerWalletAddress ||
                (transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount));

              if (!fromUser && !toUser) continue;
              if (fromUser && toUser) continue;

              const flow = stableFlows.get(transfer.mint) || { in: 0, out: 0 };
              if (toUser) flow.in += stableAmount;
              else flow.out += stableAmount;
              stableFlows.set(transfer.mint, flow);
          }
      }
      // Use the dominant WSOL side (max of in/out) rather than the gross sum.
      // When WSOL is a relay (received then immediately re-sent for the same amount),
      // summing both directions double-counts the economic movement.
      totalWsolMovement = Math.max(totalWsolIn, totalWsolOut);
      const stableMovementByMint = new Map<string, number>();
      const stableMovementByMintDominant = new Map<string, number>();
      for (const [mint, flow] of stableFlows.entries()) {
          const maxSide = Math.max(flow.in, flow.out);
          const netSide = Math.abs(flow.in - flow.out);
          if (maxSide === 0) continue;
          stableMovementByMint.set(mint, maxSide);
          if (netSide / maxSide >= STABLE_NET_DOMINANCE) {
              stableMovementByMintDominant.set(mint, maxSide);
          }
      }
      const selectedStableMovementAll = pickStableValueByPreference(stableMovementByMint, STABLE_VALUE_TOLERANCE);
      const selectedStableMovementDominant = pickStableValueByPreference(stableMovementByMintDominant, STABLE_VALUE_TOLERANCE);
      const totalStableMovement =
        totalWsolMovement >= SOL_SIGNIFICANCE_THRESHOLD
          ? (selectedStableMovementDominant?.value ?? 0)
          : (selectedStableMovementAll?.value ?? 0);
      // logger.debug(`[DEBUG_VALUECALC] Tx ${tx.signature}: Total WSOL Movement = ${totalWsolMovement.toFixed(9)}, Largest WSOL Transfer = ${largestWsolTransfer.toFixed(9)}, Total Stable Movement = ${totalStableMovement.toFixed(9)}`);
      // logger.debug(`[DEBUG_VALUECALC] Tx ${tx.signature}: stableFlows = ${JSON.stringify(Array.from(stableFlows.entries()).map(([mint, flow]) => ({ mint, in: flow.in, out: flow.out })))}`);

      // --- Heuristic Pre-calculation: Find largest transfer amount for each mint in this transaction ---
      const largestAmountsPerMintInTx = new Map<string, number>(); // Key: mint, Value: largest absolute amount
      const mintTransferCountsInTx = new Map<string, number>(); // Key: mint, Value: count of transfers for this mint

      for (const transfer of tx.tokenTransfers || []) {
          if (transfer.mint && transfer.tokenAmount != null) { // check for null/undefined tokenAmount
              const currentAbsAmount = Math.abs(safeParseAmount(transfer));
              if (currentAbsAmount > 0) {
                  largestAmountsPerMintInTx.set(
                      transfer.mint,
                      Math.max(largestAmountsPerMintInTx.get(transfer.mint) || 0, currentAbsAmount)
                  );
                  mintTransferCountsInTx.set(
                      transfer.mint,
                      (mintTransferCountsInTx.get(transfer.mint) || 0) + 1
                  );
              }
          }
      }
      // --- End Heuristic Pre-calculation ---

      // Detect SPL-to-SPL swaps using WSOL as an intermediary
      let isSplToSplSwap = false;
      let correctSolValueForSplToSpl = 0;
      const userNonWsolTokensOut = new Set<string>();
      const userNonWsolTokensIn = new Set<string>();
      for (const transfer of tx.tokenTransfers || []) {
          if (!transfer.mint) continue;
          if (transfer.mint === SOL_MINT || isStableMint(transfer.mint)) continue;
          const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
          const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
          if (isFromUser && !isToUser) userNonWsolTokensOut.add(transfer.mint);
          if (!isFromUser && isToUser) userNonWsolTokensIn.add(transfer.mint);
      }
      const hasTokensInBothDirections = userNonWsolTokensOut.size > 0 && userNonWsolTokensIn.size > 0;
      const maxTokenTypesForSimpleSwap = 3; // Heuristic threshold
      const hasReasonableTokenCount = userNonWsolTokensOut.size <= maxTokenTypesForSimpleSwap && userNonWsolTokensIn.size <= maxTokenTypesForSimpleSwap;
      const absSolChange = Math.abs(finalNetUserSolChange);
      const isApproximatelyDouble = largestWsolTransferForSplDetection > 0 && (Math.abs(absSolChange - (2 * largestWsolTransferForSplDetection)) / absSolChange < 0.20); // Ratio check heuristic
      if (hasTokensInBothDirections && largestWsolTransferForSplDetection > 0 && (isApproximatelyDouble || hasReasonableTokenCount)) {
          isSplToSplSwap = true;
          // For simple swaps (ratio check passes), use WSOL amount; for complex swaps, use average WSOL transferred (fair value of each side)
          correctSolValueForSplToSpl = isApproximatelyDouble ? largestWsolTransferForSplDetection : (totalWsolForSplValue / 2);
          mappingStats.splToSplSwapDetections++;
          // logger.debug(`Detected SPL-to-SPL swap with WSOL intermediary: ${tx.signature}`); // Removed debug
          // logger.debug(`Using largest WSOL transfer (${correctSolValueForSplToSpl.toFixed(9)}) as SOL value.`); // Removed debug
      }

      const preferNetSettlementForRoutedWsolSwap = shouldPreferNetSettlementForRoutedWsolSwap(
        tx,
        lowerWalletAddress,
        userAccounts,
        finalNetUserSolChange,
      );

      // Attempt to find intermediary value from swap events if not detected as SPL-to-SPL
      const interactionType = tx.type?.toUpperCase() || 'UNKNOWN';
      mappingStats.countByInteractionType[interactionType] = (mappingStats.countByInteractionType[interactionType] || 0) + 1;
      const isLiquidityStyleTransfer = isConfirmedLiquidityStyleTransfer(tx, lowerWalletAddress);

      let eventResult: { solValue: number; usdcValue: number; primaryOutMint: string | null; primaryInMint: string | null } = { solValue: 0, usdcValue: 0, primaryOutMint: null, primaryInMint: null };
      if (!isSplToSplSwap && tx.events?.swap) {
          eventResult = findIntermediaryValueFromEvent(tx, userAccounts, mappingStats);
      }

      // Process Native SOL Transfers (excluding dust amounts)
      for (const transfer of tx.nativeTransfers || []) {
           const rawLamports = transfer.amount;
           if (rawLamports === undefined || rawLamports === null) continue;
           const lamportsNum = typeof rawLamports === 'string' ? parseInt(rawLamports, 10) : Number(rawLamports);
           if (isNaN(lamportsNum)) continue;
           if (Math.abs(lamportsNum) < NATIVE_SOL_LAMPORT_THRESHOLD) continue; // Filter dust

           const isFromUser = transfer.fromUserAccount?.toLowerCase() === lowerWalletAddress;
           const isToUser = transfer.toUserAccount?.toLowerCase() === lowerWalletAddress;
           if (!isFromUser && !isToUser) continue; // Only transfers involving the user

           const amount = lamportsToSol(rawLamports);
           const direction = isToUser ? 'in' : 'out';
           const mint = SOL_MINT;
           const associatedSolValue = (isLiquidityStyleTransfer || preferNetSettlementForRoutedWsolSwap) ? 0 : amount; // Native SOL's value is itself unless this is a confirmed non-economic/routed-churn pattern
           const associatedUsdcValue = 0;
           const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromUserAccount ?? 'N/A'}:${transfer.toUserAccount ?? 'N/A'}:${amount.toFixed(9)}`;

           if (processedRecordKeys.has(recordKey)) continue;

           analysisInputs.push({
               walletAddress: walletAddress, signature: tx.signature, timestamp: tx.timestamp,
               mint: mint, amount: amount, direction: direction,
               associatedSolValue: associatedSolValue, associatedUsdcValue: associatedUsdcValue,
               interactionType: interactionType,
               feeAmount: null, // Native transfers don't get the calculated fee assigned here
               feePercentage: null,
           });
           processedRecordKeys.add(recordKey);
           mappingStats.nativeSolTransfersProcessed++; // Increment counter
           mappingStats.analysisInputsGenerated++;
           inputsGeneratedThisTransaction++;
      }

      // --- Fee Payer Heuristic Block ---
      const isFeePayerWalletA = tx.feePayer?.toLowerCase() === lowerWalletAddress;

      // DEBUG LOGGING TO CHECK FEE PAYER AND RAW EVENTS OBJECT
      if (tx.signature === "3Kc5xozpxra6g5UGKxLPH1nEda8jRyfyxsJcpS2tJNboYrWm3a1MFyHpgJRYvqxWt77srSRJMBsYkvdf86mqR4CX") {
        logger.warn(`FEE_PAYER_DEBUG_PRE_CHECK for ${tx.signature}: isFeePayerWalletA = ${isFeePayerWalletA}, tx.feePayer = ${tx.feePayer}, lowerWalletAddress = ${lowerWalletAddress}`);
        logger.warn(`FEE_PAYER_DEBUG_PRE_CHECK for ${tx.signature}: tx.events object: ${JSON.stringify(tx.events, null, 2)}`);
      }

      if (isFeePayerWalletA && tx.events?.swap) {
          // Original conditional debug log for swapEvent data (can be kept or removed if the one above is sufficient)
          if (tx.signature === "3Kc5xozpxra6g5UGKxLPH1nEda8jRyfyxsJcpS2tJNboYrWm3a1MFyHpgJRYvqxWt77srSRJMBsYkvdf86mqR4CX") {
            logger.warn(`FEE_PAYER_DEBUG_IN_BLOCK for ${tx.signature}: swapEvent data: ${JSON.stringify(tx.events.swap, null, 2)}`);
          }
          const swapEvent = tx.events.swap;
          let heuristicAssociatedSolValue = 0;
          let heuristicAssociatedUsdcValue = 0;
          const stableHeuristicValues = new Map<string, number>();

          // Determine SOL/stable value of this specific swap event more globally
          // Prioritize WSOL from outputs first, then inputs for heuristic SOL value.
          for (const out of swapEvent.tokenOutputs || []) {
              if (out.mint === SOL_MINT) {
                  heuristicAssociatedSolValue = Math.max(heuristicAssociatedSolValue, Math.abs(safeParseAmount(out)));
              }
              if (isStableMint(out.mint)) {
                  stableHeuristicValues.set(out.mint, Math.max(stableHeuristicValues.get(out.mint) || 0, Math.abs(safeParseAmount(out))));
              }
          }
          // If no significant SOL value found in outputs, check inputs.
          if (heuristicAssociatedSolValue < FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_SOL) {
              for (const inp of swapEvent.tokenInputs || []) {
                  if (inp.mint === SOL_MINT) {
                      heuristicAssociatedSolValue = Math.max(heuristicAssociatedSolValue, Math.abs(safeParseAmount(inp)));
                  }
              }
          }
          // If no significant stable value found in outputs, check inputs.
          for (const inp of swapEvent.tokenInputs || []) {
              if (isStableMint(inp.mint)) {
                  stableHeuristicValues.set(inp.mint, Math.max(stableHeuristicValues.get(inp.mint) || 0, Math.abs(safeParseAmount(inp))));
              }
          }

          // Fallback to innerSwaps if still not significant enough from top-level event data
          if ((heuristicAssociatedSolValue < FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_SOL && stableHeuristicValues.size === 0) && swapEvent.innerSwaps) {
              for (const inner of swapEvent.innerSwaps) {
                  for (const out of inner.tokenOutputs || []) {
                      const amount = Math.abs(safeParseAmount(out));
                      if (out.mint === SOL_MINT) heuristicAssociatedSolValue = Math.max(heuristicAssociatedSolValue, amount);
                      if (isStableMint(out.mint)) {
                          stableHeuristicValues.set(out.mint, Math.max(stableHeuristicValues.get(out.mint) || 0, amount));
                      }
                  }
                  for (const inp of inner.tokenInputs || []) {
                      const amount = Math.abs(safeParseAmount(inp));
                      if (inp.mint === SOL_MINT) heuristicAssociatedSolValue = Math.max(heuristicAssociatedSolValue, amount);
                      if (isStableMint(inp.mint)) {
                          stableHeuristicValues.set(inp.mint, Math.max(stableHeuristicValues.get(inp.mint) || 0, amount));
                      }
                  }
              }
          }

          const selectedStableHeuristic = pickStableValueByPreference(stableHeuristicValues, STABLE_VALUE_TOLERANCE);
          if (selectedStableHeuristic) {
              heuristicAssociatedUsdcValue = selectedStableHeuristic.value;
          }
          
          const meetsSolSignificance = heuristicAssociatedSolValue >= FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_SOL;
          const meetsUsdcSignificance = heuristicAssociatedUsdcValue >= FEE_PAYER_SWAP_SIGNIFICANCE_THRESHOLD_USDC;

          if (meetsSolSignificance || meetsUsdcSignificance) {
              // logger.debug(`Tx ${tx.signature}: Fee payer heuristic triggered for ${walletAddress} with swap value ~${heuristicAssociatedSolValue.toFixed(4)} SOL / ~${heuristicAssociatedUsdcValue.toFixed(4)} USDC.`); // too verbose unccomment when needed

              mappingStats.feePayerHeuristicApplied++;

              // Process token inputs of the swap event as 'out' for walletAddress
              for (const tokenIn of swapEvent.tokenInputs || []) {
                  const inputMint = tokenIn.mint;
                  // Only attribute SPL tokens this way, not the SOL/stable itself if it's the value metric
                  if (!inputMint || inputMint === SOL_MINT || isStableMint(inputMint)) continue;

                  const inputAmount = safeParseAmount(tokenIn);
                  const isFeePayerTheOwner = tokenIn.userAccount?.toLowerCase() === lowerWalletAddress ||
                                            (tokenIn.tokenAccount && userAccounts.has(tokenIn.tokenAccount));

                  if (!isFeePayerTheOwner && Math.abs(inputAmount) > 0) {
                      const recordKey = `${tx.signature}:${inputMint}:out:FEE_PAYER_HEURISTIC:${walletAddress}:${Math.abs(inputAmount).toFixed(9)}`;
                      if (!processedRecordKeys.has(recordKey)) {
                          analysisInputs.push({
                              walletAddress: walletAddress, signature: tx.signature, timestamp: tx.timestamp,
                              mint: inputMint, amount: Math.abs(inputAmount), direction: 'out',
                              associatedSolValue: heuristicAssociatedSolValue,
                              associatedUsdcValue: heuristicAssociatedUsdcValue,
                              interactionType: 'SWAP_FEE_PAYER',
                              feeAmount: null, feePercentage: null,
                          });
                          processedRecordKeys.add(recordKey);
                          logger.debug(`Tx ${tx.signature} Mint ${inputMint}: FEE PAYER heuristic - Attributed SWAP EVENT INPUT to ${walletAddress} as OUT.`);
                      }
                  }
              }

              // Process token outputs of the swap event as 'in' for walletAddress
              for (const tokenOut of swapEvent.tokenOutputs || []) {
                  const outputMint = tokenOut.mint;
                  if (!outputMint || outputMint === SOL_MINT || isStableMint(outputMint)) continue;

                  const outputAmount = safeParseAmount(tokenOut);
                  const isFeePayerTheOwner = tokenOut.userAccount?.toLowerCase() === lowerWalletAddress ||
                                             (tokenOut.tokenAccount && userAccounts.has(tokenOut.tokenAccount));

                  if (!isFeePayerTheOwner && Math.abs(outputAmount) > 0) {
                      const recordKey = `${tx.signature}:${outputMint}:in:FEE_PAYER_HEURISTIC:${walletAddress}:${Math.abs(outputAmount).toFixed(9)}`;
                      if (!processedRecordKeys.has(recordKey)) {
                          analysisInputs.push({
                              walletAddress: walletAddress, signature: tx.signature, timestamp: tx.timestamp,
                              mint: outputMint, amount: Math.abs(outputAmount), direction: 'in',
                              associatedSolValue: heuristicAssociatedSolValue,
                              associatedUsdcValue: heuristicAssociatedUsdcValue,
                              interactionType: 'SWAP_FEE_PAYER',
                              feeAmount: null, feePercentage: null,
                          });
                          processedRecordKeys.add(recordKey);
                          logger.debug(`Tx ${tx.signature} Mint ${outputMint}: FEE PAYER heuristic - Attributed SWAP EVENT OUTPUT to ${walletAddress} as IN.`);
                      }
                  }
              }
          }
      }
      // --- End of Fee Payer Heuristic Block ---

      // --- Track value assignment per mint+direction to avoid double counting ---
      const valueAssignedForMintDirection = new Set<string>();
      // --- End tracking set ---

      // Process SPL Token Transfers
      const txStartIndex = analysisInputs.length; // Capture start index for this transaction
      for (const transfer of tx.tokenTransfers || []) {
            let currentTransferAmount = 0, isWsol = false, isStable = false;
            let direction: 'in' | 'out' | null = null;
            let associatedSolValue = 0, associatedUsdcValue = 0;
            let associatedSolValueSource: 'none' | 'wsol' | 'stable' | 'event' | 'spl-to-spl' | 'total-movement' | 'gross-out' | 'net-change' = 'none';
            let associatedUsdcValueSource: 'none' | 'stable' | 'event' | 'total-movement' | 'net-change' = 'none';

             currentTransferAmount = safeParseAmount(transfer); 
             const currentAbsTransferAmount = Math.abs(currentTransferAmount);

             if (currentAbsTransferAmount === 0) continue;
             const mint = transfer.mint;
             if (!mint) continue;
             isWsol = mint === SOL_MINT; isStable = isStableMint(mint);

             const fromUserTA = transfer.fromTokenAccount && userAccounts.has(transfer.fromTokenAccount);
             const toUserTA = transfer.toTokenAccount && userAccounts.has(transfer.toTokenAccount);

            // Detect burns: transfer to empty/null token account (true burns have no destination)
            // NOTE: toUserAccount can be empty in legitimate swaps (token goes to DEX/program)
            // We only consider it a burn if BOTH toUserAccount AND toTokenAccount are empty
            const isBurn = fromUserTA && (
                (!transfer.toTokenAccount || transfer.toTokenAccount === "") &&
                (!transfer.toUserAccount || transfer.toUserAccount === "")
            );

            if (toUserTA && !fromUserTA) direction = 'in';
            else if (fromUserTA && !toUserTA) direction = 'out';
            else if (fromUserTA && toUserTA) {
                // Ignore self-transfers to avoid distorting FIFO inventory.
                continue;
            }
            if (!direction) continue;

             // --- Duplicate value-assignment guard ---
             const mintDirectionKey = `${mint}:${direction}`;
             // We will compute associatedSolValue/associatedUsdcValue as usual, but if a non-zero value
             // has already been assigned for this mint+direction in the current transaction we will zero
             // it out to avoid double-counting across transfer chunks.
             // The actual assignment logic is done *after* we determine the candidate values.
             // --- End duplicate guard placeholder ---

             // --- Burn Detection: Skip Value Attribution ---
             // Burns (transfers to empty address) have no economic value
             // Any SOL movement is rent reclaim, not asset value
             if (isBurn || isLiquidityStyleTransfer) {
                associatedSolValue = 0;
                associatedUsdcValue = 0;
             }
             // --- Apply Heuristic for Small Outgoing Transfers ---
             else {
                let applyFeeHeuristic = false;
                if (direction === 'out' && mint && largestAmountsPerMintInTx.has(mint)) {
                   const largestAmtForThisMint = largestAmountsPerMintInTx.get(mint)!;
                   const countForThisMint = mintTransferCountsInTx.get(mint) || 0;

                   if (countForThisMint > 1 &&
                       currentAbsTransferAmount < largestAmtForThisMint && // Ensure it's not the largest amount itself
                       currentAbsTransferAmount < (TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD * largestAmtForThisMint)) {
                       applyFeeHeuristic = true;
                       mappingStats.smallOutgoingHeuristicApplied++;
                   }
                }

                if (applyFeeHeuristic) {
                   associatedSolValue = 0;
                   associatedUsdcValue = 0;
                } else {
                 // --- Original Value Association Logic (if not a heuristic-identified fee) ---
                 if (isWsol) {
                      // ============================================================================
                      // HELIUS API BUG MITIGATION: WSOL tokenAmount Inconsistent Scaling
                      // ============================================================================
                      //
                      // PROBLEM:
                      // Helius API documentation claims that `tokenAmount` in `tokenTransfers` is
                      // always "human-readable" (already scaled by token decimals). However, in
                      // practice, WSOL (Wrapped SOL) tokenAmount is sometimes provided as:
                      //   - Correct: 0.00008073 SOL (human-readable, 9 decimal places)
                      //   - Incorrect: 80730 (raw lamports, needs division by 10^9)
                      //
                      // IMPACT:
                      // Without mitigation, incorrect lamport values cause catastrophic P&L errors:
                      //   - Example: 80730 lamports (0.00008073 SOL) reported as 80730 SOL
                      //   - Result: Wallet P&L shows -6,005,592 SOL (-$749.5M) instead of -0.006 SOL
                      //
                      // DETECTION STRATEGY:
                      // 1. Only check values > 1000 (normal swaps are 0.001-100 SOL, unaffected)
                      // 2. Cross-reference with `nativeBalanceChange` (always reliable, in lamports)
                      // 3. Compare raw vs scaled distance to expected SOL change
                      // 4. Only convert if scaled value is 10x+ closer (high confidence)
                      //
                      // EXAMPLES:
                      //
                      // Case 1: Broken transaction (lamports sent instead of SOL)
                      //   wsolAmount = 80730
                      //   expectedSolChange = 0.000166718 SOL (from nativeBalanceChange)
                      //   scaledAmount = 80730 / 10^9 = 0.00008073 SOL
                      //   rawDiff = |80730 - 0.000166718| = 80729.9... (huge!)
                      //   scaledDiff = |0.00008073 - 0.000166718| = 0.000086 (tiny)
                      //   → scaledDiff < rawDiff * 0.1? YES → Convert to 0.00008073 SOL ✅
                      //
                      // Case 2: Normal transaction (correctly scaled)
                      //   wsolAmount = 0.008173512 SOL
                      //   → Value < 1000, validation never triggers → Use as-is ✅
                      //
                      // Case 3: Whale transfer (legitimate large amount)
                      //   wsolAmount = 5000 SOL
                      //   expectedSolChange ≈ 5000 SOL
                      //   scaledAmount = 5000 / 10^9 = 0.000005 SOL
                      //   rawDiff ≈ 0 (already correct)
                      //   scaledDiff ≈ 5000 (would be wrong)
                      //   → scaledDiff < rawDiff * 0.1? NO → Keep 5000 SOL ✅
                      //
                      // NOTE: This issue was discovered on 2025-01-23 affecting wallet
                      // qdnviuUs22gNUEzSK6pLxQVsYqzGBYvqe8jznbFhJiW with multiple transactions
                      // showing lamport values instead of SOL.
                      // ============================================================================

                      let wsolAmount = currentAbsTransferAmount;

                      // Trigger validation only for suspiciously large values (> 1000 SOL)
                      // Most legitimate swaps are well below this threshold
                      if (wsolAmount > 1000) {
                          const scaledAmount = wsolAmount / LAMPORTS_PER_SOL;
                          const expectedSolChange = Math.abs(finalNetUserSolChange); // Reliable reference from nativeBalanceChange

                          // Calculate distance from expected value for both raw and scaled versions
                          const rawDiff = Math.abs(wsolAmount - expectedSolChange);
                          const scaledDiff = Math.abs(scaledAmount - expectedSolChange);

                          // PRIMARY CHECK: Is scaled version significantly closer to expected? (10x+ closer)
                          // This high threshold ensures we don't mistakenly convert legitimate whale transfers
                          if (scaledDiff < rawDiff * 0.1) {
                              logger.warn(
                                  `Tx ${tx.signature}: Helius WSOL bug confirmed - tokenAmount ${wsolAmount.toFixed(0)} is lamports. ` +
                                  `Auto-corrected to ${scaledAmount.toFixed(9)} SOL (validated against native change: ${expectedSolChange.toFixed(9)} SOL)`
                              );
                              wsolAmount = scaledAmount;
                          } else if (wsolAmount > 1000000 && scaledAmount < 0.001) {
                              // EDGE CASE: Value is millions+ but scaled is dust
                              // This pattern (e.g., 6,005,592 → 0.006 SOL) is definitely lamports
                              // even if nativeBalanceChange doesn't match (due to multiple WSOL movements)
                              logger.warn(
                                  `Tx ${tx.signature}: Helius WSOL bug confirmed (edge case) - tokenAmount ${wsolAmount.toFixed(0)} is lamports. ` +
                                  `Auto-corrected to ${scaledAmount.toFixed(9)} SOL`
                              );
                              wsolAmount = scaledAmount;
                          } else {
                              // VALIDATION FAILED: Keep raw value as it appears legitimate
                              // This protects genuine whale transfers (e.g., 5000 SOL transfers)
                              logger.info(
                                  `Tx ${tx.signature}: Large WSOL value ${wsolAmount.toFixed(2)} validated as correct SOL amount ` +
                                  `(not lamports - native change: ${expectedSolChange.toFixed(9)} SOL)`
                              );
                          }
                      }

                      associatedSolValue = wsolAmount;
                      associatedSolValueSource = 'wsol';
                 } else if (isStable) {
                      associatedUsdcValue = currentAbsTransferAmount; // Stable USD value equals token amount
                      associatedUsdcValueSource = 'stable';
                 } else {
                      // Non-WSOL/stable: Use tiered logic (thresholds defined at module level)

                       if (interactionType === 'CREATE_POOL') {
                           // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): CREATE_POOL type. Applying specific logic.`);
                           // For CREATE_POOL, prioritize event data.
                           // If not available, use net user SOL change as it reflects direct user SOL cost/gain for this pool action.
                           const eventSolFound = eventResult.solValue > 0; const eventUsdcFound = eventResult.usdcValue > 0;
                           let eventValueApplied = false;
                           const isPrimaryOutTokenFromEvent = direction === 'out' && mint === eventResult.primaryOutMint;
                           const isPrimaryInTokenFromEvent = direction === 'in' && mint === eventResult.primaryInMint;
 
                           if ((isPrimaryInTokenFromEvent || isPrimaryOutTokenFromEvent)) {
                               if (eventSolFound) { associatedSolValue = eventResult.solValue; associatedSolValueSource = 'event'; eventValueApplied = true; }
                               else if (eventUsdcFound) { associatedUsdcValue = eventResult.usdcValue; associatedUsdcValueSource = 'event'; eventValueApplied = true; }
                           }
 
                           if (!eventValueApplied) {
                               const absSolChange = Math.abs(finalNetUserSolChange);
                               const absStableChange = Math.abs(finalNetUserStableChange);
                               const solIsSignificant = absSolChange >= SOL_SIGNIFICANCE_THRESHOLD;
                               const stableIsSignificant = absStableChange >= STABLE_SIGNIFICANCE_THRESHOLD;

                               // Priority: Prefer SOL as single source of truth
                               // Only use stable when SOL is suspiciously tiny but stable is huge (routing/fee case)
                               if (solIsSignificant && !stableIsSignificant) {
                                   associatedSolValue = absSolChange;
                                   associatedSolValueSource = 'net-change';
                                   // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): CREATE_POOL - Assigned via Net SOL Change: ${associatedSolValue.toFixed(9)}`);
                               } else if (stableIsSignificant && !solIsSignificant) {
                                   associatedUsdcValue = absStableChange;
                                   associatedUsdcValueSource = 'net-change';
                                   // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): CREATE_POOL - Assigned via Net Stable Change: ${associatedUsdcValue.toFixed(9)}`);
                               } else if (solIsSignificant && stableIsSignificant) {
                                   // Both significant - use stable only if SOL is tiny (< 0.01) and stable is large (> 100)
                                   // This catches: 0.003 SOL (fees) vs 69,617 USDC (actual cost)
                                   if (absSolChange < 0.01 && absStableChange > 100) {
                                       associatedUsdcValue = absStableChange;
                                       associatedUsdcValueSource = 'net-change';
                                   } else {
                                       // Normal case - prefer SOL as single source of truth
                                       associatedSolValue = absSolChange;
                                       associatedSolValueSource = 'net-change';
                                   }
                               } else {
                                   // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): CREATE_POOL - No clear event value or significant net change. AssocSOL/stable remain 0 for this token leg.`);
                               }
                           }
                       } else {
                           // Original tiered logic for other transaction types (SWAP, etc.)
                           if (isSplToSplSwap && correctSolValueForSplToSpl > 0) {
                               associatedSolValue = correctSolValueForSplToSpl;
                               associatedSolValueSource = 'spl-to-spl';
                               mappingStats.associatedValueFromSplToSpl++;
                           } else {
                               // 2. Event Matching Check
                               const eventSolFound = eventResult.solValue > 0; const eventUsdcFound = eventResult.usdcValue > 0;
                               let eventValueApplied = false;
                               const isPrimaryOutTokenFromEvent = direction === 'out' && mint === eventResult.primaryOutMint;
                               const isPrimaryInTokenFromEvent = direction === 'in' && mint === eventResult.primaryInMint;
                               if ((isPrimaryInTokenFromEvent || isPrimaryOutTokenFromEvent)) {
                                   if (eventSolFound) { associatedSolValue = eventResult.solValue; associatedSolValueSource = 'event'; eventValueApplied = true; mappingStats.associatedValueFromEventMatcher++; }
                                   else if (eventUsdcFound) { associatedUsdcValue = eventResult.usdcValue; associatedUsdcValueSource = 'event'; eventValueApplied = true; mappingStats.associatedValueFromEventMatcher++; }
                               }

                               // 3. Fallback: Total Movement Heuristic
                               // CORRECT PRIORITY ORDER (fixed 2026-01-26):
                               // 1. Actual WSOL movement (from WSOL token transfers involving user)
                               // 2. Stable movement (USDC/USDT/USD1)
                               // 3. Net SOL change (last resort - might just be fees+rent)
                               if (!eventValueApplied && associatedSolValue === 0 && associatedUsdcValue === 0) {
                                const absSolChange = Math.abs(finalNetUserSolChange);

                                // Check significance of each value source
                                const actualWsolMovement = totalWsolMovement;
                                const wsolIsSignificant = actualWsolMovement >= SOL_SIGNIFICANCE_THRESHOLD;
                                const stableIsSignificant = totalStableMovement >= STABLE_SIGNIFICANCE_THRESHOLD;
                                const netSolIsSignificant = absSolChange >= SOL_SIGNIFICANCE_THRESHOLD;
                                // Guard: stable must be a real economic input/output, not just a protocol fee.
                                // Protocol fees on WSOL swaps are typically <$5 USDC.
                                // Real USDC swap amounts are typically >$10.
                                // Using a $10 minimum for stableIsPrimary safely separates fees from trades
                                // without encoding any price assumptions (it's a USD threshold, not a SOL ratio).
                                const absStableNetChange = Math.abs(finalNetUserStableChange);
                                const STABLE_PRIMARY_MIN_USD = 10;
                                const stableIsPrimary = stableIsSignificant &&
                                    absStableNetChange >= STABLE_PRIMARY_MIN_USD;

                                // Priority 1: Actual WSOL movement (clear economic value from WSOL token transfers)
                                // Skip if stable is the primary value — when a stablecoin is the real input/output
                                // (USDC→WSOL→token or token→WSOL→USDC), WSOL is just a routing relay.
                                if (wsolIsSignificant && !stableIsPrimary && preferNetSettlementForRoutedWsolSwap && netSolIsSignificant) {
                                    associatedSolValue = absSolChange;
                                    associatedSolValueSource = 'net-change';
                                    mappingStats.associatedValueFromNetChange++;
                                }
                                else if (wsolIsSignificant && !stableIsPrimary) {
                                    associatedSolValue = actualWsolMovement;
                                    associatedSolValueSource = 'total-movement';
                                    mappingStats.associatedValueFromTotalMovement++;
                                }
                                // Priority 2: Stable movement (USDC/USDT/USD1 - clear economic value)
                                // Also fires when stableIsPrimary — stable is the true settled denomination
                                // and WSOL was just routing infrastructure.
                                else if (stableIsSignificant) {
                                    associatedUsdcValue = totalStableMovement;
                                    associatedUsdcValueSource = 'total-movement';
                                    mappingStats.associatedValueFromTotalMovement++;
                                }
                                // Priority 3: Net SOL change (last resort - might just be fees/rent, but best guess)
                                else if (netSolIsSignificant) {
                                    associatedSolValue = absSolChange;
                                    associatedSolValueSource = 'total-movement';
                                    mappingStats.associatedValueFromTotalMovement++;
                                }
                            }

                            // 3.5. NEW TIER: Gross Native SOL Outflow (pump.fun pattern)
                            // When net SOL change is near zero but user spent significant SOL,
                            // use the gross outflow as the purchase price
                            // Common in pump.fun: user receives SOL then immediately spends it in same tx
                            if (associatedSolValue === 0 && associatedUsdcValue === 0) {
                                const absSolChange = Math.abs(finalNetUserSolChange);
                                const netIsNearZero = absSolChange < 0.001; // Net change < 0.001 SOL
                                const grossOutIsSignificant = grossNativeSolOut >= 0.001; // Gross out >= 0.001 SOL
                                const grossInIsLow = grossNativeSolIn <= grossNativeSolOut * GROSS_NATIVE_SOL_IN_RATIO_LIMIT; // Avoid rent-return patterns

                                if (netIsNearZero && grossOutIsSignificant && grossInIsLow) {
                                    associatedSolValue = grossNativeSolOut;
                                    associatedSolValueSource = 'gross-out';
                                    mappingStats.associatedValueFromTotalMovement++; // Reuse this counter
                                    // logger.debug(`Tx ${tx.signature}, Mint ${mint}: Used gross native SOL outflow ${grossNativeSolOut.toFixed(9)} (net was ${absSolChange.toFixed(9)})`);
                                }
                            }

                            // 4. Fallback: Net User SOL/Stable Change
                            // BUT: Check if net change is just the transaction fee (not actual economic value)
                            // This happens with airdrops/transfers where user pays fee but receives tokens with no SOL value
                            if (associatedSolValue === 0 && associatedUsdcValue === 0) {
                                const absSolChange = Math.abs(finalNetUserSolChange);
                                const absStableChange = Math.abs(finalNetUserStableChange);
                                const solChangeIsSignificant = absSolChange >= SOL_SIGNIFICANCE_THRESHOLD;
                                const stableChangeIsSignificant = absStableChange >= STABLE_SIGNIFICANCE_THRESHOLD;

                                // Calculate transaction fee for comparison
                                const networkFee = tx.fee ?? 0;
                                const feeInSol = networkFee / LAMPORTS_PER_SOL;

                                // Check if net SOL change is approximately just the fee (within 10% tolerance)
                                // If so, it's likely an airdrop/transfer where fee is paid but tokens have no SOL value
                                const netChangeIsJustFee = feeInSol > 0 &&
                                    Math.abs(absSolChange - feeInSol) < (feeInSol * 0.1) &&
                                    absSolChange < 0.02; // And the amount is small (< 0.02 SOL)

                                if (netChangeIsJustFee) {
                                    // Net change is just the fee - don't use it as economic value
                                    // This is an airdrop/transfer with zero cost basis
                                    // Leave associatedSolValue = 0
                                } else if (solChangeIsSignificant && !stableChangeIsSignificant) {
                                    // SOL is significant and no stable - use it
                                    associatedSolValue = absSolChange;
                                    associatedSolValueSource = 'net-change';
                                    mappingStats.associatedValueFromNetChange++;
                                } else if (stableChangeIsSignificant && !solChangeIsSignificant) {
                                    // Stable is significant and no SOL - use it
                                    associatedUsdcValue = absStableChange;
                                    associatedUsdcValueSource = 'net-change';
                                    mappingStats.associatedValueFromNetChange++;
                                } else if (solChangeIsSignificant && stableChangeIsSignificant) {
                                    // BOTH are significant - use stable only if SOL is tiny and stable is huge
                                    // This catches: 0.003 SOL (fees) vs 69,617 USDC (actual cost)
                                    if (absSolChange < 0.01 && absStableChange > 100) {
                                        associatedUsdcValue = absStableChange;
                                        associatedUsdcValueSource = 'net-change';
                                        mappingStats.associatedValueFromNetChange++;
                                    } else {
                                        // Normal case - prefer SOL as single source of truth
                                        associatedSolValue = absSolChange;
                                        associatedSolValueSource = 'net-change';
                                        mappingStats.associatedValueFromNetChange++;
                                    }
                                }
                            }
                       }
                   }
              }
             }
          } // End of burn/fee heuristic check

            // Non-economic order placement/cancel should not carry economic value.
            if (interactionType === 'CREATE_ORDER' || interactionType === 'CANCEL_ORDER') {
                associatedSolValue = 0;
                associatedUsdcValue = 0;
            }

            // Duplicate value-assignment guard (actual enforcement)
            if (!isWsol && !isStable && (Math.abs(associatedSolValue) > FEE_PRECISION_THRESHOLD || Math.abs(associatedUsdcValue) > FEE_PRECISION_THRESHOLD)) {
               if (valueAssignedForMintDirection.has(mintDirectionKey)) {
                   // A value has already been assigned for this mint+direction; zero out to avoid double counting
                   associatedSolValue = 0;
                   associatedUsdcValue = 0;
                   associatedSolValueSource = 'none';
                   associatedUsdcValueSource = 'none';
               } else {
                   valueAssignedForMintDirection.add(mintDirectionKey);
               }
            }

            // --- Fee Calculation & Assignment (Only for non-WSOL/stable transfers with associated SOL value) ---
            let feeAmount: number | null = null;
            let feePercentage: number | null = null;

            if (!isWsol && !isStable && associatedSolValue > FEE_PRECISION_THRESHOLD && !feeAssignedForSignature) {
                 // Calculate refined fee (network fee + small native transfers out)
                let refinedFeeAmountSol = 0;
                const networkFee = tx.fee ?? 0;
                if (networkFee > 0 && tx.feePayer?.toLowerCase() === lowerWalletAddress) {
                    refinedFeeAmountSol += networkFee / LAMPORTS_PER_SOL;
                }
                for (const nativeTransfer of tx.nativeTransfers || []) {
                    // Only transfers OUT from user to others, below the threshold
                    if (nativeTransfer.fromUserAccount?.toLowerCase() !== lowerWalletAddress || nativeTransfer.toUserAccount?.toLowerCase() === lowerWalletAddress) continue;
                    const transferAmountSol = lamportsToSol(nativeTransfer.amount);
                    const maxFeeLikeTransfer = Math.min(
                      FEE_TRANSFER_THRESHOLD_SOL,
                      associatedSolValue * FEE_TRANSFER_VALUE_RATIO,
                    );
                    if (transferAmountSol > 0 && transferAmountSol <= maxFeeLikeTransfer) {
                        refinedFeeAmountSol += transferAmountSol;
                         // logger.debug(`Tx ${tx.signature}: Added small native transfer to fee amount: ${transferAmountSol.toFixed(9)} SOL to ${nativeTransfer.toUserAccount}`); // Removed debug
                    }
                }

                // CRITICAL FIX: Self-healing validation - if fee would be >50% of value, something is wrong
                // This catches cases where we mistakenly assigned fees/rent as the associatedSolValue
                if (refinedFeeAmountSol > FEE_PRECISION_THRESHOLD) {
                    const wouldBeFeePercentage = (refinedFeeAmountSol / associatedSolValue) * 100;
                    const isWeakValueSource =
                        associatedSolValueSource === 'net-change' ||
                        associatedSolValueSource === 'total-movement' ||
                        associatedSolValueSource === 'gross-out';

                    if (wouldBeFeePercentage > FEE_SELF_HEALING_PERCENT_THRESHOLD) {
                        if (isWeakValueSource) {
                            // Fee is >50% of value - this is wrong! The associatedSolValue is likely just fees/rent itself
                            mappingStats.feeSelfHealingTriggered++;
                            if (feeSelfHealingExamples.length < 2) {
                              feeSelfHealingExamples.push(
                                `${tx.signature} ${mint} (${direction}) fee%=${wouldBeFeePercentage.toFixed(1)} fee=${refinedFeeAmountSol.toFixed(6)} value=${associatedSolValue.toFixed(6)}`,
                              );
                            }
                            // Don't assign the fee, and zero out the suspect value
                            associatedSolValue = 0;
                            associatedUsdcValue = 0;
                            associatedSolValueSource = 'none';
                            associatedUsdcValueSource = 'none';
                        } else {
                            // Fee too large vs value, but value came from strong source - keep value, skip fee
                            // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee skipped due to high fee% with strong value source.`);
                        }
                    } else {
                        // Fee looks reasonable - assign it
                        feeAmount = refinedFeeAmountSol;
                        feePercentage = wouldBeFeePercentage;
                        feeAssignedForSignature = true;
                        // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Assigned: Refined Fee=${feeAmount.toFixed(9)}, Percentage=${feePercentage.toFixed(4)}`); // Removed debug
                    }
                } else {
                    // logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Skipped: No significant refined fee paid by user.`); // Removed debug
                }
            } // else { if (!isWsol && !isStable) logger.debug(`Tx ${tx.signature}, Mint ${mint} (${direction}): Fee Skipped: AssocSOL=0.`); } // Removed debug


            // --- Push Record ---
            const recordAmount = currentTransferAmount;
            const recordKey = `${tx.signature}:${mint}:${direction}:${transfer.fromTokenAccount ?? 'N/A'}:${transfer.toTokenAccount ?? 'N/A'}:${recordAmount.toFixed(9)}`;
            if (processedRecordKeys.has(recordKey)) {
                mappingStats.skippedDuplicateRecordKey++;
                continue;
            }

            // logger.debug(`[DEBUG_VALUECALC] Tx ${tx.signature}, Mint ${mint} (${direction}): FINAL VALUES BEFORE PUSH - associatedSolValue=${associatedSolValue.toFixed(9)}, associatedUsdcValue=${associatedUsdcValue.toFixed(9)}, feeAmount=${feeAmount?.toFixed(9) ?? 'null'}, feePercentage=${feePercentage?.toFixed(4) ?? 'null'}`);

            analysisInputs.push({
                 walletAddress: walletAddress,
                 signature: tx.signature,
                 timestamp: tx.timestamp,
                 mint: mint,
                 amount: recordAmount,
                 direction: direction,
                 associatedSolValue: associatedSolValue,
                 associatedUsdcValue: associatedUsdcValue,
                 interactionType: interactionType,
                 feeAmount: feeAmount, // Calculated fee (or null)
                 feePercentage: feePercentage, // Calculated percentage (or null)
            });
            processedRecordKeys.add(recordKey);
            mappingStats.analysisInputsGenerated++;
            inputsGeneratedThisTransaction++;

            // Increment token type counters (already present from previous edit)
            mappingStats.tokenTransfersProcessed++;
            if (isWsol) mappingStats.wsolTransfersProcessed++;
            else if (isStable) mappingStats.usdcTransfersProcessed++;
            else mappingStats.otherTokenTransfersProcessed++;

            if (feeAmount !== null && Math.abs(feeAmount) > FEE_PRECISION_THRESHOLD) {
                mappingStats.feesCalculated++;
            }
      }

      // --- Proportional redistribution of value across multiple chunks of same mint+direction ---
      try {
        const redistributionBuckets = new Map<string, { totalAmount: number; totalSol: number; totalUsdc: number; rowIndexes: number[] }>();

        for (let idx = txStartIndex; idx < analysisInputs.length; idx++) {
          const row = analysisInputs[idx];
          // Skip WSOL / stable rows (their value equals their amount) and also skip native SOL rows
          if (!row || row.mint === SOL_MINT || isStableMint(row.mint)) continue;

          const key = `${row.mint}:${row.direction}`;
          if (!redistributionBuckets.has(key)) {
            redistributionBuckets.set(key, { totalAmount: 0, totalSol: 0, totalUsdc: 0, rowIndexes: [] });
          }
          const bucket = redistributionBuckets.get(key)!;
          bucket.rowIndexes.push(idx);
          bucket.totalAmount += Math.abs(row.amount);
          bucket.totalSol += row.associatedSolValue || 0;
          bucket.totalUsdc += row.associatedUsdcValue || 0;
        }

        for (const bucket of redistributionBuckets.values()) {
          if (bucket.rowIndexes.length <= 1) continue; // Nothing to redistribute

          const rowsInBucket = bucket.rowIndexes.map(idx => analysisInputs[idx]);
          const largestAmountInBucket = Math.max(...rowsInBucket.map(r => Math.abs(r.amount)));
          let valueDistributionAmount = 0;

          // Recalculate the amount over which to distribute the value, excluding fee-like transfers.
          for (const row of rowsInBucket) {
              const isLikelyFee = Math.abs(row.amount) < largestAmountInBucket &&
                                Math.abs(row.amount) < (TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD * largestAmountInBucket);
              if (!isLikelyFee) {
                  valueDistributionAmount += Math.abs(row.amount);
              }
          }

          if (valueDistributionAmount === 0) continue; // Avoid division by zero if all are fees

          if (bucket.totalSol > FEE_PRECISION_THRESHOLD) {
            const valuePerToken = bucket.totalSol / valueDistributionAmount;
            bucket.rowIndexes.forEach(idx => {
              const row = analysisInputs[idx];
              const isLikelyFee = Math.abs(row.amount) < largestAmountInBucket &&
                                Math.abs(row.amount) < (TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD * largestAmountInBucket);

              if (isLikelyFee) {
                row.associatedSolValue = 0;
                row.associatedUsdcValue = 0;
              } else {
                row.associatedUsdcValue = 0; // Ensure only one value type present
                row.associatedSolValue = Math.abs(row.amount) * valuePerToken;
              }
            });
          } else if (bucket.totalUsdc > FEE_PRECISION_THRESHOLD) {
            const valuePerToken = bucket.totalUsdc / valueDistributionAmount;
            bucket.rowIndexes.forEach(idx => {
              const row = analysisInputs[idx];
              const isLikelyFee = Math.abs(row.amount) < largestAmountInBucket &&
                                Math.abs(row.amount) < (TOKEN_FEE_HEURISTIC_MAPPER_THRESHOLD * largestAmountInBucket);

              if (isLikelyFee) {
                row.associatedSolValue = 0;
                row.associatedUsdcValue = 0;
              } else {
                row.associatedSolValue = 0;
                row.associatedUsdcValue = Math.abs(row.amount) * valuePerToken;
              }
            });
          }
        }
      } catch (redistErr) {
        logger.error(`Error during proportional value redistribution for tx ${tx.signature}`, { error: redistErr });
      }
      // --- End redistribution block ---

      if (preferNetSettlementForRoutedWsolSwap) {
        for (let idx = txStartIndex; idx < analysisInputs.length; idx += 1) {
          const row = analysisInputs[idx];
          if (!row || row.mint !== SOL_MINT) continue;
          row.associatedSolValue = 0;
          row.associatedUsdcValue = 0;
          row.feeAmount = null;
          row.feePercentage = null;
        }
      }

      // --- Drop intermediate tokens with zero net change within the same signature ---
      try {
        const txRows = analysisInputs.slice(txStartIndex);
        const mintNetMap = new Map<string, { in: number; out: number }>();
        for (const row of txRows) {
          if (!row || row.mint === SOL_MINT || isStableMint(row.mint)) continue;
          const current = mintNetMap.get(row.mint) || { in: 0, out: 0 };
          if (row.direction === 'in') current.in += Math.abs(row.amount);
          else if (row.direction === 'out') current.out += Math.abs(row.amount);
          mintNetMap.set(row.mint, current);
        }

        let hasNetPositiveToken = false;
        for (const flows of mintNetMap.values()) {
          if (Math.abs(flows.in - flows.out) > INTERMEDIATE_NET_EPSILON) {
            hasNetPositiveToken = true;
            break;
          }
        }

        if (hasNetPositiveToken) {
          const intermediateMints = new Set<string>();
          for (const [mint, flows] of mintNetMap.entries()) {
            if (flows.in > 0 && flows.out > 0 && Math.abs(flows.in - flows.out) <= INTERMEDIATE_NET_EPSILON) {
              intermediateMints.add(mint);
            }
          }

          if (intermediateMints.size > 0) {
            for (let idx = analysisInputs.length - 1; idx >= txStartIndex; idx -= 1) {
              const row = analysisInputs[idx];
              if (row && intermediateMints.has(row.mint)) {
                analysisInputs.splice(idx, 1);
              }
            }
          }
        }
        inputsGeneratedThisTransaction = analysisInputs.length - txStartIndex;
      } catch (filterErr) {
        logger.error(`Error filtering intermediate tokens for tx ${tx.signature}`, { error: filterErr });
      }
      // --- End intermediate token filter ---

      if (inputsGeneratedThisTransaction > 0) {
        mappingStats.transactionsSuccessfullyProcessed++;
      }

    } catch (err) {
        logger.error(`Mapper error processing transaction ${tx.signature}`, {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            sig: tx.signature,
        });
        // --- Log stats on specific error ---
        logger.debug(`Mapping stats at time of error for tx ${tx.signature}:`, mappingStats);
        // --- End Log stats on specific error ---
        mappingStats.transactionsSkippedError++; // Also count this as skipped due to error in processing
    }
  }

  // --- Log Final Stats ---

  // THIS LOGGER IS VERY USERFUL FOR DEBUGGING -> IT SHOWS ALL STATISTICS FOR THE BATCH MAPPED:
  // (SUCCESS,TOKEN TRANSFERR, FEEPAYER HEURISTICS, TYPE OF INTERACTIONS, ASSOCIATED SOL VALUE, ETC)
  // uncomment to see the stats
  // logger.info(`Finished mapping ${transactions.length} transactions for ${walletAddress}. Mapping statistics:`, mappingStats);
  
  // ✅ REDUCED LOGGING: Only log for larger batches to reduce spam during streaming
  if (transactions.length >= 200) {
    logger.info(`Finished mapping ${transactions.length} transactions for ${walletAddress}.`);
  } else {
    // logger.debug(`Finished mapping ${transactions.length} transactions for ${walletAddress}.`);
  }
  if (mappingStats.feeSelfHealingTriggered > 0) {
    const examples = feeSelfHealingExamples.length > 0 ? ` Examples: ${feeSelfHealingExamples.join(' | ')}` : '';
    // logger.debug(`Self-healing fee guard triggered ${mappingStats.feeSelfHealingTriggered}x for ${walletAddress}.${examples}`);
  }
  // --- End Log Final Stats ---

  // NEW: Definitive filtering. If a transaction involves any non-SOL/stable token,
  // we assume the SOL/stable movements are part of the "price" and should not be stored as separate rows.
  // This cleans up swaps, liquidity actions, and other DeFi interactions.

  // First, find all transaction signatures that involve a "real" asset token.
  const signaturesWithSplMovement = new Set<string>();
  for (const input of analysisInputs) {
    if (input.mint !== SOL_MINT && !isStableMint(input.mint)) {
      signaturesWithSplMovement.add(input.signature);
    }
  }

  // logger.debug(`[DEBUG_FILTER] Before filtering: ${analysisInputs.length} inputs. Signatures with SPL movement: ${signaturesWithSplMovement.size}`);

  // Then, filter the results based on the definitive rule.
  const filteredAnalysisInputs = analysisInputs.filter(input => {
    const isSolMint = input.mint === SOL_MINT;
    const isValueToken = isSolMint || isStableMint(input.mint);

    // If it's a value token (SOL/stable), apply filtering rules.
    if (isValueToken) {
      // Rule 0: Check dust FIRST before anything else (dust should always be filtered)
      // Even if a dust transfer somehow has associated value, it's still dust
      if (input.interactionType === 'TRANSFER' && Math.abs(input.amount) < SOL_DUST_TRANSFER_THRESHOLD) {
        // logger.debug(`[DEBUG_FILTER] FILTERED OUT ${input.mint} ${input.direction} (amount: ${input.amount}) - dust transfer`);
        return false;
      }

      // When a signature already contains a non-value asset, the SOL leg is only carrying
      // price context for that asset and does not need its own persisted row.
      if (isSolMint && signaturesWithSplMovement.has(input.signature)) {
        return false;
      }

      // CRITICAL FIX: If this stable transfer has significant associated value assigned to it,
      // NEVER filter it out. This represents the cost basis for routed swaps (e.g., USDC -> WSOL -> Token).
      const hasSignificantAssociatedValue =
        (input.associatedSolValue && Math.abs(input.associatedSolValue) >= SOL_SIGNIFICANCE_THRESHOLD) ||
        (input.associatedUsdcValue && Math.abs(input.associatedUsdcValue) >= STABLE_SIGNIFICANCE_THRESHOLD);

      if (hasSignificantAssociatedValue) {
        // logger.debug(`[DEBUG_FILTER] KEEPING ${input.mint} ${input.direction} (amount: ${input.amount}) - has significant associated value (SOL: ${input.associatedSolValue}, USDC: ${input.associatedUsdcValue})`);
        return true; // Always keep significant value transfers
      }

      // Rule 1: Remove if part of a larger DeFi transaction (swap, liquidity, etc.).
      if (signaturesWithSplMovement.has(input.signature)) {
        // logger.debug(`[DEBUG_FILTER] FILTERED OUT ${input.mint} ${input.direction} (amount: ${input.amount}) - part of DeFi transaction with SPL movement`);
        return false;
      }

      // If neither rule applies, keep the significant SOL/stable transfer.
      return true;
    }

    // Otherwise, it's a "real" asset token, so always keep it.
    return true;
  });

  // logger.debug(`[DEBUG_FILTER] After filtering: ${filteredAnalysisInputs.length} inputs remaining`);

  // Update stats to reflect the filtered count.
  const finalStats = { ...mappingStats };
  finalStats.analysisInputsGenerated = filteredAnalysisInputs.length;

  // DISABLED: Scam token filtering removed - keeping ALL tokens regardless of associated value
  // Reason: Many legitimate tokens don't have associatedSolValue/associatedUsdcValue due to:
  // - Airdrops (no swap, no value attribution)
  // - Complex transactions where value calculation failed
  // - Transactions without proper swap event data
  // We want to capture ALL token transfers, not just those with successful value attribution
  // Scam filtering should happen at the analysis level (BehaviorAnalyzer), not here in the mapper
  
  // logger.debug(`Scam filtering: DISABLED - keeping all ${filteredAnalysisInputs.length} tokens regardless of associated value`);

  return { analysisInputs: filteredAnalysisInputs, stats: finalStats };
}
