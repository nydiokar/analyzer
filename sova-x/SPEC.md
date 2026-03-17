# Sova X Spec

## Purpose

`sova-x` is a separate service that uses Sova Intel strictly as an intelligence layer.

It does not embed analytics logic. It accepts a human-triggered request containing:

- a target X post URL
- a Solana token mint

It then calls Sova Intel holder profiles through the SDK, computes the X-sized summary fields, and posts a single final reply in-thread from the appointed Sova account.

Primary product goal:

- make holder profiles feel native on X
- show value publicly under live posts
- promote both the dashboard and the SDK through visible utility

Non-goals for v1:

- no mention monitoring
- no always-on polling loop
- no autonomous bot behavior
- no acknowledgement tweet
- no multi-step conversation with the user
- no posting full holder lists
- no analytics logic copied out of Sova Intel

---

## Product Contract

### User-facing behavior

The v1 contract is human-triggered:

1. An operator decides a post is worth replying to
2. The operator opens an internal Sova page/tool
3. The operator submits:
   - the target X post URL
   - the token mint
4. `sova-x` runs holder profiles through Sova Intel
5. When the result is ready, `sova-x` posts one final reply under the target post

No ack reply is posted.

### Invocation contract

V1 invocation is manual and explicit:

- required: target X post URL
- required: token mint
- optional later: custom intro text or operator notes

Example request shape:

```json
{
  "tweetUrl": "https://x.com/someuser/status/1899999999999999999",
  "mint": "9xQeWvG816bUx9EPfEZkLqN2YtY1YfB9F9r3uL6kP7z"
}
```

### Authorization contract

V1 is internal-only.

Only trusted operators with access to the internal trigger page can submit jobs.

There is no public trigger surface on X in v1.

### Duplicate behavior contract

If multiple requests are submitted for the same target post + mint combination:

- first accepted request wins
- later duplicate requests for the same `target_tweet_id + mint` are ignored for a cooldown window

This keeps the thread clean and avoids duplicate replies.

---

## Reply Contract

### Final reply only

There is no immediate acknowledgement.

This means the service must be robust enough that silent processing is acceptable. If processing fails, the default v1 behavior should be:

- do not post an error publicly
- mark the invocation failed internally

Optional future behavior:

- expose failure state in the internal trigger UI
- allow an operator to retry manually

### X-sized output

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
- aligns with the public intuition of "top holders"
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

## Input Contract

### Source of truth

V1 takes the mint from explicit operator input, not from X content.

### Resolution flow

1. Receive target X post URL
2. Receive mint string
3. Validate the X post URL shape
4. Validate the mint shape
5. Extract the target tweet ID from the URL
6. If both are valid, run

### V1 mint validation rule

Use a strict Solana address regex and simple deterministic parsing.

Accept only if:

- exactly one valid-looking base58 address is provided in the request

Do not attempt in v1:

- infer from the target post
- symbol resolution from the X post text
- OCR on images
- URL expansion scraping

### Why this strictness is correct

The operator already knows the intended token.

A false positive mint inference is much worse than asking the operator to paste the mint explicitly.

### X post URL parsing contract

V1 should accept common X URL shapes:

- `https://x.com/<user>/status/<tweetId>`
- `https://twitter.com/<user>/status/<tweetId>`

Store and operate on the extracted `tweetId`.

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

## X Posting Contract

## Required X capabilities

`sova-x` needs only one X capability in v1:

- create a reply tweet

There is no read-side dependency on mentions or parent-tweet lookups in the primary flow.

### Recommended API surfaces

Use X API v2 for reply creation if feasible.

Use the current X docs as the source of truth:

- `https://docs.x.com/x-api/`

Required endpoint family:

- reply creation: `POST /2/tweets`

### Reply creation contract

The final tweet must be created as a reply to the target tweet ID using the X reply metadata for `POST /2/tweets`.

The exact implementation detail is:

- reply into the same conversation
- authored by the appointed Sova account
- attach PNG media when enabled

### Transport flexibility

The trigger model and the posting model are separate concerns.

That means v1 should preserve the same render/post pipeline regardless of whether the final posting transport is:

- official X API write path
- or a later fallback transport if needed

The primary change in this spec is the trigger method, not the post method.

---

## Rate Limits And Billing

The spec should minimize X read-side cost and operational risk by removing public-trigger polling from v1.

### Important distinction

These are different concerns:

- trigger cost
- posting cost
- operational account risk

### V1 product implication

By moving to an internal trigger page:

- no X read polling is needed
- no mention timeline consumption is needed
- no parent-tweet fetch is needed
- X cost is concentrated in the final post action only

### Product choice

V1 uses:

- internal manual trigger
- explicit mint input
- explicit target tweet URL input
- one reply post per operator request

---

## System Flow

### Happy path

1. Operator submits `tweetUrl + mint` in the internal trigger page
2. Validate input
3. Extract `targetTweetId`
4. Fetch token metadata for symbol/icon if available
5. Call Sova Intel SDK: `pollHolderProfiles(mint, 20)`
6. Compute:
   - distribution by behavior type
   - fresh wallet %
7. Render deterministic PNG social card
8. Format compact X reply text
9. Post reply under the target tweet with attached image
10. Persist request state and reply tweet ID

### No-op paths

Ignore or reject before work if:

- target tweet URL is invalid
- mint is invalid
- duplicate `target_tweet_id + mint` is already in progress or recently completed

### Failure paths

Persist failure internally if:

- target tweet ID cannot be parsed
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

### 2. Trigger request state

- request ID
- operator ID or label
- target tweet URL
- target tweet ID
- mint
- status: `pending | processing | completed | failed | ignored`
- failure reason if failed
- created at
- updated at

### 3. Deduplication state

- key: `target_tweet_id + mint`
- status
- cooldown expiry

### 4. Output state

- final reply tweet ID
- final reply text
- social card image metadata or asset reference
- holder profiles request metadata
- processing duration

### Why persistence matters

Without durable state:

- the service can double-reply after restart
- retries are impossible to reason about
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
- `src/core/` trigger pipeline, formatter, idempotency
- `src/render/` deterministic social-card generation
- `src/web/` or equivalent internal trigger UI later
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

### 2. Trigger UI shape

Need to confirm whether the internal trigger UI should be:

- a very small page inside this repo
- or a later integration into the main dashboard

Recommendation:

- start with a tiny page in this repo or a dead-simple internal form

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
- use internal manual trigger: yes
- require explicit mint input: yes
- require explicit target tweet URL: yes
- no X mention monitoring: yes
- no ack tweet: yes
- one final reply only: yes
- default response should include deterministic PNG social card: yes
- bound v1 strictly to holder profiles, not similarity: yes
- include token metadata for symbol/icon when available: yes
- answer everyone publicly on X: no
- minimize X read-side dependency: yes
- keep posting transport replaceable: yes
