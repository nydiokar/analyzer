/**
 * This file adapts the logic from the backend's `report_utils.ts` for use in the frontend.
 * It provides functions to parse the `ComprehensiveSimilarityResult` and return structured data
 * suitable for rendering in React components, without any Node.js dependencies.
 */

import { ComprehensiveSimilarityResult } from "@/components/analysis-lab/results/types";

// --- Enums and Interfaces ---

export enum InsightType {
  SustainedAlignment = 'Sustained Alignment',
  RecentDivergence = 'Recent Divergence',
  RecentConvergence = 'Recent Convergence',
  SharedZeroHoldings = 'Shared Zero Holdings',
  SignificantAsymmetry = 'Significant Asymmetry',
  VeryHighSimilarity = 'Very High Similarity',
}

export interface KeyInsight {
  type: InsightType;
  wallets: [string, string];
  text: string;
  score: number;
  data: Record<string, any>;
}

// --- Constants (from backend) ---

const INSIGHT_THRESHOLDS = {
    VERY_HIGH_HISTORICAL_CAPITAL: 0.9,
    VERY_HIGH_HISTORICAL_BINARY: 0.85,
    STRONG_HISTORICAL_SIM: 0.6,
    MODERATE_HISTORICAL_SIM: 0.4,
    
    VERY_HIGH_HOLDINGS_JACCARD: 0.7,
    VERY_HIGH_HOLDINGS_COSINE: 0.8,
    STRONG_HOLDINGS_SIM: 0.5,
    MODERATE_HOLDINGS_SIM: 0.3,

    ASYMMETRY_HIGH_PCT: 70,
    ASYMMETRY_LOW_PCT: 20,
};

// --- Core Parsing Functions ---

export function generateKeyInsights(
    metrics: ComprehensiveSimilarityResult,
    walletLabels: Record<string, string>
): KeyInsight[] {
    const keyInsights: KeyInsight[] = [];
    const walletAddresses = Object.keys(metrics.walletVectorsUsed).sort();
    const uniqueTokensPerWallet = metrics.uniqueTokensPerWallet;

    // Pre-calculate a map to quickly check if a wallet has any current token holdings.
    const walletHoldingsPresence: Record<string, boolean> = {};
    if (metrics.walletBalances) {
        for (const addr of walletAddresses) {
            const balanceInfo = metrics.walletBalances[addr];
            walletHoldingsPresence[addr] = !!(balanceInfo && balanceInfo.tokenBalances && balanceInfo.tokenBalances.some((tb: { uiBalance?: number | null }) => tb.uiBalance && tb.uiBalance > 1e-9));
        }
    }

    for (let i = 0; i < walletAddresses.length; i++) {
        for (let j = i + 1; j < walletAddresses.length; j++) {
            const addrA = walletAddresses[i];
            const addrB = walletAddresses[j];

            const labelA = walletLabels[addrA] || addrA;
            const labelB = walletLabels[addrB] || addrB;

            const primaryHistPair = metrics.pairwiseSimilarities.find(p =>
                (p.walletA === addrA && p.walletB === addrB) || (p.walletA === addrB && p.walletB === addrA)
            );
            const primaryHistoricalSim = primaryHistPair?.similarityScore || 0;
            const historicalVectorType = metrics.vectorTypeUsed;

            const holdingsJaccardSim = metrics.holdingsPresenceJaccardMatrix?.[addrA]?.[addrB] ?? metrics.holdingsPresenceJaccardMatrix?.[addrB]?.[addrA] ?? 0;
            const holdingsCosineSim = metrics.holdingsPresenceCosineMatrix?.[addrA]?.[addrB] ?? metrics.holdingsPresenceCosineMatrix?.[addrB]?.[addrA] ?? 0;
            const holdingsMaxSim = Math.max(holdingsJaccardSim, holdingsCosineSim);

            const countHistorical = metrics.sharedTokenCountsMatrix[addrA]?.[addrB] || 0;
            const uniqueAHist = uniqueTokensPerWallet[addrA] || 0;
            const uniqueBHist = uniqueTokensPerWallet[addrB] || 0;
            const pctAHist = uniqueAHist > 0 ? (countHistorical / uniqueAHist) * 100 : 0;
            const pctBHist = uniqueBHist > 0 ? (countHistorical / uniqueBHist) * 100 : 0;

            const walletAHasHoldings = walletHoldingsPresence[addrA] || false;
            const walletBHasHoldings = walletHoldingsPresence[addrB] || false;

            // Insight: Very High Similarity
            const veryHighPrimaryThresh = historicalVectorType === 'capital' ? INSIGHT_THRESHOLDS.VERY_HIGH_HISTORICAL_CAPITAL : INSIGHT_THRESHOLDS.VERY_HIGH_HISTORICAL_BINARY;
            if (primaryHistoricalSim >= veryHighPrimaryThresh) {
                keyInsights.push({
                    type: InsightType.VeryHighSimilarity,
                    wallets: [labelA, labelB],
                    score: primaryHistoricalSim,
                    text: `Exceptionally high historical similarity (${historicalVectorType}). Shared ${countHistorical} tokens, making up ${pctAHist.toFixed(0)}% and ${pctBHist.toFixed(0)}% of their respective trading activity.`,
                    data: { primaryHistoricalSim, countHistorical, pctAHist, pctBHist, historicalVectorType }
                });
            }

            // Insight: Sustained Alignment
            if (primaryHistoricalSim >= INSIGHT_THRESHOLDS.STRONG_HISTORICAL_SIM && holdingsMaxSim >= INSIGHT_THRESHOLDS.STRONG_HOLDINGS_SIM) {
                keyInsights.push({
                    type: InsightType.SustainedAlignment,
                    wallets: [labelA, labelB],
                    score: primaryHistoricalSim,
                    text: `Strong alignment in both past trading activity and current portfolios, suggesting a consistent, shared strategy.`,
                    data: { primaryHistoricalSim, holdingsMaxSim, historicalVectorType }
                });
            }

            // Insight: Recent Convergence
            if (primaryHistoricalSim < INSIGHT_THRESHOLDS.MODERATE_HISTORICAL_SIM && holdingsMaxSim >= INSIGHT_THRESHOLDS.STRONG_HOLDINGS_SIM) {
                 keyInsights.push({
                    type: InsightType.RecentConvergence,
                    wallets: [labelA, labelB],
                    score: primaryHistoricalSim,
                    text: `Low historical alignment, but portfolios are very similar now. This suggests their strategies have recently converged.`,
                    data: { primaryHistoricalSim, holdingsMaxSim, historicalVectorType }
                });
            }

            // Insight: Recent Divergence
            if (walletAHasHoldings && walletBHasHoldings && primaryHistoricalSim >= INSIGHT_THRESHOLDS.STRONG_HISTORICAL_SIM && holdingsMaxSim < INSIGHT_THRESHOLDS.MODERATE_HOLDINGS_SIM) {
                 keyInsights.push({
                    type: InsightType.RecentDivergence,
                    wallets: [labelA, labelB],
                    score: primaryHistoricalSim,
                    text: `Strong alignment in past trading, but their current portfolios are different. This suggests their strategies have recently diverged.`,
                    data: { primaryHistoricalSim, holdingsMaxSim, historicalVectorType }
                });
            }

            // Insight: Shared Zero Holdings
            if (primaryHistoricalSim >= INSIGHT_THRESHOLDS.STRONG_HISTORICAL_SIM && !walletAHasHoldings && !walletBHasHoldings) {
                keyInsights.push({
                    type: InsightType.SharedZeroHoldings,
                    wallets: [labelA, labelB],
                    score: primaryHistoricalSim,
                    text: `These wallets traded very similarly in the past and both now hold no significant tokens, suggesting a synchronized exit or sell-off.`,
                    data: { primaryHistoricalSim, historicalVectorType }
                });
            }
            
            // Insight: Asymmetry
            if (primaryHistoricalSim >= INSIGHT_THRESHOLDS.MODERATE_HISTORICAL_SIM) {
                const isAsymmetricAB = pctAHist >= INSIGHT_THRESHOLDS.ASYMMETRY_HIGH_PCT && pctBHist <= INSIGHT_THRESHOLDS.ASYMMETRY_LOW_PCT;
                const isAsymmetricBA = pctBHist >= INSIGHT_THRESHOLDS.ASYMMETRY_HIGH_PCT && pctAHist <= INSIGHT_THRESHOLDS.ASYMMETRY_LOW_PCT;
                if (isAsymmetricAB || isAsymmetricBA) {
                    keyInsights.push({
                        type: InsightType.SignificantAsymmetry,
                        wallets: [labelA, labelB],
                        score: primaryHistoricalSim,
                        text: `Asymmetric relationship detected. The shared tokens make up a large part of one wallet's activity (${isAsymmetricAB ? `${pctAHist.toFixed(0)}%` : `${pctBHist.toFixed(0)}%`}) but a small part for the other (${isAsymmetricAB ? `${pctBHist.toFixed(0)}%` : `${pctAHist.toFixed(0)}%`}).`,
                        data: { primaryHistoricalSim, countHistorical, pctAHist, pctBHist }
                    });
                }
            }
        }
    }

    return keyInsights.sort((a, b) => b.score - a.score);
}

// --- Connection Strength ---

export enum ConnectionStrength {
    Strongly = 'Strongly Connected',
    Mildly = 'Mildly Connected',
    Barely = 'Barely Connected',
}

export interface Connection {
    strength: ConnectionStrength;
    wallets: [string, string];
    details: string;
    details_data: {
        shared_tokens: number;
        wallet_a_pct: number;
        wallet_b_pct: number;
        primary_sim: number;
        jaccard_sim: number;
    }
}

const STRENGTH_THRESHOLDS = {
    STRONG: { count: 10, primarySim: 0.75, jaccardSim: 0.5, sharedPct: 0.5 },
    MILD:   { count: 5,  primarySim: 0.5,  jaccardSim: 0.3, sharedPct: 0.25 },
    BARELY: { count: 3,  primarySim: 0.25, jaccardSim: 0.15, sharedPct: 0.1 },
};

export function getConnectionStrength(
    metrics: ComprehensiveSimilarityResult,
    walletLabels: Record<string, string>
): Connection[] {
    const connections: Connection[] = [];
    const processedPairs = new Set<string>();
    const walletAddresses = Object.keys(metrics.walletVectorsUsed).sort();
    const uniqueTokensPerWallet = metrics.uniqueTokensPerWallet;

    for (let i = 0; i < walletAddresses.length; i++) {
        for (let j = i + 1; j < walletAddresses.length; j++) {
            const addrA = walletAddresses[i];
            const addrB = walletAddresses[j];
            const pairKey = [addrA, addrB].sort().join('|');
            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            const count = metrics.sharedTokenCountsMatrix[addrA]?.[addrB] || 0;
            const primarySimPair = metrics.pairwiseSimilarities.find(p =>
                (p.walletA === addrA && p.walletB === addrB) || (p.walletA === addrB && p.walletB === addrA)
            );
            const primarySim = primarySimPair?.similarityScore || 0;
            const jaccardSim = metrics.jaccardSimilarityMatrix[addrA]?.[addrB] || 0;
            const pairLabel: [string, string] = [walletLabels[addrA], walletLabels[addrB]];

            const uniqueA = uniqueTokensPerWallet[addrA] || 0;
            const uniqueB = uniqueTokensPerWallet[addrB] || 0;
            const pctA = uniqueA > 0 ? (count / uniqueA) * 100 : 0;
            const pctB = uniqueB > 0 ? (count / uniqueB) * 100 : 0;
            const maxSharedPct = Math.max(pctA / 100, pctB / 100);

            const details_data = {
                shared_tokens: count,
                wallet_a_pct: pctA,
                wallet_b_pct: pctB,
                primary_sim: primarySim,
                jaccard_sim: jaccardSim,
            };

            const details = `Shared: ${count} (${pctA.toFixed(1)}% of A, ${pctB.toFixed(1)}% of B) | Primary Sim: ${primarySim.toFixed(3)} | Jaccard: ${jaccardSim.toFixed(3)}`;
            
            let strength: ConnectionStrength | null = null;

            if ( (primarySim >= STRENGTH_THRESHOLDS.STRONG.primarySim && count >= STRENGTH_THRESHOLDS.STRONG.count && maxSharedPct >= STRENGTH_THRESHOLDS.STRONG.sharedPct) ||
                 (jaccardSim >= STRENGTH_THRESHOLDS.STRONG.jaccardSim && count >= STRENGTH_THRESHOLDS.STRONG.count && maxSharedPct >= STRENGTH_THRESHOLDS.STRONG.sharedPct) ||
                 (primarySim >= STRENGTH_THRESHOLDS.STRONG.primarySim && jaccardSim >= STRENGTH_THRESHOLDS.STRONG.jaccardSim && maxSharedPct >= STRENGTH_THRESHOLDS.STRONG.sharedPct) ) {
                strength = ConnectionStrength.Strongly;
            } else if ( (primarySim >= STRENGTH_THRESHOLDS.MILD.primarySim && count >= STRENGTH_THRESHOLDS.MILD.count && maxSharedPct >= STRENGTH_THRESHOLDS.MILD.sharedPct) ||
                        (jaccardSim >= STRENGTH_THRESHOLDS.MILD.jaccardSim && count >= STRENGTH_THRESHOLDS.MILD.count && maxSharedPct >= STRENGTH_THRESHOLDS.MILD.sharedPct) ||
                        (primarySim >= STRENGTH_THRESHOLDS.MILD.primarySim && jaccardSim >= STRENGTH_THRESHOLDS.MILD.jaccardSim && maxSharedPct >= STRENGTH_THRESHOLDS.MILD.sharedPct) ||
                        (primarySim >= STRENGTH_THRESHOLDS.STRONG.primarySim || jaccardSim >= STRENGTH_THRESHOLDS.STRONG.jaccardSim || maxSharedPct >= STRENGTH_THRESHOLDS.STRONG.sharedPct) ) {
                strength = ConnectionStrength.Mildly;
            } else if ( (primarySim >= STRENGTH_THRESHOLDS.BARELY.primarySim && count >= STRENGTH_THRESHOLDS.BARELY.count) ||
                        (jaccardSim >= STRENGTH_THRESHOLDS.BARELY.jaccardSim && count >= STRENGTH_THRESHOLDS.BARELY.count) ||
                        (primarySim >= STRENGTH_THRESHOLDS.MILD.primarySim || jaccardSim >= STRENGTH_THRESHOLDS.MILD.jaccardSim || count >= STRENGTH_THRESHOLDS.STRONG.count || maxSharedPct >= STRENGTH_THRESHOLDS.MILD.sharedPct) ) {
                strength = ConnectionStrength.Barely;
            }
            
            if (strength) {
                connections.push({ strength, wallets: pairLabel, details, details_data });
            }
        }
    }
    return connections.sort((a,b) => b.details_data.primary_sim - a.details_data.primary_sim);
} 