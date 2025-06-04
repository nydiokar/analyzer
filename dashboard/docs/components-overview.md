# Dashboard Components Overview

This document provides an overview of the React components created for the Wallet Analysis Dashboard.

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
-   **Current State:** Features a sticky header that includes an improved wallet address display (WalletIcon, truncated address in a Badge, copy-to-clipboard Button) and the `ThemeToggleButton`. Directly under the wallet address display, an "Refresh Wallet Analysis" button allows users to trigger a backend analysis for the current wallet. This button provides UI feedback (loading state, toasts for start/completion/failure) and revalidates SWR caches upon success. The component also fetches and displays the "Last analyzed" timestamp and a status indicator (dot) based on data from the wallet summary endpoint. The `AccountSummaryCard` (which now also displays current SOL balance) and `TimeRangeSelector` are also part of this sticky header. The main navigation `TabsList` (for Overview, Token Performance, Account Stats & PNL, etc.) is also integrated into the sticky header, below the summary components. The parent `Tabs` component wraps the entire layout (header and main content area) to ensure `TabsList` functions correctly. Dynamically renders `TokenPerformanceTab`, `AccountStatsPnlTab`, and `BehavioralPatternsTab` components within their respective `TabsContent`. It is a client component (`"use client"`) to manage tab state, analysis triggering, and copy-to-clipboard functionality. Padding has been minimized.
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
-   **Purpose:** Displays detailed Profit and Loss (PNL) overview statistics for the selected wallet, including both period-specific and all-time data.
-   **Current State:** Implemented as a client component. Accepts `walletAddress`, `isAnalyzingGlobal`, `triggerAnalysisGlobal`, and `lastAnalysisTimestamp`. Uses SWR to fetch data from `/api/v1/wallets/{walletAddress}/pnl-overview`.
    -   **Loading States:** 
        -   If `isAnalyzingGlobal` is true, shows an `EmptyState` with `Loader2` and "Analyzing Wallet..." message.
        -   Otherwise, if `isLoading` (SWR loading) is true, shows an `EmptyState` with `Loader2` and "Loading PNL Data..." message.
    -   **Error States:** 
        -   If `error` occurs, it checks if `error.status` is 404; if so, shows an `EmptyState` (variant `info`, icon `SearchX`) with "PNL Data Not Yet Available" and an "Analyze Wallet" button.
        -   For other errors, shows an `EmptyState` (variant `error`, icon `AlertTriangle`) with "Error Fetching PNL Data" and a "Retry Analysis" button.
    -   **Empty/No Data States:** 
        -   If `!pnlData && !isLoading && !error` (no data after load, no error), shows `EmptyState` (variant `info`, icon `SearchX`) with "PNL Data Not Generated" and "Analyze Wallet" button.
        -   A final `!pnlData && !isAnalyzingGlobal` check shows `EmptyState` (variant `info`, icon `Info`) with "PNL Data Unavailable".
        -   Detailed `EmptyState` messages are rendered for `periodCardContent` and `allTimeCardContent` based on data availability and `lastAnalysisTimestamp`, providing specific guidance and CTAs.
    Uses `AccountStatsPnlDisplay.tsx` for rendering metric groups.
-   **Key Props:** `walletAddress: string`, `isAnalyzingGlobal?: boolean`, `triggerAnalysisGlobal?: () => void`, `lastAnalysisTimestamp?: Date | null`.
-   **Planned Next Steps:** Considered largely complete in terms of state handling.

### 5. `AccountStatsPnlDisplay.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountStatsPnlDisplay.tsx`
-   **Purpose:** A sub-component responsible for rendering groups of PNL metrics within the `AccountStatsPnlTab.tsx`.
-   **Current State:** Receives `data` and `title`. If `!data`, it renders a simple "No data available for this period." within a Card. It does not manage its own loading/error states as it expects processed data from its parent.
-   **Key Props:** `data: PnlOverviewResponseData | null`, `title: string`.
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

## Root Layout

### 1. `dashboard/src/app/layout.tsx`

-   **Purpose:** The main root layout for the entire dashboard application.
-   **Current State:** It's a client component (`"use client"`) to manage the sidebar's collapsed state. Integrates the `Sidebar` component and passes down the state and toggle function. Provides a main content area whose `marginLeft` adjusts based on the sidebar's collapsed state (`12rem` for expanded, `5rem` for collapsed). Sets up global styles, fonts (Geist Sans/Mono), and `ThemeProvider`. Includes `suppressHydrationWarning`. The `metadata` export has been moved to `page.tsx`.
-   **Key Props:** `children: React.ReactNode`.

## Utility Files

### 1. `dashboard/src/lib/utils.ts`

-   **Purpose:** Utility functions, primarily for `cn` (class name helper) provided by `shadcn/ui`.
-   **Current State:** Contains the `cn` function.

### 2. `dashboard/src/lib/fetcher.ts`

-   **File Path:** `dashboard/src/lib/fetcher.ts`
-   **Purpose:** Provides a shared SWR fetcher function for making API calls.
-   **Current State:** Contains an `async` function that takes a URL, includes the `X-API-Key` header (from `NEXT_PUBLIC_API_KEY` environment variable), handles response errors (including parsing JSON error payloads), and returns the JSON response. 