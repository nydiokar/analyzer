# Dashboard Components Overview

This document provides an overview of the React components created for the Wallet Analysis Dashboard.

## Layout Components

### 1. `Sidebar.tsx`

-   **File Path:** `dashboard/src/components/layout/Sidebar.tsx`
-   **Purpose:** Provides main navigation for the dashboard. It is collapsible.
-   **Current State:** Implemented with Tailwind CSS and Lucide icons. Manages its collapsed/expanded state based on props passed from `RootLayout`. Includes a toggle button. Displays placeholder links for Dashboard Home, Wallets, Settings, and Help/Documentation. Conditionally renders text labels based on collapsed state. Expanded width is `12rem` (`w-48`), collapsed width is `5rem` (`w-20`).
-   **Key Props:** `isCollapsed: boolean`, `toggleSidebar: () => void`.
-   **Planned Next Steps:** Make wallet links dynamic. Implement active link highlighting.

### 2. `WalletProfileLayout.tsx`

-   **File Path:** `dashboard/src/components/layout/WalletProfileLayout.tsx`
-   **Purpose:** Provides the main layout structure for individual wallet profile pages.
-   **Current State:** Features a sticky header that includes an improved wallet address display (WalletIcon, truncated address in a Badge, copy-to-clipboard Button) and the `ThemeToggleButton`. The `AccountSummaryCard` (which now also displays current SOL balance) and `TimeRangeSelector` are also part of this sticky header. The main navigation `TabsList` (for Overview, Token Performance, Account Stats & PNL, etc.) is also integrated into the sticky header, below the summary components. The parent `Tabs` component wraps the entire layout (header and main content area) to ensure `TabsList` functions correctly. Dynamically renders `TokenPerformanceTab`, `AccountStatsPnlTab`, and `BehavioralPatternsTab` components within their respective `TabsContent`. It is a client component (`"use client"`) to manage tab state and copy-to-clipboard functionality. Padding has been minimized.
-   **Key Props:** `children: React.ReactNode`, `walletAddress: string`.
-   **Planned Next Steps:** Populate remaining tab content (Notes).

## Dashboard Specific Components

### 1. `AccountSummaryCard.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountSummaryCard.tsx`
-   **Purpose:** To display a snapshot of key account-level metrics in the header, including the current SOL balance.
-   **Current State:** Implemented as a client component (`"use client"`). Accepts a `walletAddress` prop. Uses SWR to fetch data from the live API endpoint `/api/v1/wallets/{walletAddress}/summary`. This data includes `currentSolBalance` and `balancesFetchedAt`. SWR is configured with `revalidateOnFocus: false` and custom `onErrorRetry` logic for robustness. Displays loading, error (customized display), or data states. Uses Tremor components for data presentation and `date-fns` for formatting.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Monitor and refine based on feedback. Ensure all data points remain robustly handled by the time filter.

### 2. `TokenPerformanceTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`
-   **Purpose:** Displays a sortable and paginated table of token performance data for the selected wallet, filterable by the global time range. It also shows the current UI-friendly balance for each token and allows filtering to show only current holdings.
-   **Current State:** Implemented as a client component (`"use client"`). Accepts `walletAddress`. Uses SWR and a shared `fetcher` to call `/api/v1/wallets/{walletAddress}/token-performance`. This API response now includes `currentUiBalance` and `currentUiBalanceString` for each token. Incorporates global `startDate`, `endDate`, and a new `showOnlyHoldings` flag (from `useTokenPerformanceStore`, which is passed to the API if true) from `useTimeRangeStore`. Manages local state for pagination (page, pageSize) and sorting (sortBy, sortOrder). Handles loading, error, and no-data states. The "Net Amount" column has been repurposed to "Current Supply", displaying `currentUiBalanceString` or a formatted `currentUiBalance`. Table headers are sticky, and the table body is scrollable. Rows have alternating background colors (zebra striping) and bottom borders for clarity. Pagination is positioned at the bottom of the card. A toggle for "Show Only Current Holdings" is implemented and functional.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Further UI polish as needed based on feedback.

### 3. `BehavioralPatternsTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`
-   **Purpose:** Displays behavioral analysis for the selected wallet, including classifications, metrics, and visualizations, filterable by the global time range.
-   **Current State:** Implemented as a client component. Uses SWR and the shared `fetcher` to fetch data from `/api/v1/wallets/{walletAddress}/behavior-analysis`, passing `startDate` and `endDate` from `useTimeRangeStore`. Handles loading, error, and no-data states. Displays basic behavioral metrics using Tremor components.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Implement visualizations (e.g., heatmaps, histograms) using ECharts. Verify that all displayed data and visualizations correctly reflect the selected time scope.

### 4. `AccountStatsPnlTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
-   **Purpose:** Displays detailed Profit and Loss (PNL) overview statistics for the selected wallet, including both period-specific and all-time data.
-   **Current State:** Implemented as a client component. Uses SWR and the shared `fetcher` to call the `/api/v1/wallets/{walletAddress}/pnl-overview` API endpoint, passing global `startDate` and `endDate` from `useTimeRangeStore`. Handles loading, error, and no-data states. The UI presents "Period Specific Data" and "All-Time Data" in two horizontally arranged `Card` components (using a `Grid`). Within each card, data is grouped into sections ("Overall Performance", "Volume & Activity", "Advanced Token Stats") with headers and borders. Uses `AccountStatsPnlDisplay.tsx` for rendering the metric groups. Tooltips (shadcn/ui `Tooltip`) are implemented for advanced metrics.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Monitor for any further feedback on data presentation or layout.

### 5. `AccountStatsPnlDisplay.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountStatsPnlDisplay.tsx`
-   **Purpose:** A sub-component responsible for rendering groups of PNL metrics within the `AccountStatsPnlTab.tsx`.
-   **Current State:** Receives data for either period-specific or all-time PNL. Displays metrics using Tremor `Metric` and `Text` components. Metrics are grouped with `Title` and `Flex` for layout. PNL values are color-coded (green for positive, red for negative). "Volume & Activity" metrics have a blue accent. Advanced Token Stats section has a subtle background and padding for visual distinction. Font sizes for metrics and labels have been adjusted for balance. Tooltips are integrated.
-   **Key Props:** `data: PnlOverviewResponseData | null | undefined`, `title: string`, `isLoading: boolean`.
-   **Planned Next Steps:** Considered largely complete unless further refinements are needed based on `AccountStatsPnlTab.tsx` evolution.

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
-   **Current State:** Uses `WalletProfileLayout`. Displays placeholder text including the dynamic `walletAddress` param.

### 2. `dashboard/src/app/settings/page.tsx`

-   **Purpose:** Page for application settings.
-   **Current State:** Simple placeholder content.

### 3. `dashboard/src/app/help/page.tsx`

-   **Purpose:** Page for help and documentation.
-   **Current State:** Simple placeholder content.

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