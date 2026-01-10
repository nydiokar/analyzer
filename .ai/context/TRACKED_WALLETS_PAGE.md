# Tracked Wallets Page Refactor

## Overview
Refactor the Tracked Wallets page to improve layout and add additional tracking columns.

## Changes Required

### 1. Layout Changes
- **Move buttons above table**: Add Wallet, Import, and Export buttons should be positioned directly above the table instead of their current location
- Buttons should be in a single row: `[+ Add Wallet] [Import] [Export]`

### 2. Table Columns
The table should have the following columns in order:

1. **Wallet** - Shows wallet badge with name and address
2. **PnL** - Profit and Loss
3. **Winrate** - Win rate percentage
4. **Last Active** - Time since last activity (e.g., "2h ago", "1d ago")
5. **SOL Balance** - Current SOL balance

### 3. Column Details

**Wallet Column:**
- Display wallet badge (existing component)
- Badge contains name and shortened address
- No separate name column

**PnL Column:**
- Format: `+$45.2K` or `-$2.1K`
- Color coded (green for positive, red for negative)

**Winrate Column:**
- Format: `72%`
- Sortable

**Last Active Column:**
- Relative time format: "2h ago", "1d ago", "30m ago"
- Sortable by timestamp

**SOL Balance Column:**
- Format: `125.5 SOL`
- Sortable

## ASCII Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  Tracked Wallets                                                   │
│                                                                    │
│  [+ Add Wallet]  [Import]  [Export]                               │
│                                                                    │
├──────────────────┬──────────┬─────────┬──────────────┬───────────┤
│ Wallet           │ PnL      │ Winrate │ Last Active  │ SOL Bal   │
├──────────────────┼──────────┼─────────┼──────────────┼───────────┤
│ [Whale1]         │ +$45.2K  │ 72%     │ 2h ago       │ 125.5 SOL │
│  7xD2e...        │          │         │              │           │
├──────────────────┼──────────┼─────────┼──────────────┼───────────┤
│ [Degen2]         │ -$2.1K   │ 45%     │ 1d ago       │ 8.2 SOL   │
│  9mK4p...        │          │         │              │           │
├──────────────────┼──────────┼─────────┼──────────────┼───────────┤
│ [Smart3]         │ +$102K   │ 85%     │ 30m ago      │ 450.0 SOL │
│  3nB7w...        │          │         │              │           │
└──────────────────┴──────────┴─────────┴──────────────┴───────────┘
```

## Implementation Notes

- All columns should be sortable
- Maintain existing wallet badge component
- Preserve existing functionality for Add Wallet, Import, Export
- Keep minimal changes approach - only modify layout and add new columns
