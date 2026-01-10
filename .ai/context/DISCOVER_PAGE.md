# Discover Wallets Page Refactor

## Overview
Refactor the Discover page to improve filtering, make winrate sortable, and reorganize filters to reduce clutter.

## Changes Required

### 1. Winrate Column
- **Extract winrate from wallet badge** into its own separate column
- This makes it filterable and sortable
- Wallet badge should still show wallet name/address but NOT winrate

### 2. Column Order (Left to Right)
1. **Wallet** - Wallet badge with name and address (no winrate)
2. **PnL** - Profit and Loss
3. **Winrate** - Extracted from badge, sortable
4. **Categories** - Behavioral categories (with tooltip ⓘ)
5. **SOL Balance** - SOL balance value
6. **Unpaired** - Unpaired value (last column)

### 3. Time Period Filter
- Add time period filter buttons at the top: `[1d] [7d] [30d] [All-time]`
- These are **placeholders** for now - will be wired up later
- Allow filtering data by time period

### 4. Activity Time Filter
- Add single button filter: `[48H]`
- When active, shows only wallets with activity in the last 48 hours
- Positioned near time period filters

### 5. Category Filters (Flow/Speed)
- **Move to pie charts** on the right side
- Remove category filters from main filter area
- Users filter by clicking on pie chart segments
- Add tooltip on Categories column header: **"Filter by clicking pie charts on the right"**
- This reduces filter clutter since we have many filters

### 6. Tooltip
- Column header tooltip on "Categories ⓘ"
- Text: "Filter by clicking pie charts on the right"
- Short and informative

## ASCII Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Discover Wallets                                                             │
│                                                                               │
│  [1d] [7d] [30d] [All-time]             Activity: [48H]                      │
│                                                                               │
├─────────────────────────────────────────────────────────────┬────────────────┤
│                    TABLE                                     │  PIE CHARTS   │
├──────────────┬─────────┬─────────┬──────────────┬───────────┼───────────────┤
│ Wallet       │ PnL     │ Winrate │ Categories ⓘ │ SOL Bal   │ Unpaired      │
│              │         │         │              │           │               │
├──────────────┼─────────┼─────────┼──────────────┼───────────┼───────────────┤
│ [Whale]      │ +$45.2K │ 72%     │ Smart,Fast   │ 125 SOL   │ $1.2K         │  ┌─────────┐
│  7xD2e...    │         │         │              │           │               │  │  FLOW   │
├──────────────┼─────────┼─────────┼──────────────┼───────────┼───────────────┤  │  Chart  │
│ [Risky]      │ -$2.1K  │ 45%     │ Risky,Slow   │ 8 SOL     │ $450          │  └─────────┘
│  9mK4p...    │         │         │              │           │               │
├──────────────┼─────────┼─────────┼──────────────┼───────────┼───────────────┤  ┌─────────┐
│ [Top]        │ +$102K  │ 85%     │ Whale,Fast   │ 450 SOL   │ $5K           │  │  SPEED  │
│  3nB7w...    │         │         │              │           │               │  │  Chart  │
└──────────────┴─────────┴─────────┴──────────────┴───────────┴───────────────┴──┴─────────┘

ⓘ = "Filter by clicking pie charts on the right"
```

## Implementation Notes

### Backend/API
- Time period filters (1d/7d/30d/all-time) are placeholders - will wire up later
- Activity filter (48H) will need API support to filter by last activity timestamp
- Existing PnL and winrate data should already be available

### Frontend
- Extract winrate from wallet badge component
- Create new winrate column component
- Move category filter logic to pie chart interaction
- Add click handlers to pie chart segments for filtering
- Implement tooltip on Categories column header
- Time period filter buttons should be styled but non-functional (placeholder)
- 48H activity filter should be functional when wired to backend

### UX Goals
- Reduce filter clutter by moving category filters to pie charts
- Make winrate sortable/filterable
- Provide intuitive filtering through visual pie chart interaction
