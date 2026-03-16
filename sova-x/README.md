# sova-x

Standalone X bot for Sova Intel.

This service listens for mentions to the appointed Sova account, extracts a token mint from the mention text, calls Sova Intel holder profiles through the SDK, and posts a single compact holder-profile reply in-thread.

The analyzer remains the intelligence layer only.

See [SPEC.md](C:\Users\Cicada38\Projects\analyzer\sova-x\SPEC.md) for the product and system contract.

## Scaffold status

This repository now includes a minimal TypeScript scaffold with two independent test surfaces:

- local render validation
- X transport validation

That separation is intentional:

- local render can be tested without hitting X
- mention fetch/post behavior can be tested without the full holder-profile pipeline

## Current scripts

- `build` - compile TypeScript
- `verify` - type-check only
- `test:render` - write local holder-distribution SVG/PNG cards and summary JSON
- `test:live-render <mint>` - call the live SDK and write real holder-distribution SVG/PNG cards and summary JSON
- `test:parse` - validate mint extraction from a mention string
- `test:x:mentions` - fetch mentions for the configured bot user
- `test:x:post` - post a simple text tweet with the configured X credentials

## Local workflow

1. Build the project
2. Run `test:render`
3. Inspect `out/holder-distribution-card.png`
4. Run `test:live-render <mint>` to validate live holder-profile output
5. Run `test:x:mentions` and `test:x:post` separately when credentials are configured

## Important limitations in the scaffold

- live Sova Intel SDK integration is not wired yet
- live Sova Intel SDK integration is available via `test:live-render`
- token metadata lookup uses lightweight Dexscreener fetch with fallback-to-mint behavior
- PNG generation is wired
- PNG upload to X is not wired yet
- media posting is intentionally deferred until render output is finalized locally
