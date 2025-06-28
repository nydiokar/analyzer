Backend payload exposes nine major data blocks.

1. pairwiseSimilarities – full behavioural + capital scores, shared-token lists, token-count stats. Rendered in EnhancedKeyInsights 
.

2. capitalAllocation map – used to print weight percentages inside the accordion table 
.

3. uniqueTokensPerWallet – tapped for %-of-portfolio calculations 
.

4. walletVectorsUsed – only touched to build six-char labels, the underlying vectors are discarded 
.

5. walletBalances – injected into CombinedSimilarityResult but never read on the client side 
.

6. sharedTokenCountsMatrix – count of overlapping mints for every wallet pair, never surfaced 
.

7. jaccardSimilarityMatrix (historical token presence) – calculated, never displayed 
.

8. holdingsPresenceJaccardMatrix / holdingsPresenceCosineMatrix (current holdings overlap) – calculated, never displayed 
.

9. globalMetrics – average similarity and “top-5 pairs”, never rendered 
.

Coverage audit

Block	Consumed	UI value extracted	Lost potential
1-3	yes	scores, shared tokens, % overlap	nil
4	partial	label shortening only	entire vector for charts, vector inspection
5-9	no	—	balances context, token-count heatmaps, historical vs current overlap matrices, global KPIs

Rough utilisation: 3.5 / 9 ≈ 40 % of available analytical payload.

Gaps with highest marginal value

• Wallet balances → slot a “Current Holdings” card per wallet, flag zero-balance outliers.

• sharedTokenCountsMatrix → heatmap or sortable table to expose breadth of overlap independent of weights.

• jaccardSimilarityMatrix + holdings matrices → secondary tabs for “Historical Presence” and “Live Holdings” similarity; lets users spot divergence or convergence quickly.

• globalMetrics → header bar: average similarity, distribution sparkline, top-5 pairs list. Zero extra queries—data is already in the object.

• walletVectorsUsed → allow drill-down: hover on score bar reveals per-token weight contribution; optional PCA scatterplot.

No additional backend calls needed; every item already ships in the JSON.