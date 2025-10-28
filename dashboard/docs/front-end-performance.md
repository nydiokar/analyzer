# Front-end Performance Notes

Last updated: 2025-10-28

## Current Status
- [x] Server-backed token metrics: spam risk and most formatting are computed on the server, reducing client work.
- [x] Row virtualization in `TokenPerformanceTab` via `@tanstack/react-virtual` keeps DOM ~10–15 rows.
- [x] Stabilized skeleton/layout heights; CLS significantly reduced.
- [ ] Lighthouse CI smoke-test gate (deferred; run locally when needed).
- [ ] PR template performance checklist (optional; can add later).

## Current Bottlenecks
- TokenPerformanceTab render: Significantly improved post-virtualization and server-side metrics. Remaining variance comes from large payloads and device constraints.
- Client-side recalculation on interactions: Improved, but heavy filters can still rebuild TanStack table; acceptable for GA.
- Layout thrash: Addressed via fixed skeleton heights and container min-heights; monitor during UI changes.

## Why Regressions Keep Returning
1. **Everything runs on the client** – We ship hundreds of kilobytes of analysis logic and re-execute it any time UI state moves. Minor JSX edits often cause re-renders that restack this workload, so “any change” can feel slow.
2. **Large payloads with no virtualization** – We routinely render 50–100 rows at once with nested flex layouts, sparklines and tooltips. Without windowing, every render walks the full list.
3. **Dynamic imports gate the UI** – Tabs are lazy-loaded (good for bundle size) but still block on fetching & executing big chunks before showing meaningful content. When the first tab is also data-heavy, users stare at spinners.

## Guardrails & Next Steps
- [x] Virtualize the token table (via `@tanstack/react-virtual`) to cap DOM rows and reduce INP.
- [x] Pre-compute/cache heavy metrics server-side (spam risk, key formatting) so the client binds data.
- [x] Stabilise layout heights (fixed skeleton rows, min-heights for cards/badges) to reduce CLS.
- [ ] Measure after changes: run local Lighthouse (`npm run build && npm run start -- --turbo`) as needed. CI gate deferred.

## Definitive Optimization Plan (checkpointed)
1. [x] Ship server-backed token metrics – spam-risk and key formatting now computed server-side.
2. [x] Introduce row virtualization – `@tanstack/react-virtual` enabled for `TokenPerformanceTab`.
3. [x] Lock in layout skeletons – fixed-height skeletons and container min-heights applied.
4. [ ] Automate performance smoke-tests – CI Lighthouse gate deferred (keep local runs for spot checks).
5. [ ] Document profiling workflow – PR template performance checklist (optional).

## Quick Checklist for Future Work
- Adding data to a tab? Confirm the chunk size via `next build --analyze`.
- Adjusting filters? Profile CPU time for the handler in React DevTools profiler.
- Seeing CLS >0.1? Insert placeholder containers with `min-height` or skeleton rows so async content does not shift layout.

Keep the token experience primary: load lightweight summaries first, then progressively hydrate analytics-heavy panels.
