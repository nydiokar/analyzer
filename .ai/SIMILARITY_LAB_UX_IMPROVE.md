SIMILARITY LAB - DEFINITIVE REDESIGN PLAN

  ---
  CORE PHILOSOPHY

  "Token-aware wallet list with zero-friction holder import"

  The page becomes a smart wallet list that:
  1. Accepts BOTH token addresses AND wallet addresses in one input
  2. Auto-detects token addresses and fetches top holders inline
  3. Allows adding/removing individual wallets before analysis
  4. Shows holder rank/metadata for imported wallets
  5. Maintains all existing backend logic (reuse /analyses/holder-profiles endpoint)

  ---
  SOLUTION TO THE CORE PROBLEM

  Current Flow (Too Many Clicks) ❌

  User wants: Compare 5 holders of SOL + 2 custom wallets

  Step 1: Click "Add from token holders" button
  Step 2: Dialog opens
  Step 3: Paste token address
  Step 4: Wait for load
  Step 5: Select 5 wallets
  Step 6: Click "Add to Similarity Set"
  Step 7: Dialog closes
  Step 8: Manually type 2 more wallets into textarea
  Step 9: Click "Analyze"

  Total: 9 steps, 1 dialog, lots of context switching

  New Flow (Streamlined) ✅

  User wants: Compare 5 holders of SOL + 2 custom wallets

  Step 1: Paste token address into input
  Step 2: Top holders appear inline below (auto-loaded)
  Step 3: Check/uncheck holders (default: top 10 selected)
  Step 4: Paste 2 custom wallets into same input (OR add via "+" button)
  Step 5: Click "Analyze"

  Total: 5 steps, no dialogs, everything inline

  ---
  DETAILED LAYOUT DESIGN

  Full Page Structure

  ╔══════════════════════════════════════════════════════════════════╗
  ║ AppShell                                                         ║
  ║  ┌───────────────────────────────────────────────────────────┐  ║
  ║  │ px-4 md:px-6 lg:px-10, space-y-8, pb-8                    │  ║
  ║  │                                                            │  ║
  ║  │  ┌──────────────────────────────┐ max-w-6xl mx-auto      │  ║
  ║  │  │ 🧪 Similarity Lab            │ space-y-1              │  ║
  ║  │  │ Discover hidden connections  │                         │  ║
  ║  │  └──────────────────────────────┘                         │  ║
  ║  │                                                            │  ║
  ║  │              ↕ space-y-8                                   │  ║
  ║  │                                                            │  ║
  ║  │  ┌──────────────────────────────┐ max-w-6xl mx-auto      │  ║
  ║  │  │ INPUT CARD (next section)    │                         │  ║
  ║  │  └──────────────────────────────┘                         │  ║
  ║  │                                                            │  ║
  ║  │              ↕ space-y-8                                   │  ║
  ║  │                                                            │  ║
  ║  │  ┌──────────────────────────────┐ max-w-6xl mx-auto      │  ║
  ║  │  │ WALLET LIST (if holders)     │ ← NEW SECTION          │  ║
  ║  │  └──────────────────────────────┘                         │  ║
  ║  │                                                            │  ║
  ║  │              ↕ space-y-8                                   │  ║
  ║  │                                                            │  ║
  ║  │  ┌──────────────────────────────┐                         │  ║
  ║  │  │ RESULTS DISPLAY              │                         │  ║
  ║  │  └──────────────────────────────┘                         │  ║
  ║  └───────────────────────────────────────────────────────────┘  ║
  ╚══════════════════════════════════════════════════════════════════╝

  ---
  SECTION 1: INPUT CARD

  ┌─────────────────────────────────────────────────────────────────┐
  │ Card className="max-w-6xl mx-auto p-3"                          │
  │                                                                  │
  │ ┌────────────────────────────┬────────┬───────────┬──────────┐  │
  │ │ Input (flex-1, min-w-220)  │ [10 ▾] │ [Analyze] │ [+ Add]  │  │
  │ │ Token or wallet addresses  │  h-9   │   h-9     │   h-9    │  │
  │ └────────────────────────────┴────────┴───────────┴──────────┘  │
  │                                  ↑         ↑           ↑         │
  │                             Top N     Primary    Add wallet     │
  │                             (shows   action      manually       │
  │                              when                (opens small   │
  │                              token                inline form)  │
  │                              detected)                          │
  │                                                                  │
  │ Status line (text-xs text-muted-foreground):                    │
  │ • Empty: "Paste token address or wallet addresses"              │
  │ • Token detected: "Loading top holders..."                      │
  │ • Holders loaded: "10 holders loaded • 8 selected"              │
  │ • Wallets only: "5 wallets • 1 invalid (hover for details)"     │
  │ • Mixed: "10 holders (3 selected) + 2 custom wallets"           │
  └─────────────────────────────────────────────────────────────────┘

  Input Behavior

  Smart Detection Logic:
  User pastes: "So11111111111111111111111111111111111112"
  ↓
  System detects: 44 chars, base58, NOT a wallet we know
  ↓
  Assumption: Token address
  ↓
  Auto-fetch top holders (reusing TopHoldersPanel logic)
  ↓
  Show holder list below (next section)
  ↓
  Top N selector appears in input card

  Multi-value Input:
  User types/pastes:
  "So11111111111111111111111111111111111112
   ABC123wallet456
   DEF789wallet012"

  System parses:
  Line 1: Token (44 chars, triggers holder fetch)
  Line 2-3: Wallets (added to custom list)

  Result:
  - Holders from token displayed below
  - 2 custom wallets shown in holder list (marked as "Custom")

  ---
  SECTION 2: HOLDER LIST (NEW - Conditional Display)

  Shows when:
  - Token address detected AND holders loaded
  - OR custom wallets manually added

  ┌──────────────────────────────────────────────────────────────────┐
  │ max-w-6xl mx-auto                                                │
  │                                                                   │
  │ ┌──────────────────────────────────────────────────────────────┐ │
  │ │ Card p-4                                                     │ │
  │ │                                                              │ │
  │ │  📊 Wallet Selection                    [Select All] [Clear]│ │
  │ │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ │
  │ │                                                              │ │
  │ │  ┌─────────────────────────────────────────────────────┐   │ │
  │ │  │ Token: SOL (So1111...)        [View on Solscan →]   │   │ │
  │ │  │ 250 total holders • Showing top 50                   │   │ │
  │ │  └─────────────────────────────────────────────────────┘   │ │
  │ │                                                              │ │
  │ │  Compact table (similar to TopHoldersPanel):                │ │
  │ │  ┌───┬─────────────────────────────────────┬──────┬────┐   │ │
  │ │  │☑  │ #1 • Abc123...xyz • Known: Binance │ 45.2M│ 🗑 │   │ │
  │ │  │☑  │ #2 • Def456...abc                   │ 32.1M│ 🗑 │   │ │
  │ │  │☑  │ #3 • Ghi789...def                   │ 28.5M│ 🗑 │   │ │
  │ │  │☐  │ #4 • Jkl012...ghi • Known: Raydium │ 21.3M│ 🗑 │   │ │
  │ │  │☑  │ Custom • Mno345...jkl               │  n/a │ 🗑 │   │ │
  │ │  │☑  │ Custom • Pqr678...mno               │  n/a │ 🗑 │   │ │
  │ │  └───┴─────────────────────────────────────┴──────┴────┘   │ │
  │ │         ↑      ↑             ↑               ↑       ↑      │ │
  │ │      Check   Rank       WalletBadge      Amount   Remove   │ │
  │ │                         (with known                         │ │
  │ │                          label if any)                      │ │
  │ │                                                              │ │
  │ │  12 wallets selected • Ready to analyze                     │ │
  │ │  ⚠ System wallets (Binance, Raydium) will be filtered      │ │
  │ │                                                              │ │
  │ └──────────────────────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────────────────────┘

  Holder List Features

  1. Auto-selection: Top N (default 10) auto-selected when loaded
  2. Rank display: Shows holder rank from token data
  3. Known labels: Reuses system wallet detection (shows "Binance", "Raydium", etc.)
  4. Custom markers: Manually added wallets show "Custom" instead of rank
  5. Individual removal: Each row has delete icon
  6. Bulk actions: Select All, Clear buttons at top
  7. Warning banner: If system wallets selected, show inline warning they'll be filtered

  ---
  STATE FLOW DIAGRAM

  ┌─────────────────────────────────────────────────────────────┐
  │ USER ACTIONS → STATE CHANGES → UI UPDATES                  │
  └─────────────────────────────────────────────────────────────┘

  1. INITIAL STATE
     Input: Empty
     Status: "Paste token address or wallet addresses"
     Holder List: Hidden

     ↓ User pastes token address

  2. TOKEN DETECTED
     Input: "So111...112"
     Status: "Loading top holders..." (spinner)
     Holder List: Hidden (loading)

     ↓ Backend returns holders

  3. HOLDERS LOADED
     Input: "So111...112"
     Top N Selector: Appears (default 10)
     Status: "50 holders loaded • 10 selected"
     Holder List: Shows (top 10 checked)
     Analyze Button: Enabled

     ↓ User adds wallet on new line

  4. MIXED MODE
     Input: "So111...112\nAbc123...xyz"
     Status: "50 holders (10 selected) + 1 custom wallet"
     Holder List: Shows (10 holders + 1 custom)

     ↓ User changes Top N to 25

  5. TOP N CHANGE
     Input: Same
     Top N: 25
     Status: "50 holders loaded • 25 selected"
     Holder List: Updates (top 25 checked)

     ↓ User unchecks 5 holders

  6. MANUAL SELECTION
     Status: "50 holders (20 selected) + 1 custom • 21 total"

     ↓ User clicks Analyze

  7. ANALYSIS STARTS
     Analyze Button: Disabled, shows loading
     Status: "Analyzing 21 wallets..."

     ↓ Backend completes

  8. RESULTS SHOWN
     Input Card: Collapses (or stays but disabled)
     Holder List: Stays visible (reference)
     Results: Appear below with space-y-8 gap

  ---
  IMPLEMENTATION DETAILS

  Component Structure

  similarity-lab/page.tsx  ← Main page
  ├── Uses state:
  │   ├── inputText (raw user input)
  │   ├── detectedToken (parsed token address)
  │   ├── customWallets (manually added)
  │   ├── holdersData (from /api/token-accounts/:mint)
  │   ├── selectedHolders (Set<address>)
  │   ├── topN (number for auto-selection)
  │   └── analysisResult (current)
  │
  └── Renders:
      ├── Header (reused pattern)
      ├── InputCard (new, compact)
      ├── HolderSelectionCard (new, conditional)
      └── SimilarityResultDisplay (existing)

  New Components to Create

  1. SmartWalletInput.tsx
  Purpose: Input card with auto-detection
  Props:
    - value: string
    - onChange: (value: string) => void
    - onTokenDetected: (mint: string) => void
    - topN: number
    - onTopNChange: (n: number) => void
    - walletCount: number
    - invalidCount: number
    - onAnalyze: () => void
    - isAnalyzing: boolean

  Features:
    - Single input field (h-9)
    - Detects tokens vs wallets on change
    - Shows Top N selector when token detected
    - Status line with smart messages
    - [+ Add Wallet] button (optional, for clarity)

  2. HolderSelectionList.tsx
  Purpose: Display and manage holder selection
  Props:
    - tokenMint: string | null
    - holders: TopHolderItem[]
    - customWallets: string[]
    - selected: Set<string>
    - onToggle: (address: string) => void
    - onRemove: (address: string) => void
    - onSelectAll: () => void
    - onClear: () => void

  Features:
    - Compact table like TopHoldersPanel
    - Shows rank, wallet badge, amount, checkbox
    - Custom wallets marked clearly
    - Remove button per row
    - Warning for system wallets

  ---
  DATA FLOW & API INTEGRATION

  Reusing Existing Backend

  Token Holder Fetch:
  // Reuse existing hook from TopHoldersPanel
  import { useTopHolders } from '@/hooks/useTopHolders';

  const { data, isLoading } = useTopHolders(detectedToken, 'finalized');
  const holders = data?.holders || [];

  // Auto-select top N
  useEffect(() => {
    if (holders.length > 0) {
      const topNAddresses = holders
        .slice(0, topN)
        .map(h => h.ownerAccount)
        .filter(Boolean);
      setSelectedHolders(new Set(topNAddresses));
    }
  }, [holders, topN]);

  Analysis Submission:
  // Merge selected holders + custom wallets
  const allWallets = [
    ...Array.from(selectedHolders),
    ...customWallets.filter(w => isValidSolanaAddress(w))
  ];

  // Submit to existing endpoint (unchanged)
  await fetcher('/analyses/similarity/queue', {
    method: 'POST',
    body: JSON.stringify({
      walletAddresses: allWallets,
      vectorType: 'capital',
      // ... other params same as current
    }),
  });

  System Wallet Filtering:
  // Show warning if system wallets selected
  const systemWallets = holders.filter(h =>
    selectedHolders.has(h.ownerAccount) &&
    h.knownType === 'SYSTEM'
  );

  {systemWallets.length > 0 && (
    <Alert variant="warning">
      {systemWallets.length} system wallet(s) selected will be
      filtered during analysis (e.g., {systemWallets[0].knownLabel})
    </Alert>
  )}

  ---
  VALIDATION BEHAVIOR

  Option A (Recommended): Inline Status Only

  Status line states:

  ✓ "15 wallets ready • Click Analyze"
  ⚠ "12 wallets ready • 1 invalid (hover for details)"
    ↑ Hover tooltip shows: "Invalid: Abc123 (too short - 7 chars)"

  ❌ "3 invalid addresses • Fix to continue"
     Button disabled, status line red

  Implementation:
  const validationStatus = useMemo(() => {
    const valid = allWallets.filter(isValidSolanaAddress);
    const invalid = allWallets.filter(w => !isValidSolanaAddress(w));

    if (invalid.length === 0) {
      return {
        type: 'success',
        message: `${valid.length} wallets ready • Click Analyze`,
        canAnalyze: valid.length >= 2
      };
    }

    if (valid.length >= 2) {
      return {
        type: 'warning',
        message: `${valid.length} wallets ready • ${invalid.length} invalid`,
        tooltip: `Invalid: ${invalid.join(', ')}`,
        canAnalyze: true
      };
    }

    return {
      type: 'error',
      message: `${invalid.length} invalid addresses • Fix to continue`,
      canAnalyze: false
    };
  }, [allWallets]);

  Visual:
  ┌──────────────────────────────────────────────────────┐
  │ Status: 12 wallets ready • 1 invalid ⓘ              │
  │         ────────────────────────────                 │
  │                                     └─ Hover tooltip │
  └──────────────────────────────────────────────────────┘

  ---
  EDGE CASES & HANDLING

  1. User Pastes Mixed Content

  Input:
  "So11111111111111111111111111111111111112
   Abc123wallet456
   EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

  Detection:
  Line 1: Token (44 chars, base58) → Fetch holders
  Line 2: Wallet (valid)
  Line 3: Token (44 chars, base58) → ???

  Resolution:
  - Only first valid token triggers holder fetch
  - Show warning: "Multiple tokens detected. Using first: SOL"
  - Other tokens treated as custom wallets (OR invalid if we want strict)

  2. Token Returns No Holders

  Status: "No holders found for token So111...112"
  Action: Input acts like wallet-only mode
  User can: Add wallets manually

  3. All Holders Are System Wallets

  Warning: "All top holders are system wallets (will be filtered)"
  Status: "Add custom wallets or increase Top N"
  Action: Disable Analyze if no valid wallets after filter

  4. Top N Exceeds Holder Count

  Token has 30 holders, user selects Top 50
  Action: Select all 30, show "30 holders (all selected)"

  ---
  VISUAL POLISH DETAILS

  Spacing Consistency

  <div className="w-full px-4 md:px-6 lg:px-10 space-y-8 pb-8">
    <div className="max-w-6xl mx-auto space-y-1">
      {/* Header */}
    </div>

    <Card className="max-w-6xl mx-auto p-3">
      {/* Input card */}
    </Card>

    {holdersData && (
      <Card className="max-w-6xl mx-auto p-4">
        {/* Holder list - slightly more padding than input */}
      </Card>
    )}

    {analysisResult && (
      <MemoizedSimilarityResultDisplay results={analysisResult} />
    )}
  </div>

  Loading States

  Token Holders Loading:
  ┌──────────────────────────────────────────────────────┐
  │ Card (holder list position)                          │
  │                                                       │
  │  Loading top holders for SOL...                      │
  │  ⏳ [────────────────────] 0%                        │
  │                                                       │
  │  [Skeleton rows for holder table]                    │
  └──────────────────────────────────────────────────────┘

  Analysis Running:
  Input Card: Disabled (opacity-50)
  Holder List: Disabled (opacity-50)
  Analyze Button: "⏳ Analyzing... 45%"
  Status: "Analyzing 15 wallets • Step 2/3"

  ---
  RESPONSIVE BEHAVIOR

  Mobile (< 768px)

  ┌────────────────────────────┐
  │ Input Card                 │
  │ ┌────────────────────────┐ │
  │ │ Input (full width)     │ │
  │ └────────────────────────┘ │
  │ ┌──┬──────┬────────────┐   │
  │ │10│Analyze│ + Add      │   │ ← Stack on mobile
  │ └──┴──────┴────────────┘   │
  └────────────────────────────┘

  ┌────────────────────────────┐
  │ Holder List (scrollable)   │
  │ Simplified table           │
  │ (hide rank column)         │
  └────────────────────────────┘

  Desktop (>= 768px)

  Standard layout as shown in main ASCIIs

  ---
  COMPARISON: BEFORE vs AFTER

  User Flow Comparison
  ┌──────────────────────┬──────────────────────────────┬─────────────────────┬─────────────────┐
  │         Task         │       Before (Current)       │  After (Proposed)   │   Improvement   │
  ├──────────────────────┼──────────────────────────────┼─────────────────────┼─────────────────┤
  │ Analyze 10 holders   │ 9 steps, 1 dialog            │ 5 steps, inline     │ 44% faster      │
  ├──────────────────────┼──────────────────────────────┼─────────────────────┼─────────────────┤
  │ Mix holders + custom │ 11 steps, switching contexts │ 5 steps, same input │ 55% faster      │
  ├──────────────────────┼──────────────────────────────┼─────────────────────┼─────────────────┤
  │ See holder rank      │ Hidden in dialog             │ Always visible      │ Better context  │
  ├──────────────────────┼──────────────────────────────┼─────────────────────┼─────────────────┤
  │ Adjust selection     │ Reopen dialog                │ Click checkboxes    │ Zero friction   │
  ├──────────────────────┼──────────────────────────────┼─────────────────────┼─────────────────┤
  │ Know system wallets  │ No indication                │ Inline warning      │ Prevents errors │
  └──────────────────────┴──────────────────────────────┴─────────────────────┴─────────────────┘
  ---
  QUESTIONS FOR CLARIFICATION

  Before I implement, please confirm these decisions:

  Q1: Token Detection Strictness

  When user pastes multiple 44-char addresses:
  - Option A: Treat first as token, rest as wallets (auto-mix mode)
  - Option B: Treat all as wallets unless explicitly labeled
  - Option C: Ask user "Detected token - fetch holders?" with inline button

  Recommendation: Option A (auto-detect first, treat rest as wallets)

  Q2: Holder List Always Visible?

  After analysis completes:
  - Option A: Keep holder list visible (users see what was analyzed)
  - Option B: Collapse/hide holder list (focus on results)
  - Option C: Move to collapsible section "View analyzed wallets ▼"

  Recommendation: Option A (transparency - users can verify selection)

  Q3: [+ Add Wallet] Button

  - Option A: Include it (makes manual addition discoverable)
  - Option B: Skip it (users can just type in input)
  - Option C: Show it conditionally (only when token detected)

  Recommendation: Option C (appears when in holder mode for clarity)

  Q4: Invalid Wallet Feedback Detail Level

  When 1 invalid wallet among 15 valid:
  - Option A: Just count ("1 invalid") with hover tooltip
  - Option B: Highlight invalid row in holder list (red border)
  - Option C: Both A + B

  Recommendation: Option A (keep it subtle, tooltip on demand)

  ---
  IMPLEMENTATION PHASES

  Phase 1: Foundation (Core Layout)

  - Update page container spacing (px-6, space-y-8)
  - Simplify header (icon, text-2xl, subtitle)
  - Create SmartWalletInput component (single input, auto-detect)
  - Remove old card wrapper/descriptions

  Phase 2: Token Detection & Holder Fetch

  - Add token detection logic (44 chars, base58, first line)
  - Integrate useTopHolders hook
  - Show Top N selector when token detected
  - Display loading state during fetch

  Phase 3: Holder Selection UI

  - Create HolderSelectionList component
  - Implement checkbox selection
  - Add auto-selection logic (top N on load)
  - Show rank, wallet badge, amount columns
  - Add remove button per row

  Phase 4: Custom Wallets & Mixing

  - Parse multi-line input (token + wallets)
  - Merge holders + custom wallets in list
  - Mark custom wallets visually ("Custom" label)
  - Allow manual addition via input or [+ Add] button

  Phase 5: Validation & Feedback

  - Implement inline validation status
  - Add tooltip for invalid wallets
  - Show warning for system wallets
  - Disable Analyze if no valid wallets

  Phase 6: Polish & Testing

  - Add responsive breakpoints
  - Implement loading states (skeleton, progress)
  - Test edge cases (no holders, all system, mixed input)
  - Final spacing/alignment tweaks

  ---
  SUCCESS METRICS

  After implementation, the page should achieve:

  ✅ Consistency: Matches Holder Profiles spacing/patterns
  ✅ Efficiency: 40-50% fewer clicks for holder import
  ✅ Clarity: User always knows what's selected
  ✅ Flexibility: Supports token-only, wallet-only, or mixed
  ✅ Intelligence: Auto-detects input type, warns about issues
  ✅ Reusability: All backend logic unchanged, hooks reused