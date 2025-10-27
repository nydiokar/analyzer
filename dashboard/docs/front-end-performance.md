# Front-end Performance Notes

Last updated: 2025-10-27

## Current Bottlenecks
- **TokenPerformanceTab render** – Dominates Largest Contentful Paint. The first render blocks on a large paginated payload and the synchronous `analyzeTokenSpamRisk` pass over every row. The observed LCP element is a token table cell (`span.font-mono…`), confirming the table finishes after ~10 s on slower runs.
- **Client-side recalculation on interactions** – Each filter/search/page change rebuilds the entire TanStack table, re-running expensive formatting and spam analysis. Lighthouse shows Interaction to Next Paint spikes (~2 s) caused by the main thread doing work inside `renderTableContent`.
- **Layout thrash** – Skeletons place minimal height; when real rows arrive the table grows >400 px, producing a CLS cluster (~0.1). Header badges and tab strips also shift once async data fills.

## Why Regressions Keep Returning
1. **Everything runs on the client** – We ship hundreds of kilobytes of analysis logic and re-execute it any time UI state moves. Minor JSX edits often cause re-renders that restack this workload, so “any change” can feel slow.
2. **Large payloads with no virtualization** – We routinely render 50–100 rows at once with nested flex layouts, sparklines and tooltips. Without windowing, every render walks the full list.
3. **Dynamic imports gate the UI** – Tabs are lazy-loaded (good for bundle size) but still block on fetching & executing big chunks before showing meaningful content. When the first tab is also data-heavy, users stare at spinners.

## Guardrails & Next Steps
- **Virtualize the token table** (eg. `@tanstack/react-virtual`). Keep DOM ~10–15 rows to shrink render time and reduce INP spikes.
- **Pre-compute or cache heavy metrics on the server**. Return derived spam scores and formatted strings so the client only binds data.
- **Stabilise layout heights**. Ensure skeleton rows and cards reserve final height, add min-heights to badge containers, and avoid async components pushing header size.
- **Measure after each change**. Run `npm run lint` + Lighthouse (`npm run lint && npm run build && npm run start -- --turbo` if staging) to catch regressions before shipping.

## Definitive Optimization Plan (Required before GA)
1. **Ship server-backed token metrics** – move spam-risk and numeric formatting to an API-prepared payload so clients render plain data. Track with a feature flag until verified.
2. **Introduce row virtualization** – adopt `@tanstack/react-virtual` (or equivalent) for `TokenPerformanceTab` and gate rollout behind a config toggle for quick rollback.
3. **Lock in layout skeletons** – define fixed-height skeleton rows/cards and update tremor flex wrappers to prevent late shifts; add a regression test using `@testing-library/react` + `jest-dom` to assert consistent heights.
4. **Automate performance smoke-tests** – extend CI to run Chrome Lighthouse against `/wallets/[demo]` and fail the build if LCP >4 s, INP >200 ms, or CLS >0.05.
5. **Document profiling workflow** – include React Profiler + Lighthouse steps in the PR template to make performance sign-off explicit.

## Quick Checklist for Future Work
- Adding data to a tab? Confirm the chunk size via `next build --analyze`.
- Adjusting filters? Profile CPU time for the handler in React DevTools profiler.
- Seeing CLS >0.1? Insert placeholder containers with `min-height` or skeleton rows so async content does not shift layout.

Keep the token experience primary: load lightweight summaries first, then progressively hydrate analytics-heavy panels.
