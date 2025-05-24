# Dashboard Components Overview

This document provides an overview of the React components created for the Wallet Analysis Dashboard.

## Layout Components

### 1. `Sidebar.tsx`

-   **File Path:** `dashboard/src/components/layout/Sidebar.tsx`
-   **Purpose:** Provides main navigation for the dashboard.
-   **Current State:** Basic stub with static placeholder links for Dashboard Home, Wallets (example links), Settings, and Help/Documentation. Uses Tailwind CSS for basic styling.
-   **Key Props:** None currently.
-   **Planned Next Steps:** Make wallet links dynamic, integrate with `shadcn/ui` navigation components (e.g., `Collapsible`, `NavigationMenu`) for better UX and styling, implement active link highlighting.

### 2. `WalletProfileLayout.tsx`

-   **File Path:** `dashboard/src/components/layout/WalletProfileLayout.tsx`
-   **Purpose:** Provides the main layout structure for individual wallet profile pages.
-   **Current State:** Features a sticky header that includes an improved wallet address display (WalletIcon, truncated address in a Badge, and a copy-to-clipboard Button with toast feedback). The header also contains the `AccountSummaryCard` and the `TimeRangeSelector`. Below the header, a `Tabs` component (from `shadcn/ui`) is used to organize content. It now dynamically renders `TokenPerformanceTab` and `BehavioralPatternsTab` components. It is a client component (`"use client"`) to manage tab state and copy-to-clipboard functionality.
-   **Key Props:** `children: React.ReactNode`, `walletAddress: string`.
-   **Planned Next Steps:** Populate remaining tab content (Account Stats & PNL, Notes). Consider making the main sidebar toggleable for more content space.

## Dashboard Specific Components

### 1. `AccountSummaryCard.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountSummaryCard.tsx`
-   **Purpose:** To display a snapshot of key account-level metrics in the header.
-   **Current State:** Implemented as a client component (`"use client"`). Accepts a `walletAddress` prop. Uses SWR to fetch data from the live API endpoint `/api/v1/wallets/{walletAddress}/summary`. SWR is configured with `revalidateOnFocus: false` and custom `onErrorRetry` logic for robustness. Displays loading, error (customized display), or data states. Uses Tremor components for data presentation and `date-fns` for formatting.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Monitor and refine based on feedback. Ensure all data points remain robustly handled by the time filter.

### 2. `TokenPerformanceTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`
-   **Purpose:** Displays a sortable and paginated table of token performance data for the selected wallet, filterable by the global time range.
-   **Current State:** Implemented as a client component (`"use client"`). Accepts `walletAddress`. Uses SWR and a shared `fetcher` to call `/api/v1/wallets/{walletAddress}/token-performance`. Incorporates global `startDate` and `endDate` from `useTimeRangeStore`. Manages local state for pagination (page, pageSize) and sorting (sortBy, sortOrder). Handles loading, error, and no-data states. Table headers are sticky, and the table body is scrollable. Rows have alternating background colors (zebra striping) and bottom borders for clarity. Pagination is positioned at the bottom of the card.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Further UI polish as needed based on feedback.

### 3. `BehavioralPatternsTab.tsx`

-   **File Path:** `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx` (Assuming this exists as per plan)
-   **Purpose:** Displays behavioral analysis for the selected wallet, including classifications, metrics, and visualizations, filterable by the global time range.
-   **Current State:** Implemented as a client component. Uses SWR to fetch data from `/api/v1/wallets/{walletAddress}/behavior-analysis`, passing `startDate` and `endDate` from `useTimeRangeStore`. Handles loading, error, and no-data states. Displays basic behavioral metrics.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Verify that all displayed data and any visualizations (e.g., heatmaps) correctly reflect the selected time scope.

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
-   **Current State:** Integrates the `Sidebar` component and provides a main content area for page content. Sets up global styles, fonts (Geist Sans/Mono), and metadata. Includes `suppressHydrationWarning`.

## Utility Files

### 1. `dashboard/src/lib/utils.ts`

-   **Purpose:** Utility functions, primarily for `cn` (class name helper) provided by `shadcn/ui`.
-   **Current State:** Contains the `cn` function.

### 2. `dashboard/src/lib/fetcher.ts`

-   **File Path:** `dashboard/src/lib/fetcher.ts`
-   **Purpose:** Provides a shared SWR fetcher function for making API calls.
-   **Current State:** Contains an `async` function that takes a URL, includes the `X-API-Key` header (from `NEXT_PUBLIC_API_KEY` environment variable), handles response errors (including parsing JSON error payloads), and returns the JSON response. 