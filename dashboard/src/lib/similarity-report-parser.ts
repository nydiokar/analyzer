/**
 * This file adapts the logic from the backend's `report_utils.ts` for use in the frontend.
 * It provides functions to parse the `ComprehensiveSimilarityResult` and return structured data
 * suitable for rendering in React components, without any Node.js dependencies.
 */

import { CombinedSimilarityResult, KeyInsight, InsightType } from "@/components/similarity-lab/results/types";

// --- Constants (from backend) ---

const INSIGHT_THRESHOLDS = {
    VERY_HIGH_BINARY: 0.85,
    STRONG_BINARY: 0.6,
    MODERATE_BINARY: 0.4,
    VERY_HIGH_CAPITAL: 0.8,
    STRONG_CAPITAL: 0.6,
    MODERATE_CAPITAL: 0.4,
    LOW_CAPITAL_DIVERGENCE: 0.3,
};

// --- Core Parsing Functions ---

export function generateKeyInsights(
    metrics: CombinedSimilarityResult,
    walletLabels: Record<string, string>
): KeyInsight[] {
    const keyInsights: KeyInsight[] = [];
    const uniqueTokensPerWallet = metrics.uniqueTokensPerWallet;

    for (const pair of metrics.pairwiseSimilarities) {
        const { walletA, walletB, binaryScore, capitalScore, sharedTokens } = pair;
        
        const labelA = walletLabels[walletA] || walletA;
        const labelB = walletLabels[walletB] || walletB;

        // Insight: Behavioral Mirror (High Binary, High Capital)
        if (binaryScore >= INSIGHT_THRESHOLDS.VERY_HIGH_BINARY && capitalScore >= INSIGHT_THRESHOLDS.STRONG_CAPITAL) {
            keyInsights.push({
                type: InsightType.BehavioralMirror,
                wallets: [labelA, labelB],
                score: binaryScore,
                text: `Extremely high similarity in trading behavior, matched by strong capital alignment. Indicates a deeply shared strategy.`,
                data: { binaryScore, capitalScore, walletA, walletB }
            });
        }
        
        // Insight: Capital Divergence (High Binary, Low Capital)
        if (binaryScore >= INSIGHT_THRESHOLDS.VERY_HIGH_BINARY && capitalScore < INSIGHT_THRESHOLDS.LOW_CAPITAL_DIVERGENCE) {
            keyInsights.push({
                type: InsightType.CapitalDivergence,
                wallets: [labelA, labelB],
                score: binaryScore,
                text: `Wallets trade the same tokens, but allocate capital very differently. Suggests one may be mirroring trades with lower conviction or taking profits.`,
                data: { binaryScore, capitalScore, walletA, walletB }
            });
        }

        // Insight: Sustained Alignment (Strong Binary, Strong Capital)
        if (binaryScore >= INSIGHT_THRESHOLDS.STRONG_BINARY && capitalScore >= INSIGHT_THRESHOLDS.STRONG_CAPITAL) {
             keyInsights.push({
                type: InsightType.SustainedAlignment,
                wallets: [labelA, labelB],
                score: (binaryScore + capitalScore) / 2,
                text: `Strong alignment in both trading history and capital allocation, suggesting a consistent, shared strategy.`,
                data: { binaryScore, capitalScore, walletA, walletB }
            });
        }
    }

    // Insight: Shared Zero Holdings
    if (metrics.walletBalances) {
        const walletsWithBalances = Object.keys(metrics.walletBalances);
        for (let i = 0; i < walletsWithBalances.length; i++) {
            for (let j = i + 1; j < walletsWithBalances.length; j++) {
                const walletA = walletsWithBalances[i];
                const walletB = walletsWithBalances[j];
                const pair = metrics.pairwiseSimilarities.find(p => (p.walletA === walletA && p.walletB === walletB) || (p.walletA === walletB && p.walletB === walletA));
                
                if (pair && pair.binaryScore > INSIGHT_THRESHOLDS.STRONG_BINARY) {
                    const balanceA = new Set(metrics.walletBalances[walletA]?.tokenBalances.map(t => t.tokenAddress) || []);
                    const balanceB = new Set(metrics.walletBalances[walletB]?.tokenBalances.map(t => t.tokenAddress) || []);
                    const intersection = new Set([...balanceA].filter(x => balanceB.has(x)));
                    
                    if (intersection.size === 0) {
                         keyInsights.push({
                            type: InsightType.SharedZeroHoldings,
                            wallets: [walletLabels[walletA] || walletA, walletLabels[walletB] || walletB],
                            score: pair.binaryScore,
                            text: `These wallets have a strong shared trading history but currently hold none of the same tokens, suggesting a coordinated exit or rotation.`,
                            data: { binaryScore: pair.binaryScore, walletA, walletB }
                        });
                    }
                }
            }
        }
    }

    // Remove duplicate insights for the same pair, keeping the one with the highest score
    const uniqueInsights = new Map<string, KeyInsight>();
    keyInsights.forEach(insight => {
        const pairKey = insight.wallets.sort().join('|');
        if (!uniqueInsights.has(pairKey) || insight.score > uniqueInsights.get(pairKey)!.score) {
            uniqueInsights.set(pairKey, insight);
        }
    });

    return Array.from(uniqueInsights.values()).sort((a, b) => b.score - a.score);
} 