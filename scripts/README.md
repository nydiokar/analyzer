# Administrative & Maintenance Scripts

Scripts for system administration, data management, and operational tasks.

## User Management
- `manage-users.ts` - CLI for creating, listing, activating, deactivating, and deleting users
- `create-test-user.ts` - Create test users for development and testing

## Data Cleanup
- `clear-wallet-data.ts` - Clear all database records for a specific wallet address
- `clear-all-queues.ts` - Clear all queued jobs from the job queue system
- `clear-stale-locks.ts` - Remove stale database locks from interrupted processes
- `clean-redis-locks.ts` - Clean stuck Redis locks from interrupted processes

## System Maintenance
- `clean-logs.ts` - Manage log files (stats, cleanup old logs, create backups)
- `validate-dependencies.ts` - Validate project dependencies and configurations
- `backfill-dexscreener-data.ts` - Backfill missing Dexscreener data

## Utilities
- `extract-log-statements.ts` - Extract and analyze log statements from log files
- `compare_helius_endpoints.ts` - Compare and test different Helius API endpoints
- `debug-mapper.ts` - Debug and map data structures and relationships
- `inspect-analysis-result.ts` - Inspects specific token and wallet in terms of FIFO and pnl
- `validate-fifo-inputs.ts` - Validates if FIFO is performing as expected and debugs tokens
- `review-tracked-wallets.ts` - Read-only analyst review export for a user's tracked wallets with cohort-relative hold/entry/exit metrics

## Usage
Most scripts support command-line arguments. Run with `--help` for options:

```bash
pnpm user:manage --help
pnpm clean:logs stats
pnpm review:tracked-wallets --user <userId> --sort composite --limit 20
pnpm review:tracked-wallets --user <userId> --format html --out /tmp/tracked-wallet-review.html
```

Production maintenance commands run through the Docker `admin` profile, so
they use the same Postgres and Redis network/configuration as the application.
Use the package command when one exists. For a new maintenance script, use
the generic runner:

```bash
pnpm admin:run scripts/my-maintenance-script.ts --help
```

The runner creates and removes the one-off container automatically; no manual
Docker command or host-side `DATABASE_URL` is required.
