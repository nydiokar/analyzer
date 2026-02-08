# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Streamflow lock vault detection in holder profiles via program owner check
- Automatic database tagging for registry wallets (burn addresses, protocol wallets, etc.)
- Defense-in-depth wallet classification with three protection layers (entry points, sync service, analysis services)

### Fixed
- Dashboard now correctly shows completion state for known wallets instead of perpetual "Analysis running..." message
- Registry wallets (BURN, LP, Jupiter, etc.) now properly tagged in database with knownType/knownLabel
- WalletBadge component now displays labels for known wallet types in dashboard
- Streamflow lock vaults no longer misclassified as liquidity pools in holder profiles

### Changed
- **BREAKING**: Consolidated wallet types - removed RAYDIUM, ORCA, JUPITER, METEORA individual types in favor of unified PROTOCOL type
- Wallet classification system now uses defense-in-depth architecture with three protection layers
- Optimized database queries: behavior service reduced from 2 to 1 query per analysis (50% reduction)
- System wallets (70k+ tokens) now detected and tagged during current run, not just for future runs
- Simplified SKIP_* exclusion sets to use PROTOCOL type instead of individual protocol types

## [0.20.5] - 2026-01-14

### Added
- GitHub Releases workflow with automatic changelog extraction
- Release automation scripts (`release.sh` and `release.ps1`)
- Changelog management following Keep a Changelog format
- SemVer versioning guidelines for the project

[Unreleased]: https://github.com/nydiokar/analyzer/compare/v0.20.5...HEAD
[0.20.5]: https://github.com/nydiokar/analyzer/releases/tag/v0.20.5
