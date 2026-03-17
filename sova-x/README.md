# sova-x

Standalone X reply tool for Sova Intel.

This service accepts a human-triggered request with a target X post URL and token mint, calls Sova Intel holder profiles through the SDK, and posts a single compact holder-profile reply in-thread.

The analyzer remains the intelligence layer only.

See [SPEC.md](C:\Users\Cicada38\Projects\analyzer\sova-x\SPEC.md) for the product and system contract.

## Scaffold status

This repository now includes a minimal TypeScript scaffold with two independent test surfaces:

- local render validation
- X transport validation

That separation is intentional:

- local render can be tested without hitting X
- reply-post behavior can be tested without the full holder-profile pipeline

## Current scripts

- `build` - compile TypeScript
- `verify` - type-check only
- `test:render` - write local holder-distribution SVG/PNG cards and summary JSON
- `test:live-render <mint>` - call the live SDK and write real holder-distribution SVG/PNG cards and summary JSON
- `test:parse` - validate mint extraction from a mention string
- `test:x:oauth1-me` - verify OAuth 1.0a user-context auth against `GET /users/me`
- `test:x:oauth2-start` - generate an OAuth 2.0 PKCE authorize URL and store the PKCE session locally
- `test:x:oauth2-listen` - start a local callback receiver on the configured redirect URI and finish the token exchange automatically
- `test:x:oauth2-complete "<callback_url>"` - exchange the callback code for a user access token
- `test:x:post` - post a simple text tweet with OAuth 1.0a user-context credentials
- `test:x:media-post [pngPath] [replyToTweetId] [text...]` - upload a PNG and create a post or reply with attached media

## Local workflow

1. Build the project
2. Run `test:render`
3. Inspect `out/holder-distribution-card.png`
4. Run `test:live-render <mint>` to validate live holder-profile output
5. For OAuth 2.0 PKCE, run `test:x:oauth2-listen`, then `test:x:oauth2-start`, then approve the app in the browser
6. Run `test:x:post` and `test:x:media-post` separately when credentials are configured

## Intended v1 workflow

The primary product flow is manual and internal:

1. A human operator finds a post worth replying to
2. The operator pastes the target X post URL into an internal Sova page
3. The operator pastes the token mint
4. `sova-x` runs holder profiles, renders the social card, and posts one reply under that target post

This intentionally avoids public mention monitoring and continuous X polling in v1.

## Important limitations in the scaffold

- live Sova Intel SDK integration is not wired yet
- live Sova Intel SDK integration is available via `test:live-render`
- token metadata lookup uses lightweight Dexscreener fetch with fallback-to-mint behavior
- PNG generation is wired
- PNG upload to X is wired for the simple single-image path via OAuth 2.0 bearer access token
- media posting is wired for a single uploaded PNG
- upload-status polling after finalize is not implemented yet
- the internal trigger page is not wired yet
