## Latest Updates
- Added design tokens (shadow tiers + radius overrides) in `dashboard/tailwind.config.ts`.
- Introduced `Metric` and `StatCard` components under `dashboard/src/components/ui/`.
- Added `/test-components` page (`dashboard/src/app/test-components/page.tsx`) to showcase variants and responsive/dark-mode behavior.
- Migrated `dashboard/src/components/dashboard/AccountSummaryCard.tsx` off Tremor to shadcn + custom Metric/StatCard with p-6 spacing and shadow system; kept existing error/unanalyzed flows.
- Migrated `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` wrapper to shadcn Card (rounded-xl, shadow-base/hover) and replaced Tremor text/flex uses with standard layout classes; table logic unchanged.

## Testing
- `npm run lint --prefix dashboard` (pre-existing warnings only; no new issues from added files).
