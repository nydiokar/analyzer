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

## Usage
Most scripts support command-line arguments. Run with `--help` for options:

```bash
npx ts-node scripts/manage-users.ts --help
npx ts-node scripts/clean-logs.ts stats
```
