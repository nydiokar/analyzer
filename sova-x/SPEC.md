# Sova X Spec

## Purpose

`sova-x` is a separate service that uses Sova Intel strictly as an intelligence layer.

It does not embed analytics logic. It listens for mentions to `@sova_intel` on X, extracts the target token mint from the mention text, calls Sova Intel holder profiles through the SDK, computes the Twitter-sized summary fields, and posts a single final reply in-thread from the appointed Sova account.

Primary product goal:

- make holder profiles feel native on X
- show value publicly under live posts
- promote both the dashboard and the SDK through visible utility

Non-goals for v1:

- no admin/manual trigger flow
- no acknowledgement tweet
- no multi-step conversation with the user
- no posting full holder lists
- no analytics logic copied out of Sova Intel

---

## Product Contract

### User-facing behavior

The natural contract is:

1. Someone replies under a post and tags `@sova_intel`
2. `sova-x` detects the mention
3. `sova-x` extracts exactly one Solana mint from the mention text
4. If inference succeeds and the caller is authorized, `sova-x` runs holder profiles through Sova Intel
5. When the result is ready, `sova-x` posts one final reply in the same thread

No ack reply is posted.

### Invocation contract

V1 invocation is mention-only:

- required: mention of `@sova_intel`
- mint source: mention text
- explicit command syntax: not required; the caller includes the CA in the mention

Example:

- authorized user replies: `@sova_intel 9xQeWvG816bUx9EPfEZkLqN2YtY1YfB9F9r3uL6kP7z`
- bot eventually replies with the compact holder-profile summary

### Authorization contract

V1 does not answer everyone.

It answers only if the mention author is in an allowlist:

- initially one X account
- later 1-2 more accounts can be added

This matches the intended operational control without needing admin/manual tweet IDs.

### Duplicate behavior contract

If multiple mentions happen in the same thread for the same mint:

- first accepted invocation wins
- later duplicate invocations for the same `conversation_id + mint` are ignored for a cooldown window

This keeps the thread clean and avoids duplicate replies.

---

## Reply Contract

### Final reply only

There is no immediate acknowledgement.

This means the service must be robust enough that silent processing is acceptable. If processing fails, the default v1 behavior should be:

- do not post an error publicly
- mark the invocation failed internally

Optional future behavior:

- post a short failure reply for trusted operators only

### Twitter-sized output

The reply should contain only compact, high-signal holder-profile fields.

The default presentation should be visual-first:

- a generated PNG social card
- plus a very short text reply

The visual should contain only holder-profile-derived signals:

- trader distribution by behavior type, measured as `% supply held`
- `% fresh wallets`

Do not include:

- individual holder rows
- long explanations
- raw analytics jargon
- similarity/behavior-cluster output

### Why visual-first is preferred

The holder distribution is substantially clearer as a bar chart than as plain text.

For X specifically:

- a compact chart is easier to read at a glance
- an attached image is more shareable
- text can stay minimal and avoid character-pressure

ASCII output is not recommended for v1:

- weaker readability
- less polished presentation
- no advantage over a deterministic generated PNG

### Proposed v1 output shape

```text
Holder Profiles
Fresh supply: 9%
Powered by Sova Intel
```

If needed, tighten further:

```text
HP
Fresh: 9%
```

The image carries the actual distribution details.

### PNG social card contract

The default attachment should be a deterministic PNG social card, not a screenshot of the dashboard.

Recommended layout:

- token icon + symbol + mint/header area
- central distribution bar chart by supply %
- fresh supply callout
- subtle Sova Intel footer/branding

Recommended canvas:

- `1200 x 675` PNG

Recommended contents:

- Sova Intel badge/logo next to the Sova name
- token symbol
- token icon/image
- token mint, shortened
- short context line: `Holding patterns of top 20 holders`
- generated-at timestamp in UTC
- supply-weighted distribution bars
- exact % labels on the bars
- wallet counts on the bars
- fresh supply %
- `Sova Intel` footer

Do not include in v1:

- individual holder rows
- cluster/similarity score
- busy legends or long descriptions

### Deterministic render requirement

The card should be generated from structured data, not by loading the dashboard and taking a screenshot.

Reason:

- cheaper to render
- easier to keep stable
- fewer runtime dependencies
- consistent output across environments

Recommended rendering approaches:

- server-side SVG -> PNG
- or a simple canvas-based PNG renderer

Do not make headless-browser screenshots the default path in v1.

---

## Intelligence Contract With Sova Intel

### What `sova-x` consumes

`sova-x` should use the SDK, not the internal analyzer codebase.

Relevant existing contract in Sova Intel:

- `POST /intel/token/:mint/holders` queues holder profiles
- result is polled and fetched by the SDK
- `pollHolderProfiles(mint, topN?)` already exists in the SDK

That means the integration should be:

1. construct SDK client with API key
2. call `pollHolderProfiles(mint, topN)`
3. derive the compact X reply metrics from the returned `HolderProfilesResult`

### Top N contract

Use a fixed default `topN` in v1.

Recommended:

- `topN = 20`

Reason:

- still compact enough for social output
- aligns with the public intuition of “top holders”
- gives a more representative distribution chart

---

## Derived Metrics Contract

The final X reply needs compact aggregate metrics, not raw holder rows.

These should be computed in `sova-x` from the holder profiles result unless and until Sova Intel exposes them directly.

### 1. Distribution by behavior type

Definition:

- group analyzed profiles by normalized behavior label
- sum `supplyPercent` per behavior type

Output:

- top behavior buckets sorted by descending supply share
- usually only the top 3-4 buckets should be shown

Example:

- `Holder 31% | Swing 26% | Sniper 18% | New 9%`

### 2. Dominant cluster

Not included in v1 for `sova-x`.

Reason:

- frontend "behavior cluster" semantics are tied to similarity analysis, not just holder-profile distribution
- `sova-x` v1 should stay bounded to holder profiles only
- avoid a second analytical call in the first release

### 3. Fresh wallets %

Definition:

- sum `supplyPercent` for wallets considered "fresh/new"

Use existing semantics from holder profiles:

- wallets with `behaviorType === null` or normalized `New`
- optionally include data-quality-insufficient wallets if they are treated as new in the frontend language

Output example:

- `Fresh: 9%`

### Important note

The distribution is not currently stored as a single final field in the Intel response contract. It should be derived on the fly in `sova-x` for v1.

Longer-term improvement:

- add a dedicated summary block to Sova Intel / SDK so all clients reuse the same interpretation

### Alignment with current dashboard logic

The `sova-x` distribution renderer should mirror the existing holder-profiles dashboard semantics as closely as practical.

Observed in the current repo:

- the dashboard builds supply-weighted behavior buckets from holder profiles
- system wallets are excluded from the trader distribution
- `HODLER`/holder-only no-exit wallets are surfaced as `Fresh`

Relevant reference implementation:

- [TraderDistributionBar.tsx](C:\Users\Cicada38\Projects\analyzer\dashboard\src\components\holder-profiles\v2\TraderDistributionBar.tsx)
- [outcome-logic.ts](C:\Users\Cicada38\Projects\analyzer\dashboard\src\components\holder-profiles\v2\utils\outcome-logic.ts)

---

## Mint Extraction Contract

### Source of truth

V1 extracts the mint from the mention text.

### Resolution flow

1. Fetch the mention tweet
2. Extract candidate Solana addresses from the mention text
3. If exactly one candidate exists, treat it as the mint
4. If zero or multiple candidates exist, do not run

### V1 mint extraction rule

Use a strict Solana address regex and simple deterministic parsing.

Accept only if:

- exactly one valid-looking base58 address is found in the mention text

Do not attempt in v1:

- infer from the parent tweet
- symbol resolution
- OCR on images
- URL expansion scraping

### Why this strictness is correct

This is still natural enough for X usage, but it removes ambiguity and avoids the extra read/parse step for the parent tweet.

A false positive mint inference is much worse than a missed invocation.

---

## Token Metadata Contract

The social card should present the token cleanly, which means holder-profile output needs a small metadata layer.

Required token presentation fields:

- token symbol
- token icon/image if available
- fallback shortened mint

### Metadata sources

Preferred metadata lookup order:

1. Dexscreener-derived metadata
2. on-chain metadata
3. mint fallback only

### Why metadata belongs here

This is presentation data, not analytics.

It is acceptable for `sova-x` to fetch token symbol/icon independently as part of card rendering, provided it does not duplicate analytical holder logic.

### Failure behavior

If metadata lookup fails:

- still generate the card
- use shortened mint instead of symbol
- omit icon/image

The holder-profile reply must not fail purely because token metadata is unavailable.

---

## X API Contract

## Required X API capabilities

`sova-x` needs these capabilities:

- read mentions to `@sova_intel`
- create a reply tweet

### Recommended API surfaces

Use X API v2.

Use the current X docs as the source of truth:

- `https://docs.x.com/x-api/`
- not the legacy Twitter docs/migration pages unless needed for historical reference only

Required endpoint families:

- mention retrieval: `GET /2/users/:id/mentions`
- reply creation: `POST /2/tweets`

### Why polling mentions is the right v1 choice

For v1:

- simpler than webhooks/streaming
- easier to reason about
- enough for a controlled allowlisted bot
- current X docs expose a workable per-user rate limit for mentions polling

Polling loop:

- every 3-10 seconds is technically feasible within current rate limits
- fetch latest mentions since last seen mention ID
- process only unseen items

Current docs checked on March 16, 2026:

- `GET /2/users/:id/mentions` exists at `docs.x.com/x-api/users/get-mentions`
- X rate limits are documented separately from billing
- the rate-limit docs show per-endpoint 15-minute windows

Practical v1 implication:

- an aggressive mention listener is acceptable from a rate-limit perspective
- parent-tweet lookup is not needed in v1

### Reply creation contract

The final tweet must be created as a reply to the mention or thread target using the X reply metadata for `POST /2/tweets`.

The exact implementation detail is:

- reply into the same conversation
- authored by the appointed Sova account

---

## Rate Limits And Billing

The spec must follow the current X docs and keep rate limits separate from billing.

### Current docs to use

- rate limits: `https://docs.x.com/x-api/fundamentals/rate-limits`
- usage and billing / post cap: `https://docs.x.com/x-api/fundamentals/post-cap`

### Important distinction

These are two different constraints:

- rate limits control how often requests can be made
- billing/usage controls which successful responses count toward usage

For implementation, both must be modeled independently.

### What is safe to assume from the latest docs

- `GET /2/users/:id/mentions` has a documented per-user request rate limit
- `GET /2/tweets` and user mention timelines are tracked in the usage/billing docs
- `POST /2/tweets` is required for reply creation and must be treated as a separate cost/control surface

### Product implication

Two viable invocation modes exist:

#### Mode A: mention-only with mint in mention text

- mention polling required
- parent tweet lookup not required
- lower read usage
- deterministic parsing

Because current rate limits are generous enough for aggressive polling, this mode is viable from a request-limit perspective.

Billing/usage should be verified against the active app plan in the Developer Console before launch.

### V1 product choice

Keep the mention-only contract with explicit CA in the mention:

- mention-only invocation
- mint extracted from the mention text

---

## System Flow

### Happy path

1. Poll mentions for `@sova_intel`
2. Ignore mentions not authored by an allowlisted account
3. Ignore mentions already processed
4. Extract exactly one mint from mention text
6. Fetch token metadata for symbol/icon if available
7. Call Sova Intel SDK: `pollHolderProfiles(mint, 20)`
8. Compute:
   - distribution by behavior type
   - fresh wallet %
9. Render deterministic PNG social card
10. Format compact X reply text
11. Post reply under the thread with attached image
12. Persist processed state and reply tweet ID

### No-op paths

Ignore silently if:

- mention author is not allowlisted
- mention does not contain exactly one mint
- duplicate `conversation_id + mint` is already in progress or recently completed

### Failure paths

Persist failure internally if:

- X lookup fails
- token metadata lookup fails only if it blocks rendering entirely
- Intel request fails
- reply post fails

V1 should not post public failure messages.

---

## Data To Persist

Minimal durable state needed:

### 1. Bot account config

- target bot username
- target bot user ID

### 2. Allowed callers

- list of allowed X user IDs
- optional label/notes
- active flag

### 3. Mention processing state

- mention tweet ID
- mention author user ID
- conversation ID
- mention text snapshot
- inferred mint
- status: `pending | processing | completed | failed | ignored`
- ignore reason if ignored
- failure reason if failed
- created at
- updated at

### 4. Deduplication state

- key: `conversation_id + mint`
- last processed mention ID
- status
- cooldown expiry

### 5. Output state

- final reply tweet ID
- final reply text
- social card image metadata or asset reference
- holder profiles request metadata
- processing duration

### Why persistence matters

Without durable state:

- the bot can double-reply after restart
- mention polling offsets are fragile
- failures are impossible to audit

---

## Suggested Repository Scope

Initial repository contents:

- `SPEC.md` - this spec
- `README.md` - short project overview
- `src/app/` or `src/` service code later
- `src/x/` X client wrapper
- `src/intel/` Sova Intel SDK wrapper
- `src/metadata/` token symbol/icon lookup
- `src/core/` mention pipeline, parser, formatter, idempotency
- `src/render/` deterministic social-card generation
- `prisma/` or another simple persistence layer if a DB is used

Suggested implementation style:

- standalone service
- TypeScript
- no dependency on analyzer internals
- only HTTP/SDK dependency on Sova Intel

---

## Open Decisions

These are not blockers for the spec, but must be fixed before implementation:

### 1. Bot account choice

Need to decide whether:

- the replying account is `@sova_intel`
- or a separate dedicated bot account

Recommendation:

- use `@sova_intel` if the goal is product promotion and brand visibility

### 2. Parent tweet target

Need to confirm whether the final reply should be:

- reply to the mention tweet
- or reply directly into the same parent thread target

Recommendation:

- reply to the mention tweet for deterministic threading

### 3. Fresh wallet definition

Need to align exactly with holder-profiles frontend semantics.

V1 implementation can use:

- `behaviorType === null` or normalized `New`

### 4. Social card aesthetic

Need to lock:

- final dimensions
- typography
- whether to use token icon circle, token symbol, or both
- whether fresh supply is a badge or inline label

Recommendation:

- dark card
- bold supply bars
- Sova badge next to the Sova name
- short header with token icon + symbol
- fresh supply badge
- exact % and wallet counts rendered on bars
- top-20 holder context line
- UTC generated-at timestamp
- subtle footer

---

## Recommended V1 Decision Summary

- separate repository: yes
- separate service from analyzer: yes
- use SDK: yes
- use mention-only invocation: yes
- extract mint from mention text: yes
- no ack tweet: yes
- one final reply only: yes
- default response should include deterministic PNG social card: yes
- bound v1 strictly to holder profiles, not similarity: yes
- include token metadata for symbol/icon when available: yes
- allowlist callers: yes
- answer everyone: no
- use latest `docs.x.com` docs as source of truth: yes
- model rate limits separately from billing: yes
- keep explicit command mode as fallback: yes
