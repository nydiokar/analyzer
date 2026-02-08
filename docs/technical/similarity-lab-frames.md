### Frame Structure (Current Work)

**Frame 1: Wallet Input Area** ✅ Complete
- Textarea for wallet/token addresses
- Token holder picker (top holders table)
- Modern loading animation with pulsing borders & shimmer effect
- 10-15% side margins, 2-column layout (desktop), stacked (mobile)
- **Status:** ✅ All refinements complete

**Frame 2: Global Analysis Metrics** ✅ Complete
- Wallets analyzed count with tooltip
- Top pairs similarity score with status badges
- Tokens analyzed (actively traded)
- Current holdings value with median
- Largest holding percentage
- Top 5 most similar pairs with wallet badges
- Score distribution chart (capital/behavioral/cumulative)
- **Status:** ✅ Fully implemented with proper tooltips and visual hierarchy

**Frame 3: Pair Insights** 🔄 Next Priority
- Wallet pairs list with improved color schema
- Better alignment with score distribution
- Deep dive functionality (currently only shows shared tokens)
- Color contradictions to be resolved
- **Issues:**
  - Wallet pairs not clearly indicating high shared token count vs high ratio
  - Shared tokens display lacks structure (tokens "hanging in air")
  - Token prices appearing stale/not using already-fetched metadata
  - Need better visual hierarchy and context for shared tokens