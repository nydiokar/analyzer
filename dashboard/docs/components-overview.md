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
-   **Current State:** Features a single sticky header (`sticky top-0`) that includes the wallet address, the `AccountSummaryCard`, and the `TimeRangeSelector`. Below the header, a `Tabs` component (from `shadcn/ui`) is used to organize content. The `TabsList` and `TabsContent` will scroll with the main page content. It is a client component (`"use client"`) to manage tab state.
-   **Key Props:** `children: React.ReactNode`, `walletAddress: string`.
-   **Planned Next Steps:** Populate tab content with relevant data visualizations and components.

## Dashboard Specific Components

### 1. `AccountSummaryCard.tsx`

-   **File Path:** `dashboard/src/components/dashboard/AccountSummaryCard.tsx`
-   **Purpose:** To display a snapshot of key account-level metrics in the header.
-   **Current State:** Implemented as a client component (`"use client"`). Accepts a `walletAddress` prop. Uses SWR to fetch data from the mock API endpoint `/api/v1/wallets/{walletAddress}/summary`. Displays loading, error, or data states. Uses Tremor components (`Card`, `Text`, `Metric`, `Flex`, `Grid`) for data presentation. `date-fns` is used for formatting dates.
-   **Key Props:** `walletAddress: string`.
-   **Planned Next Steps:** Connect to a live API. Potentially add more visual elements or refine existing ones.

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