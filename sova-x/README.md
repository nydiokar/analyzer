# sova-x

Standalone X reply tool for Sova Intel.

This service has two operating modes:

- primary mode: operator-only mention polling on X with explicit mint-in-mention triggers
- fallback mode: an internal manual trigger page that takes a trigger tweet URL and mint

In both modes, it calls Sova Intel holder profiles through the SDK and posts a single compact holder-profile reply in-thread.

The analyzer remains the intelligence layer only.

See [SPEC.md](C:\Users\Cicada38\Projects\analyzer\sova-x\SPEC.md) for the product and system contract.

## Scaffold status

This repository now includes a minimal TypeScript scaffold with two independent test surfaces:

- local render validation
- X transport validation

That separation is intentional:

- local render can be tested without hitting X
- reply-post behavior can be tested without the full holder-profile pipeline
- mention polling can be tested separately from reply rendering

## Current scripts

- `build` - compile TypeScript
- `verify` - type-check only
- `test:render` - write local holder-distribution SVG/PNG cards and summary JSON
- `test:live-render <mint>` - call the live SDK and write real holder-distribution SVG/PNG cards and summary JSON
- `test:parse` - validate mint extraction from a mention string
- `test:x:mentions [sinceId]` - fetch mentions for the configured bot user, including author metadata, then filter locally to allowed operator IDs
- `test:x:oauth1-me` - verify OAuth 1.0a user-context auth against `GET /users/me`
- `test:x:oauth2-start` - generate an OAuth 2.0 PKCE authorize URL and store the PKCE session locally
- `test:x:oauth2-listen` - start a local callback receiver on the configured redirect URI and finish the token exchange automatically
- `test:x:oauth2-complete "<callback_url>"` - exchange the callback code for a user access token
- `test:x:post` - post a simple text tweet with OAuth 1.0a user-context credentials
- `test:x:media-post [pngPath] [replyToTweetId] [text...]` - upload a PNG and create a post or reply with attached media
- `manual:server` - start a tiny local internal page for manual `tweetUrl + mint` preview/post flow

## Local workflow

1. Build the project
2. Run `test:render`
3. Inspect `out/holder-distribution-card.png`
4. Run `test:live-render <mint>` to validate live holder-profile output
5. For OAuth 2.0 PKCE, run `test:x:oauth2-listen`, then `test:x:oauth2-start`, then approve the app in the browser
6. Run `test:x:mentions` to validate the operator-only mention path
7. Run `test:x:post` and `test:x:media-post` separately when credentials are configured
8. Run `manual:server` to test the fallback internal trigger flow in a browser

## Intended operating model

Primary mode:

1. An operator replies on X and mentions `@sova_intel` with the mint in the mention text
2. `sova-x` polls the mentions timeline with `since_id`
3. `sova-x` reads all returned mentions from X
4. `sova-x` filters locally to `X_ALLOWED_CALLER_IDS`
5. Only allowed-operator mentions can trigger analysis and reply posting
6. The bot replies to the operator's trigger tweet in-thread

Important constraint:

- X mention timelines cannot be filtered server-side to only your operators
- filtering happens after the mentions are returned
- that means all returned mentions can still count toward X usage

Risk control:

- set a hard monthly spend cap in the X Developer Console
- keep trigger operators restricted by `X_ALLOWED_CALLER_IDS`
- require explicit mint-in-mention parsing

Plan B fallback:

1. A human operator uses the internal trigger page
2. The operator pastes the trigger tweet URL and mint
3. `sova-x` runs holder profiles, renders the social card, and posts one reply under that trigger tweet

This fallback is already implemented locally and can be served behind existing dashboard auth later.

For local testing, the manual trigger UI runs at `http://127.0.0.1:8787` and supports:

- previewing the generated reply text + image
- posting the reply under the provided trigger tweet when credentials are configured
- acting as a production fallback if mention polling is disabled

## Important limitations in the scaffold

- live Sova Intel SDK integration is not wired yet
- live Sova Intel SDK integration is available via `test:live-render`
- token metadata lookup uses lightweight Dexscreener fetch with fallback-to-mint behavior
- PNG generation is wired
- PNG upload to X is wired for the simple single-image path via OAuth 2.0 bearer access token
- media posting is wired for a single uploaded PNG
- upload-status polling after finalize is not implemented yet
- manual mode currently runs as a local standalone page, not yet mounted inside the main dashboard auth flow
