# Dashboard Components Overview

This document provides a comprehensive overview of all React components in the Wallet Analysis Dashboard.

## Component Categories

- **[Layout Components](#layout-components)** - Sidebar, WalletProfileLayout, and core layout structure
- **[Dashboard Specific Components](#dashboard-specific-components)** - AccountSummaryCard, TokenPerformanceTab, BehavioralPatternsTab, AccountStatsPnlTab, ReviewerLogTab
- **[Sidebar Child Components](#sidebar-child-components)** - WalletSearch, FavoriteWalletsList, FavoriteWalletItem
- **[Shared Components](#shared-components)** - **TokenBadge** (CRITICAL), **WalletBadge**, EmptyState, TimeRangeSelector, WebSocketStatus
- **[Holder Profiles v2 Components](#holder-profiles-v2-components)** - WalletBaseballCard, **ExitTimingDrilldownPanel**, WalletClassifier, and behavioral analysis components
- **[Similarity Lab Components](#similarity-lab-components)** - TopHoldersPanel, SimilarityResultDisplay, MostCommonTokens, and wallet comparison tools
- **[Charts and Visualization](#charts-and-visualization-components)** - EChartComponent
- **[Theme and UI](#theme-and-ui-components)** - ThemeToggleButton, ThemeProvider
- **[Additional Layout](#additional-layout-components)** - LayoutClientShell, LazyTabContent, QuickAddForm, WalletEditForm
- **[Page Components](#page-components-app-router)** - Next.js App Router pages
- **[Utility Files](#utility-files)** - **useTokenMetadata** (CRITICAL), fetcher, utils

### Key Architecture Components

**MUST READ** before working with token or wallet display:

1. **`TokenBadge.tsx`** - Centralized token metadata handling with automatic batching. DO NOT manually call enrichment APIs when using this component.
2. **`useTokenMetadata.ts`** - Global batching infrastructure. DO NOT modify without understanding full impact.
3. **`WalletBadge.tsx`** - Unified wallet display component used across all wallet references.
4. **`ExitTimingDrilldownPanel.tsx`** - Example of proper TokenBadge usage with batching and caching.

## Layout Components

### 1. `Sidebar.tsx`

-   **File Path:** `dashboard/src/components/layout/Sidebar.tsx`
-   **Purpose:** Provides main navigation for the dashboard. It is collapsible.
-   **Current State:** Implemented with Tailwind CSS and Lucide icons. Manages its collapsed/expanded state. Includes a toggle button. Houses the `WalletSearch` and `FavoriteWalletsList` components. Navigation links for Dashboard Home, Settings, and Help/Doc are present with tooltips for the collapsed state.
-   **Key Props:** `isCollapsed: boolean`, `toggleSidebar: () => void`.
-   **Planned Next Steps:** Monitor for any further UX refinements for collapsed state interactions.

### 2. `WalletProfileLayout.tsx`

-   **File Path:** `dashboard/src/components/layout/WalletProfileLayout.tsx`
-   **Purpose:** Provides the main layout structure for individual wallet profile pages.
-   **Current State:** Sticky header presents the wallet identity (icon, truncated badge, copy button), `ThemeToggleButton`, last-analysis indicator, and the primary CTA. The CTA queues flash/working/deep scopes once real token data has been rendered; auto-triggering is throttled per-wallet so we subscribe to already-running jobs instead of posting duplicates. The header also hosts `AccountSummaryCard` and `TimeRangeSelector`, with status chips that only surface active scopes (running/queued/completed). Tabs are rendered via `TabsList` under the header, and the layout memoizes dashboard tab components to keep renders cheap.
-   **Key Props:** `children: React.ReactNode`, `walletAddress: string`.
-   **Planned Next Steps:** Consider integrating a global loading/empty state if the main wallet summary data (last analyzed time) fails to load.

## Dashboard Specific Components

### 1. `AccountSummaryCard.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountSummaryCard.tsx`
-   **Purpose:** To display a snapshot of key account-level metrics in the header, including the current SOL balance.
-   **Current State:** Implemented as a client component. Accepts `walletAddress`, `triggerAnalysis`, and `isAnalyzingGlobal` props. Uses SWR to fetch data from `/api/v1/wallets/{walletAddress}/summary`, passing `startDate` and `endDate`. 
    -   **Loading State:** Displays an `EmptyState` with `Loader2` icon and "Loading..." message.
    -   **Error State:** Displays an `EmptyState` with `SearchX` icon. If the error is a 404, it shows "Wallet Not Yet Analyzed" with a description and an "Analyze Wallet" button (if `triggerAnalysis` is provided). For other errors, it displays the error message and status.
    -   **No Data State:** If `!data` after loading and no error, displays an `EmptyState` with `Info` icon and "No Summary Data Available" or "Summary Unavailable" messages, with an "Analyze Wallet" button.
    -   **No Wallet Selected:** If `walletAddress` is not provided, shows a simple text message.
    Uses Tremor components for data presentation. `isAnalyzingGlobal` prop will show a global analyzing message via the parent if that state is active higher up the tree.
-   **Key Props:** `walletAddress: string`, `className?: string`, `triggerAnalysis?: () => void`, `isAnalyzingGlobal?: boolean`.
-   **Planned Next Steps:** Monitor and refine based on feedback.

### 2. `TokenPerformanceTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`
-   **Purpose:** Displays a sortable and paginated table of token performance data for the selected wallet, filterable by the global time range.
-   **Current State:** Implemented as a client component. Accepts `walletAddress`, `isAnalyzingGlobal`, and `triggerAnalysisGlobal`. Uses SWR to fetch data from `/api/v1/wallets/{walletAddress}/token-performance` with various query parameters (pagination, sorting, date range, filters).
    -   **Loading States:** 
        -   If `isAnalyzingGlobal` is true, shows an `EmptyState` with `Loader2` and "Analyzing Wallet..." message.
        -   Otherwise, if `isLoadingData` (SWR loading) is true, shows an `EmptyState` with `Loader2` and "Loading..." message.
    -   **Error State:** If `error && !data`, displays an `EmptyState` with `AlertTriangle` icon, error message, and a "Retry Analysis" button.
    -   **Empty/No Data States:**
        -   If `!walletAddress`, shows an `EmptyState` with `InfoIcon` and "No Wallet Selected".
        -   If `tableData` is empty after loading and no error, displays an `EmptyState` with `BarChartIcon`, "No Token Data Found", and contextual advice based on active filters or if the wallet needs analysis.
    Features extensive client-side controls for filtering and display. Uses shadcn/ui `Table` and `Pagination`.
-   **Key Props:** `walletAddress: string`, `isAnalyzingGlobal?: boolean`, `triggerAnalysisGlobal?: () => void`.
-   **Planned Next Steps:** Further UI polish as needed.

### 3. `BehavioralPatternsTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`
-   **Purpose:** Displays behavioral analysis for the selected wallet, including classifications, metrics, and visualizations, filterable by the global time range.
-   **Current State:** Implemented as a client component. Accepts `walletAddress`, `isAnalyzingGlobal`, and `triggerAnalysisGlobal`. Uses SWR to fetch data from `/api/v1/wallets/{walletAddress}/behavior-analysis`.
    -   **Loading States:** 
        -   If `isAnalyzingGlobal` is true, shows an `EmptyState` with `Loader2` and "Analyzing Wallet..." message.
        -   Otherwise, if `behaviorIsLoading` (SWR loading) is true, shows an `EmptyState` with `Loader2` and "Loading Behavioral Data..." message.
    -   **Error States:** 
        -   If `behaviorError` occurs, it checks if it's a 404 or specific "no data found" message; if so, shows an `EmptyState` (variant `info`, icon `Users`) with "Behavioral Profile Not Generated" and an "Analyze Wallet" button.
        -   For other errors, shows an `EmptyState` (variant `error`, icon `AlertTriangle`) with "Error Loading Behavioral Data" and a "Retry Analysis" button.
    -   **Empty/No Data States:** 
        -   If `!behaviorData && !behaviorIsLoading && !behaviorError` (no data after load, no error), shows `EmptyState` (variant `info`, icon `Users`) with "No Behavioral Data Found" and "Analyze Wallet" button.
        -   A final `!behaviorData` check (if somehow still no data) shows `EmptyState` (variant `info`, icon `Users`) with "Data Preparation Error".
    Displays metrics using Tremor and charts using ECharts via a reusable `EChartComponent`.
-   **Key Props:** `walletAddress: string`, `isAnalyzingGlobal?: boolean`, `triggerAnalysisGlobal?: () => void`.
-   **Planned Next Steps:** Considered largely complete in terms of state handling.

### 4. `AccountStatsPnlTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
-   **Purpose:** Displays detailed Profit and Loss (PNL) overview statistics for the selected wallet, including both period-specific and all-time data with tabbed view (Period/All-Time/Both).
-   **Current State:** Implemented as a client component. Accepts `walletAddress`, `isAnalyzingGlobal`, `triggerAnalysisGlobal`, and `lastAnalysisTimestamp`. Uses SWR to fetch data from `/wallets/{walletAddress}/pnl-overview`. Features three display modes via TabGroup: Period only (index 0), All-Time only (index 1), or Both side-by-side (index 2, default).
    -   **Internal Components:**
        -   `AccountStatsPnlDisplay` - Renders PNL metrics grouped by sections (Core Trading Metrics, Volume & Capital Flow, Advanced Token Analytics). Includes tooltips explaining each metric, color-coded profit/loss indicators, and collapsible accordion for advanced analytics.
        -   `PnlDisplaySkeleton` - Loading skeleton matching the structure of AccountStatsPnlDisplay for smooth loading transitions.
    -   **Loading States:**
        -   If `isLoading` is true (not analyzing), shows `PnlDisplaySkeleton` for current display mode with skeleton TabGroup.
        -   Skeleton preserves current `displayMode` state for better UX continuity.
    -   **Error States:**
        -   If `error.status === 404`, shows `EmptyState` (variant `info`, icon `SearchX`) with "PNL Data Not Yet Available" and "Analyze Wallet" button.
        -   For other errors, shows `EmptyState` (variant `error`, icon `AlertTriangle`) with error message and "Retry Analysis" button.
    -   **Empty/No Data States:**
        -   If `!pnlData && !isLoading && !error`, shows `EmptyState` with "PNL Data Not Generated" and "Analyze Wallet" button.
        -   Detailed context-aware `EmptyState` messages for `periodCardContent` and `allTimeCardContent`:
          - Checks if `startDate > lastAnalysisTimestamp` → suggests "Refresh Wallet Data"
          - Checks if wallet never analyzed → shows "Analyze Wallet"
          - Checks if last analysis > 3 hours ago → offers "Refresh Wallet Data"
          - Otherwise shows informational message about data unavailability
    -   **Metrics Displayed:**
        - **Core Trading:** Realized PNL, Unrealized PNL, Avg P/L per Trade, Token Win Rate (with profitable/unprofitable token counts)
        - **Volume & Capital Flow:** Total Volume Traded, Total SOL Spent, Total SOL Received
        - **Advanced Analytics (Accordion):** Median P/L per Token, PNL Standard Deviation, Trimmed Mean PNL, Median PNL/Volatility Ratio, Avg PNL/Day Active, Weighted Efficiency Score
    -   **Special Features:**
        - Color-coded metrics (green for positive, red for negative, blue for volume)
        - Arrow indicators (▲/▼) for profit/loss direction
        - Extensive tooltips via TooltipProvider explaining each metric's meaning
        - Responsive grid layouts (2/4 columns for core, 2/3 for volume, 2x3 grid for advanced)
        - `dataFrom` timestamp display showing when data was calculated
-   **Key Props:** `walletAddress: string`, `isAnalyzingGlobal?: boolean`, `triggerAnalysisGlobal?: () => void`, `lastAnalysisTimestamp?: Date | null`.
-   **Planned Next Steps:** Considered complete.

### 5. `ReviewerLogTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/ReviewerLogTab.tsx`
-   **Purpose:** Wallet notes management interface for reviewers and analysts.
-   **Current State:** Full CRUD interface for wallet-specific notes. Fetches notes from `/wallets/:address/notes`. Features add/edit/delete/view operations with confirmation dialogs. Supports sortable table by date (ascending/descending). Shows author information and timestamps. Includes demo mode restrictions (read-only for demo accounts). Uses EmptyState for loading, error, and no-data scenarios.
-   **Key Props:**
    - `walletAddress: string` (required)
-   **Special Features:**
    - **Loading States:** Shows EmptyState with Loader2 while fetching notes
    - **Error States:** 404 shows "Wallet Not Found for Notes", other errors show retry option
    - **Empty State:** Shows "No Notes Available" with "Add Note" CTA
    - **CRUD Operations:**
      - **Create:** Toggle form with textarea, submit button with loading state
      - **Read:** Sortable table with truncated preview, "View Full Note" dialog
      - **Update:** Edit dialog with textarea and save/cancel actions
      - **Delete:** Confirmation AlertDialog with note preview
    - **Demo Mode:** Restricts write operations (add/edit/delete) with toast notifications
    - **Sorting:** Click date header to toggle asc/desc order
    - **Full View Dialog:** Scrollable dialog showing complete note content
    - **Edit Dialog:** Modal textarea for editing existing notes
    - **Tooltips:** Action buttons have descriptive tooltips (View/Edit/Delete)
-   **State Management:** Uses SWR for data fetching, manual mutate for optimistic updates
-   **Planned Next Steps:** Considered complete.

## Sidebar Child Components

### 1. `WalletSearch.tsx`

-   **File Path:** `dashboard/src/components/sidebar/WalletSearch.tsx`
-   **Purpose:** Provides wallet search functionality within the sidebar.
-   **Current State:** Uses SWR for fetching search results from `/api/v1/wallets/search`. 
    -   **API Key Missing:** Shows an inline message if `NEXT_PUBLIC_API_KEY` is not set.
    -   **Loading State:** An inline `Loader2` icon is shown in the input field during SWR loading.
    -   **Error State:** If `searchError` occurs, displays an inline message with `AlertTriangle` within the results popover.
    -   **Empty/No Data State:** If `!searchError && !isSearchLoading && searchResults && searchResults.length === 0`, shows an inline "No wallets found..." message in the popover.
    -   **Analysis Trigger:** Includes a button to "Import & Analyze" a wallet if it's a valid Solana address and not found in results. This button has its own `isAnalyzing` loading state with an inline `Loader2` icon and uses toasts for feedback.
-   **Planned Next Steps:** UI considered stable for current scope.

### 2. `FavoriteWalletsList.tsx`

-   **File Path:** `dashboard/src/components/sidebar/FavoriteWalletsList.tsx`
-   **Purpose:** Displays a list of user's favorite wallets in the sidebar.
-   **Current State:** Uses SWR to fetch from `/api/v1/users/me/favorites`. 
    -   **API Key Missing:** Shows a dedicated message block with `Info` icon if `NEXT_PUBLIC_API_KEY` is not set.
    -   **Loading State:** Shows a message block with `Loader2` icon and "Loading favorites..." text.
    -   **Error State:** Shows a message block with `AlertTriangle` icon and the error message.
    -   **Empty State:** If `!favoriteWallets || favoriteWallets.length === 0`, shows a message block with `Star` icon and "No favorite wallets yet." text.
    When collapsed, a simple icon is shown, and the popover contains the detailed list or state message. Uses toasts for add/remove/copy feedback.
-   **Planned Next Steps:** UI considered stable for current scope.

## Shared Components

### 1. `TimeRangeSelector.tsx`

-   **File Path:** `dashboard/src/components/shared/TimeRangeSelector.tsx`
-   **Purpose:** Allows users to select a global time range that affects data displayed across various dashboard views.
-   **Current State:** Implemented as a client component (`"use client"`). It features a row of `Button` components for selecting predefined time range presets (24h, 7d, 1m, 3m, YTD, All). Below the preset buttons, two input-like `Button` components display the current start and end dates. Clicking these buttons opens `Calendar` components within `Popover`s, allowing users to select a custom date range. The component is connected to a Zustand store (`time-range-store.ts`) to manage and persist the selected time range globally. It displays the currently active range (e.g., "1m: Apr 23 - May 23, 25" or "Custom: May 10 - May 20, 25").
-   **Key Props:** None.
-   **Planned Next Steps:** The component is considered functionally complete for now.

### 2. `TokenBadge.tsx`

-   **File Path:** `dashboard/src/components/shared/TokenBadge.tsx`
-   **Purpose:** Smart, self-sufficient component for displaying token metadata with automatic enrichment and batching.
-   **Current State:** **CRITICAL ARCHITECTURE COMPONENT** - This is the centralized place for all token metadata handling in the application. The component automatically fetches token metadata if not provided, with sophisticated batching to prevent duplicate API calls. Multiple TokenBadges rendering simultaneously are **automatically batched** into ONE API call (50ms debounce window). Implements two-phase data flow: Phase 1 shows immediate cached database data, Phase 2 auto-refreshes after 2 seconds with enriched data. Uses subscriber pattern to notify React components when enriched data arrives. POST `/token-info` endpoint triggers background enrichment (fire-and-forget) and returns current cached data immediately.
-   **Key Props:**
    - `mint: string` (required) - Token mint address
    - `metadata?: TokenMetadata` (optional) - Pass when parent already has metadata (optimization)
    - `className?: string` (optional)
    - `size?: "sm" | "md" | "lg"` (optional, default: "md")
-   **Special Features:**
    - **Auto-Batching:** 100 tokens = 2 API calls total (initial + refresh), not 200
    - **Two-Phase Flow:** Shows cached data instantly → auto-updates after enrichment
    - **Subscriber Pattern:** Components re-render automatically when enriched data arrives
    - **Graceful Degradation:** Shows "Unknown Token" if metadata unavailable, still functional
    - **Centralized Priority Logic:** Onchain data FIRST for name/symbol (immutable), DexScreener FIRST for images/socials (fresher)
    - **Popover Actions:** Copy address, view on Solscan/gmgn.ai, social links (website, Twitter, Telegram)
-   **Usage Patterns:**
    - **Simple (recommended):** `<TokenBadge mint="..." />` - Let component handle everything
    - **Optimized:** `<TokenBadge mint="..." metadata={...} />` - When parent already has metadata from API
-   **Planned Next Steps:** Considered complete. DO NOT manually call enrichment APIs when using this component.

### 3. `WalletBadge.tsx`

-   **File Path:** `dashboard/src/components/shared/WalletBadge.tsx`
-   **Purpose:** Unified component for displaying wallet addresses with consistent actions across the application.
-   **Current State:** Displays truncated wallet address (4 chars...4 chars) with wallet icon. On click, opens popover with full address and action buttons. Supports copying address to clipboard, viewing on Solscan block explorer, and navigating to internal wallet profile page. Memoized with `React.memo` for performance.
-   **Key Props:**
    - `address: string` (required) - Wallet address
    - `className?: string` (optional)
-   **Special Features:**
    - **Three Actions:**
      - Copy: Copies full wallet address to clipboard
      - Solscan: Opens Solscan block explorer in new tab
      - Details: Navigates to internal wallet profile page (`/wallets/[address]`)
    - **Tooltips:** All actions have descriptive tooltips
    - **Toast Notifications:** Copy action shows toast confirmation
    - **Click Handling:** Prevents event propagation to avoid interfering with parent components
-   **Planned Next Steps:** Considered complete.

### 4. `EmptyState.tsx`

-   **File Path:** `dashboard/src/components/shared/EmptyState.tsx`
-   **Purpose:** Reusable component for displaying empty states, loading states, and error states with consistent UX.
-   **Current State:** Flexible component supporting multiple variants (default, error, info, playful). Displays icon, title, description, and optional action button. Automatically handles loading spinner for Loader2 icon and action buttons. Supports custom icons and colors per variant.
-   **Key Props:**
    - `icon?: LucideIcon` (optional) - Icon to display
    - `title: string` (required) - Main heading
    - `description?: string` (optional) - Additional context
    - `actionText?: string` (optional) - CTA button text
    - `onActionClick?: () => void` (optional) - CTA button handler
    - `isActionLoading?: boolean` (optional) - Shows loading spinner on button
    - `actionIcon?: LucideIcon` (optional) - Icon for CTA button
    - `variant?: 'default' | 'error' | 'info' | 'playful'` (optional)
    - `className?: string` (optional)
-   **Special Features:**
    - **Convenience Exports:** `ErrorState`, `InfoState`, `PlayfulErrorState` components for common cases
    - **Auto-Spin:** Automatically animates Loader2 and RefreshCw icons
    - **Playful Variant:** Randomly selects from fun icons (SearchX, FileQuestion, ServerCrash)
-   **Planned Next Steps:** Considered complete.

## Holder Profiles v2 Components

These components implement the wallet baseball card UI pattern for behavioral analysis visualization.

### 1. `WalletBaseballCard.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx`
-   **Purpose:** Main card component displaying comprehensive wallet behavioral analysis in a baseball card format.
-   **Current State:** Displays wallet behavior classification, hold time metrics (median/average), exit timing distribution, data quality indicator, and token counts. Features interactive exit timing cohort bars that open drilldown panel when clicked. Uses color-coded quality indicators (HIGH=green, MEDIUM=blue, LOW=yellow, INSUFFICIENT=red). Handles both realized (exited) and inclusive (exited + active) metrics with visual highlighting when current holdings data is included.
-   **Key Props:**
    - `profile: HolderProfile` (required) - Wallet behavioral analysis data
    - `walletAddress: string` (required) - Wallet address being analyzed
-   **Special Features:**
    - **Exit Timing Drilldown:** Click any cohort bar to see tokens in that time bucket (instant, ultraFast, fast, momentum, intraday, day, swing, position)
    - **Data Quality Indicator:** Visual dot with tooltip showing confidence tier
    - **Hold Time Breakdown:** Shows both "Exited" only vs "Active + exited" metrics
    - **Smart Estimation:** Estimates held token count from percentage when direct count unavailable
    - **Tooltips:** Comprehensive tooltips explaining classification methodology and metrics
-   **Planned Next Steps:** Considered complete.

### 2. `ExitTimingDrilldownPanel.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx`
-   **Purpose:** Floating panel showing tokens in a specific exit timing cohort.
-   **Current State:** Non-blocking floating panel that appears when user clicks cohort bar. Fetches token mint addresses from backend (`GET /wallets/:address/exit-timing-tokens/:bucket`), displays tokens using TokenBadge (which handles enrichment automatically). Implements pagination with "Load more" button (initial 50 tokens, load 50 more at a time). Panel is dismissible via close button or clicking outside. Backend reads from cached `holdTimeTokenMap` in database (instant ~5ms read, no re-analysis).
-   **Key Props:**
    - `walletAddress: string` (required)
    - `timeBucket: TimeBucket` (required) - Which cohort (instant, ultraFast, etc.)
    - `bucketLabel: string` (required) - Display label for cohort
    - `isOpen: boolean` (required) - Panel visibility state
    - `onClose: () => void` (required) - Close handler
-   **Special Features:**
    - **Non-Blocking UI:** Uses `pointer-events-none` on overlay, `pointer-events-auto` on panel
    - **Database Caching:** Backend reads from cached profile, no re-analysis on every click
    - **Automatic Batching:** TokenBadge batching means 100 tokens = 2 API calls, not 200
    - **Pagination:** Client-side pagination to handle large cohorts (1100+ tokens)
    - **Toggle Behavior:** Clicking same cohort bar again closes panel
-   **Planned Next Steps:** Considered complete.

### 3. `WalletHeroCard.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/WalletHeroCard.tsx`
-   **Purpose:** Wrapper component for displaying single wallet baseball card in hero position.
-   **Current State:** Simple wrapper that extracts first profile from results and renders WalletBaseballCard. Shows empty state if no profile available.
-   **Key Props:**
    - `result: HolderProfilesResult` (required)
-   **Planned Next Steps:** Considered complete.

### 4. `WalletCompareCard.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/WalletCompareCard.tsx`
-   **Purpose:** Compact variant of WalletBaseballCard for multi-wallet comparison views.
-   **Current State:** Similar to WalletBaseballCard but optimized for grid layout when comparing multiple wallets.
-   **Key Props:**
    - `result: HolderProfilesResult` (required)
-   **Planned Next Steps:** Considered complete.

### 5. `WalletClassifier.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/WalletClassifier.tsx`
-   **Purpose:** Orchestrator component managing multiple wallet analysis jobs and displaying results.
-   **Current State:** Manages wallet entries with states (idle, running, completed, failed). Shows loading indicators for running jobs, error states for failed jobs. Renders single wallet as WalletHeroCard, multiple wallets as grid with WalletGroupInsights. Handles progress tracking and error messages.
-   **Key Props:**
    - `entries: WalletClassifierEntry[]` (required) - Array of wallet analysis jobs
-   **Special Features:**
    - **State Management:** Tracks job status, progress, messages, errors
    - **Adaptive Layout:** Single vs multi-wallet rendering
    - **Progress Indicators:** Shows analysis progress percentage and messages
    - **Error Handling:** Displays failure states with error details
-   **Planned Next Steps:** Considered complete.

### 6. `WalletGroupInsights.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/WalletGroupInsights.tsx`
-   **Purpose:** Displays aggregate insights when analyzing multiple wallets together.
-   **Current State:** Calculates and displays group-level metrics for behavior classification distribution and hold time patterns.
-   **Key Props:**
    - `profiles: HolderProfile[]` (required)
-   **Planned Next Steps:** Considered complete.

### 7. `CognitiveMetricCard.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/CognitiveMetricCard.tsx`
-   **Purpose:** Small card displaying individual cognitive primitive metric.
-   **Current State:** Shows metric label, value, category, and description. Uses color-coding for category visualization.
-   **Key Props:**
    - `primitive: CognitivePrimitive` (required) - Metric data (label, value, category, description, color)
-   **Planned Next Steps:** Considered complete.

### 8. `TransactionDateRange.tsx`

-   **File Path:** `dashboard/src/components/holder-profiles/v2/TransactionDateRange.tsx`
-   **Purpose:** Small utility component for displaying transaction date range in holder profiles.
-   **Current State:** Simple presentational component that formats and displays the oldest and newest transaction timestamps for a wallet's analyzed period. Uses `date-fns` for date formatting (MMM d, yyyy format). Returns null if timestamps are not provided.
-   **Key Props:**
    - `oldestTimestamp?: number` (optional) - Unix timestamp of oldest transaction
    - `newestTimestamp?: number` (optional) - Unix timestamp of newest transaction
-   **Display Format:** "Transactions from Oct 15, 2024 to Dec 9, 2024"
-   **Planned Next Steps:** Considered complete.

### 9. Other v2 Components

Additional helper components in `holder-profiles/v2/`:
- **TokenPulse.tsx** - Token-specific behavioral indicators and holder cohort visualization
- **OutcomeStrip.tsx** - Visual strip showing outcome distribution
- **BehaviorCompositionBar.tsx** - Bar chart for behavior type composition
- **CognitivePrimitivesRow.tsx** - Row layout for cognitive metrics
- **MinimalHoldersTable.tsx** - Compact table for holder lists

Utility files in `holder-profiles/v2/utils/`:
- **behavior.ts** - Behavior classification logic and utilities
- **cognitive-primitives.ts** - Cognitive primitive calculations
- **formatters.ts** - Formatting utilities for holder profile data
- **group-insights.ts** - Multi-wallet group analysis calculations
- **outcome-logic.ts** - Token outcome classification logic

## Similarity Lab Components

These components power the wallet similarity analysis features.

### 1. `TopHoldersPanel.tsx`

-   **File Path:** `dashboard/src/components/similarity-lab/TopHoldersPanel.tsx`
-   **Purpose:** Interactive panel for exploring top token holders and selecting wallets for similarity analysis.
-   **Current State:** Fetches top holders for a token mint via `/wallets/top-holders`. Displays holders list with WalletBadge components and interactive bubble map visualization. Supports holder selection with checkboxes, select/unselect all, filtering to owners only (excludes program accounts), and copy/add to similarity set actions. Shows TokenBadge with metadata for searched token. Uses debounced input (500ms) to avoid unnecessary API calls.
-   **Key Props:**
    - `onAddToSet?: (wallets: string[]) => void` (optional) - Callback to add selected wallets to similarity set
    - `maxHeightClass?: string` (optional) - Override scroll container height
-   **Special Features:**
    - **Dual View:** List (left) + bubble map visualization (right)
    - **Smart Filtering:** "Owners only" checkbox to exclude program/unknown accounts
    - **Bulk Actions:** Select all, copy selected addresses, add to similarity set
    - **Commitment Level:** Dropdown to select Solana commitment level (finalized/confirmed/processed)
    - **Selection Tracking:** Shows count of selected holders
    - **Responsive Grid:** Adapts layout for mobile/desktop
-   **Planned Next Steps:** Considered complete.

### 2. `TopHoldersBubbleMap.tsx`

-   **File Path:** `dashboard/src/components/similarity-lab/TopHoldersBubbleMap.tsx`
-   **Purpose:** D3-based bubble visualization of top holders.
-   **Current State:** Interactive force-directed graph showing holders as bubbles sized by token amount. Bubbles are color-coded and clickable to toggle selection. Integrates with parent selection state.
-   **Key Props:**
    - `holders: TopHolderItem[]` (required)
    - `selected: Record<string, boolean>` (required)
    - `onToggle: (address: string) => void` (required)
    - `className?: string` (optional)
-   **Planned Next Steps:** Considered complete.

### 3. `SimilarityResultDisplay.tsx`

-   **File Path:** `dashboard/src/components/similarity-lab/results/SimilarityResultDisplay.tsx`
-   **Purpose:** Main container for displaying wallet similarity analysis results.
-   **Current State:** Orchestrates display of all similarity result components (GlobalMetricsCard, OverlapHeatmap, HistoricalVsLiveComparison, EnhancedKeyInsights, ContextualHoldingsCard, MostCommonTokens). Fetches enriched balances for tokens. Handles loading and error states.
-   **Key Props:**
    - `results: CombinedSimilarityResult` (required)
-   **Planned Next Steps:** Considered complete.

### 4. `MostCommonTokens.tsx`

-   **File Path:** `dashboard/src/components/similarity-lab/results/MostCommonTokens.tsx`
-   **Purpose:** Shows top tokens shared across wallet set.
-   **Current State:** Calculates token overlap across wallet pairs, displays top 20 most common tokens with TokenBadge. Shows count of wallets holding each token. Tooltip reveals which specific wallets share each token (using WalletBadge). Implements timeout fallback for metadata loading. Memoized for performance.
-   **Key Props:**
    - `results: CombinedSimilarityResult` (required)
    - `enrichedBalances: Record<string, any> | null` (required)
-   **Special Features:**
    - **Smart Metadata Handling:** Builds lookup map from enriched balances, passes to TokenBadge
    - **Wallet Details Tooltip:** Hover to see all wallets sharing a token
    - **Sorted Display:** Top 20 tokens by number of holders
    - **Fallback UI:** Shows "Unknown Token" after 300ms timeout if metadata unavailable
-   **Planned Next Steps:** Considered complete.

### 5. `ContextualHoldingsCard.tsx`

-   **File Path:** `dashboard/src/components/similarity-lab/results/ContextualHoldingsCard.tsx`
-   **Purpose:** Displays detailed holdings for a selected wallet with WalletBadge integration.
-   **Current State:** Shows wallet holdings in context of similarity analysis. Uses WalletBadge for wallet display, provides link to internal wallet profile page.
-   **Key Props:**
    - `wallet: string` (required)
    - `holdings: any[]` (required)
-   **Planned Next Steps:** Considered complete.

### 6. `EnhancedKeyInsights.tsx`

-   **File Path:** `dashboard/src/components/similarity-lab/results/EnhancedKeyInsights.tsx`
-   **Purpose:** Displays key insights and patterns from similarity analysis.
-   **Current State:** Shows aggregate metrics and patterns identified across wallet set.
-   **Key Props:**
    - `results: CombinedSimilarityResult` (required)
-   **Planned Next Steps:** Considered complete.

### 7. `WalletInputForm.tsx`

- **File Path:** `dashboard/src/components/similarity-lab/WalletInputForm.tsx`
- **Purpose:** Main input form for entering wallet addresses in Similarity Lab.
- **Current State:** Textarea-based form for entering/pasting multiple wallet addresses. Supports comma or newline separation. Shows real-time parsing feedback with wallet count badge. Displays live progress bar during analysis. Integrates with parent state for external wallet injection (from TopHoldersPanel).
- **Key Props:**
  - `onWalletsChange: (wallets: string[]) => void` (required) - Callback when wallet list changes
  - `onAnalyze: () => void` (required) - Callback to trigger analysis
  - `isRunning: boolean` (required) - Whether analysis is currently running
  - `jobProgress: number` (required) - Progress percentage (0-100)
  - `progressMessage: string` (required) - Status message during analysis
  - `externalWallets?: string[]` (optional) - Wallets injected from other sources
- **Special Features:**
  - **Smart Parsing:** Auto-deduplicates, validates format, supports multi-line paste
  - **Real-time Feedback:** Badge showing wallet count, validation indicators
  - **Progress Display:** Linear progress bar with percentage and status message
  - **External Integration:** Syncs with `externalWallets` prop for bulk addition
- **Planned Next Steps:** Considered complete.

### 8. Other Similarity Components

Additional components in `similarity-lab/results/`:
- **GlobalMetricsCard.tsx** - Overall similarity metrics card
- **OverlapHeatmap.tsx** - Heatmap visualization of wallet overlaps
- **HistoricalVsLiveComparison.tsx** - Compares historical vs current holdings
- **TokenHoldingRow.tsx** - Row component for token holdings display

Additional components in `similarity-lab/`:
- **WalletSelector.tsx** - Wallet selection interface (deprecated/legacy)

## Page Components (App Router)

### 1. `dashboard/src/app/wallets/[walletAddress]/page.tsx`

-   **Purpose:** Renders the profile for a specific wallet address.
-   **Current State:** Uses `WalletProfileLayout`. No specific loading/empty/error states managed directly by this page component itself, as `WalletProfileLayout` and its children handle these.

### 2. `dashboard/src/app/settings/page.tsx`

-   **Purpose:** Page for application settings.
-   **Current State:** Simple placeholder content. No specific data fetching or associated state handling implemented yet.

### 3. `dashboard/src/app/help/page.tsx`

-   **Purpose:** Page for help and documentation.
-   **Current State:** Simple placeholder content. No specific data fetching or associated state handling implemented yet.

### 4. `dashboard/src/app/page.tsx` (Landing Page)

- **File Path:** `dashboard/src/app/page.tsx`
- **Purpose:** Main landing page for the application.
- **Current State:** Primarily static content with mock data for "Recently Analyzed Wallets" and "Featured Wallet". Does not currently implement SWR or `EmptyState.tsx` for these sections as data is not dynamically fetched from an API. Input for wallet search navigates to the wallet page.
- **Planned Next Steps:** If recent/featured wallets were to be fetched from an API, loading/empty/error states would need to be added.

### 5. `dashboard/src/app/similarity-lab/page.tsx`

- **File Path:** `dashboard/src/app/similarity-lab/page.tsx`
- **Purpose:** Wallet similarity analysis tool - discovers hidden connections between wallets based on trading behavior and capital allocation.
- **Current State:** Full-featured analysis page with WebSocket-based job tracking. Uses `WalletInputForm` for multi-wallet input, `TopHoldersPanel` dialog for adding wallets from token holders, and `SimilarityResultDisplay` for showing analysis results. Implements two-job flow: main similarity analysis + background token enrichment. Features "Back to Top" button for long result pages, localStorage persistence for analysis results, and refresh prices functionality.
- **Key Features:**
  - **Dual Input Methods:** Direct wallet address input via form + bulk addition from token top holders
  - **WebSocket Job Tracking:** Real-time progress updates for both analysis and enrichment jobs
  - **Two-Phase Flow:** Phase 1 returns raw balances instantly, Phase 2 enriches with prices/metadata in background
  - **Invalid Wallet Handling:** Smart error messages showing which specific wallets failed validation
  - **Price Refresh:** Manual refresh button to update token prices after analysis
  - **Result Persistence:** Auto-saves to localStorage, loads on page refresh
  - **Polling Fallback:** Gracefully falls back to HTTP polling if WebSocket unavailable
- **Job States:** Tracks separate states for analysis job (main) and enrichment job (metadata/pricing)
- **Integration:** Links to `/tools/top-holders` standalone utility
- **Planned Next Steps:** Considered complete.

### 6. `dashboard/src/app/tools/holder-profiles/page.tsx`

- **File Path:** `dashboard/src/app/tools/holder-profiles/page.tsx`
- **Purpose:** Outcome-first behavioral analysis tool for token cohorts and individual wallet scouts.
- **Current State:** Dual-mode analysis interface (token mode + wallet mode). Token mode analyzes top N holders of a token mint (using `/analyses/holder-profiles` endpoint). Wallet mode analyzes custom list of wallets (using `/analyses/holder-profiles/wallet` endpoint). Uses `WalletClassifier` component for displaying wallet analysis results and `TokenPulse` for token holder cohort visualization. Implements incremental progress updates via WebSocket with partial results display.
- **Key Features:**
  - **Token Mode:** Input token mint + top N (1-50) → analyzes behavior of top holders
  - **Wallet Mode:** Paste/input comma-separated wallet addresses → individual wallet behavioral profiles
  - **Incremental Display:** Shows partial results as they arrive (live streaming of holder profiles)
  - **WebSocket Progress:** Real-time job tracking with percentage and status messages
  - **Wallet Parsing:** Smart deduplication and validation of pasted wallet lists
  - **Result Components:** `TokenPulse` for token cohorts, `WalletClassifier` for wallet grids
- **Job Tracking:** Separate job IDs and states for each wallet in wallet mode, single job for token mode
- **Planned Next Steps:** Considered complete.

### 7. `dashboard/src/app/tools/top-holders/page.tsx`

- **File Path:** `dashboard/src/app/tools/top-holders/page.tsx`
- **Purpose:** Standalone utility page for exploring token top holders.
- **Current State:** Simple wrapper around `TopHoldersPanel` component. Provides dedicated full-page interface for fetching and exploring top holders of any token mint. No additional logic beyond rendering the panel.
- **Key Features:**
  - **Standalone Tool:** Accessible via `/tools/top-holders` route
  - **Full Page Layout:** Uses container layout with card wrapper
  - **Consistent UI:** Reuses same `TopHoldersPanel` component from Similarity Lab
- **Integration:** Linked from Similarity Lab page as alternative tool
- **Planned Next Steps:** Considered complete.

## Root Layout

### 1. `dashboard/src/app/layout.tsx`

-   **Purpose:** The main root layout for the entire dashboard application.
-   **Current State:** It's a client component (`"use client"`) to manage the sidebar's collapsed state. Integrates the `Sidebar` component and passes down the state and toggle function. Provides a main content area whose `marginLeft` adjusts based on the sidebar's collapsed state (`12rem` for expanded, `5rem` for collapsed). Sets up global styles, fonts (Geist Sans/Mono), and `ThemeProvider`. Includes `suppressHydrationWarning`. The `metadata` export has been moved to `page.tsx`.
-   **Key Props:** `children: React.ReactNode`.

## UI Components (shadcn/ui)

The dashboard uses shadcn/ui components located in `dashboard/src/components/ui/`. These are pre-built, customizable components that follow Radix UI primitives:

- **accordion.tsx** - Collapsible content sections
- **alert.tsx** / **alert-dialog.tsx** - Alert messages and confirmation dialogs
- **avatar.tsx** - User avatar display
- **badge.tsx** - Small status/label badges
- **button.tsx** - Primary button component
- **calendar.tsx** - Date picker calendar
- **card.tsx** - Container card component
- **dialog.tsx** - Modal dialog windows
- **dropdown-menu.tsx** - Dropdown menu component
- **input.tsx** - Text input field
- **label.tsx** - Form label
- **pagination.tsx** - Pagination controls
- **popover.tsx** - Popover overlay
- **progress.tsx** - Progress bar
- **radio-group.tsx** - Radio button group
- **scroll-area.tsx** - Scrollable container
- **select.tsx** - Select dropdown
- **separator.tsx** - Visual divider
- **skeleton.tsx** - Loading skeleton
- **switch.tsx** - Toggle switch
- **table.tsx** - Table component
- **tabs.tsx** - Tabbed interface
- **textarea.tsx** - Multi-line text input
- **toast.tsx** / **toaster.tsx** - Toast notifications
- **tooltip.tsx** - Hover tooltips

These components are built on top of Radix UI primitives and styled with Tailwind CSS. They are used throughout the dashboard for consistent UI patterns.

## Utility Files

### 1. `dashboard/src/lib/utils.ts`

-   **Purpose:** Utility functions, primarily for `cn` (class name helper) provided by `shadcn/ui`.
-   **Current State:** Contains the `cn` function.

### 2. `dashboard/src/lib/fetcher.ts`

-   **File Path:** `dashboard/src/lib/fetcher.ts`
-   **Purpose:** Provides a shared SWR fetcher function for making API calls.
-   **Current State:** Contains an `async` function that takes a URL, includes the `X-API-Key` header from Zustand store (`useApiKeyStore`), handles response errors (including parsing JSON error payloads), and returns the JSON response. Used throughout the application as the standard fetcher for SWR hooks.
-   **Special Features:**
    - **Centralized API Key:** Gets API key from Zustand store, not environment variable
    - **Error Handling:** Parses error responses and throws with status/message
    - **Type-Safe:** Returns properly typed JSON responses
-   **Planned Next Steps:** Considered complete.

### 3. `dashboard/src/hooks/useTokenMetadata.ts`

-   **File Path:** `dashboard/src/hooks/useTokenMetadata.ts`
-   **Purpose:** Hook providing automatic batching for token metadata requests.
-   **Current State:** **CRITICAL INFRASTRUCTURE** - Global singleton batcher that collects token metadata requests in 50ms debounce window and makes ONE batched API call. Implements subscriber pattern for auto-refresh after enrichment. Returns immediate cached data (Phase 1), then auto-refreshes after 2 seconds to get enriched data (Phase 2). Used internally by TokenBadge component.
-   **Key Features:**
    - **Global Batching Queue:** 100 components requesting metadata = 1 API call (not 100)
    - **Debounced Execution:** 50ms window to collect requests before batching
    - **Cache Management:** In-memory cache to avoid redundant requests
    - **Subscriber Pattern:** Components subscribe to metadata updates for auto-refresh
    - **Two-Phase Flow:** Immediate cached data + delayed enriched data refresh
-   **Export:**
    - `useTokenMetadata(mint, providedMetadata?)` - Main hook for fetching metadata
    - `clearTokenMetadataCache()` - Utility to clear cache (testing/forced refresh)
-   **Planned Next Steps:** Considered complete. DO NOT modify batching logic without understanding full impact.

## Charts and Visualization Components

### 1. `EChartComponent.tsx`

-   **File Path:** `dashboard/src/components/charts/EChartComponent.tsx`
-   **Purpose:** Reusable wrapper for Apache ECharts integration.
-   **Current State:** Generic wrapper component handling ECharts initialization, options, and responsive resizing. Used throughout dashboard for behavioral pattern charts and analytics visualizations.
-   **Key Props:**
    - `option: EChartsOption` (required) - ECharts configuration object
    - `className?: string` (optional)
-   **Special Features:**
    - **Auto-Resize:** Handles window resize events
    - **Theme Support:** Integrates with application theme
    - **Performance:** Properly cleans up chart instances on unmount
-   **Planned Next Steps:** Considered complete.

## Theme and UI Components

### 1. `ThemeToggleButton.tsx`

-   **File Path:** `dashboard/src/components/theme-toggle-button.tsx`
-   **Purpose:** Button to toggle between light/dark theme.
-   **Current State:** Uses `next-themes` to switch themes. Shows sun/moon icon based on current theme.
-   **Key Props:** None.
-   **Planned Next Steps:** Considered complete.

### 2. `ThemeProvider.tsx`

-   **File Path:** `dashboard/src/components/theme-provider.tsx`
-   **Purpose:** Wrapper providing theme context to application.
-   **Current State:** Sets up `next-themes` ThemeProvider with system theme detection and persistence.
-   **Key Props:**
    - `children: React.ReactNode` (required)
    - `attribute?: string` (optional)
    - `defaultTheme?: string` (optional)
-   **Planned Next Steps:** Considered complete.

## Additional Layout Components

### 1. `LayoutClientShell.tsx`

-   **File Path:** `dashboard/src/components/layout/LayoutClientShell.tsx`
-   **Purpose:** Client-side shell managing sidebar state and layout.
-   **Current State:** Wraps sidebar and main content area, manages collapsed state, adjusts content margins based on sidebar state.
-   **Key Props:**
    - `children: React.ReactNode` (required)
-   **Planned Next Steps:** Considered complete.

### 2. `LazyTabContent.tsx`

-   **File Path:** `dashboard/src/components/layout/LazyTabContent.tsx`
-   **Purpose:** Lazy-loading wrapper for dashboard tab content.
-   **Current State:** Prevents unnecessary rendering of inactive tabs. Loads tab content only when tab becomes active. Improves initial page load performance.
-   **Key Props:**
    - `isActive: boolean` (required)
    - `children: React.ReactNode` (required)
-   **Planned Next Steps:** Considered complete.

### 3. `QuickAddForm.tsx`

-   **File Path:** `dashboard/src/components/layout/QuickAddForm.tsx`
-   **Purpose:** Form for quickly adding wallets to favorites.
-   **Current State:** Inline form in sidebar for one-click favorite additions. Includes validation and toast feedback.
-   **Key Props:** Internal state management.
-   **Planned Next Steps:** Considered complete.

### 4. `WalletEditForm.tsx`

-   **File Path:** `dashboard/src/components/layout/WalletEditForm.tsx`
-   **Purpose:** Form for editing wallet metadata (labels, notes).
-   **Current State:** Modal form allowing users to update wallet information. Includes validation and auto-save.
-   **Key Props:**
    - `walletAddress: string` (required)
    - `onClose: () => void` (required)
-   **Planned Next Steps:** Considered complete.

## Additional Sidebar Components

### 1. `FavoriteWalletItem.tsx`

-   **File Path:** `dashboard/src/components/sidebar/FavoriteWalletItem.tsx`
-   **Purpose:** Individual favorite wallet list item.
-   **Current State:** Displays single favorite wallet with actions (remove, copy, navigate). Handles hover states and tooltips. Integrates with sidebar collapsed state.
-   **Key Props:**
    - `wallet: FavoriteWallet` (required)
    - `onRemove: (address: string) => void` (required)
-   **Planned Next Steps:** Considered complete.

## Status and Monitoring Components

### 1. `WebSocketStatus.tsx`

-   **File Path:** `dashboard/src/components/shared/WebSocketStatus.tsx`
-   **Purpose:** Displays WebSocket connection status indicator.
-   **Current State:** Shows real-time connection status (connected, disconnected, reconnecting). Used for job monitoring and live updates. Color-coded indicator with tooltip explaining current state.
-   **Key Props:**
    - `status: 'connected' | 'disconnected' | 'reconnecting'` (required)
-   **Planned Next Steps:** Considered complete.