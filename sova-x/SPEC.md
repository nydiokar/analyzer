# Sova X Spec

## Purpose

`sova-x` is a separate service that uses Sova Intel strictly as an intelligence layer.

It does not embed analytics logic. It supports two trigger modes:

- primary mode: operator-only mentions on X with the mint included in the mention text
- fallback mode: a human-triggered internal request containing a trigger tweet URL and mint

In both modes, it calls Sova Intel holder profiles through the SDK, computes the X-sized summary fields, and posts a single final reply in-thread from the appointed Sova account.

Primary product goal:

- make holder profiles feel native on X
- show value publicly under live posts
- promote both the dashboard and the SDK through visible utility

Non-goals for v1:

- no acknowledgement tweet
- no multi-step conversation with the user
- no posting full holder lists
- no analytics logic copied out of Sova Intel

---

## Product Contract

### User-facing behavior

The primary v1 contract is operator-triggered on X:

1. A trusted operator replies on X and tags `@sova_intel`
2. The operator includes exactly one mint in the mention text
3. `sova-x` polls the mentions timeline
4. `sova-x` filters mentions locally to trusted operator IDs
5. If the mention passes validation, `sova-x` runs holder profiles through Sova Intel
6. When the result is ready, `sova-x` posts one final reply under the operator's trigger tweet

Fallback contract:

1. An operator opens an internal Sova page/tool
2. The operator submits:
   - the trigger tweet URL
   - the token mint
3. `sova-x` runs holder profiles through Sova Intel
4. When the result is ready, `sova-x` posts one final reply under that trigger tweet

No ack reply is posted.

### Invocation contract

Primary mode invocation is mention-based and explicit:

- required: mention of `@sova_intel`
- required: exactly one mint in the mention text
- processing allowed only if `authorId` is in the configured allowlist

Fallback invocation is manual and explicit:

- required: trigger tweet URL
- required: token mint
- optional later: custom intro text or operator notes

Example fallback request shape:

```json
{
  "tweetUrl": "https://x.com/someuser/status/1899999999999999999",
  "mint": "9xQeWvG816bUx9EPfEZkLqN2YtY1YfB9F9r3uL6kP7z"
}
```

### Authorization contract

Primary mode is operator-only, even though any X user may mention the account.

Only mentions authored by trusted operator X user IDs may trigger analysis and reply posting.

Fallback mode is internal-only.

Only trusted operators with access to the internal trigger page can submit fallback jobs.

### Duplicate behavior contract

If multiple trigger attempts are submitted for the same target post + mint combination:

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

Primary mode takes the mint from the operator mention text.

Fallback mode takes the mint from explicit operator input.

### Resolution flow

Primary mode:

1. Read returned mentions from `GET /2/users/:id/mentions`
2. Filter locally to allowed operator IDs
3. Extract candidate Solana addresses from the mention text
4. Accept only if exactly one candidate exists
5. Reply to that trigger tweet

Fallback mode:

1. Receive trigger tweet URL
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

- infer from the parent/target post
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

Primary mode requires:

- read mentions to `@sova_intel`
- create a reply tweet

Fallback mode requires:

- create a reply tweet

### Recommended API surfaces

Use X API v2 for reply creation if feasible.

Use the current X docs as the source of truth:

- `https://docs.x.com/x-api/`

Required endpoint families:

- mention retrieval: `GET /2/users/:id/mentions`
- reply creation: `POST /2/tweets`

### Reply creation contract

The final tweet must be created as a reply to the trigger tweet ID using the X reply metadata for `POST /2/tweets`.

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

Primary mode intentionally accepts X read-side cost in exchange for native in-thread distribution and lower operator friction.

### Important distinction

These are different concerns:

- trigger cost
- posting cost
- operational account risk

### Important limitation

The mentions timeline cannot be filtered at the X API level down to only trusted operators.

That means:

- `sova-x` reads all mentions returned by the mentions endpoint
- filtering to allowed operators happens locally after the read
- all returned mentions may still count toward X usage

### Product implication

Primary mode economics:

- any returned mention can consume X read usage
- only allowed operators can trigger analysis/reply behavior
- random mentions are treated as marketing/impression cost
- spend risk is bounded with an X Developer Console hard monthly spend cap

Fallback mode economics:

- no mention polling needed
- no mention timeline consumption needed
- X cost is concentrated in the final post action only

### Product choice

V1 uses:

- primary mode: operator-only mention polling with explicit mint-in-mention parsing
- fallback mode: internal manual trigger
- one final reply post per accepted operator trigger

---

## System Flow

### Happy path

Primary mode:

1. Poll mentions for `@sova_intel` with `since_id`
2. Read all returned mentions
3. Ignore mentions whose `authorId` is not in the allowlist
4. Ignore mentions that do not contain exactly one mint
5. Use the mention tweet as the reply target
6. Fetch token metadata for symbol/icon if available
7. Call Sova Intel SDK: `pollHolderProfiles(mint, 20)`
8. Compute:
   - distribution by behavior type
   - fresh wallet %
9. Render deterministic PNG social card
10. Format compact X reply text
11. Post reply under the trigger tweet with attached image
12. Persist request state and reply tweet ID

Fallback mode:

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
9. Post reply under the trigger tweet with attached image
10. Persist request state and reply tweet ID

### No-op paths

Ignore or reject before work if:

- trigger tweet URL is invalid
- mint is invalid
- duplicate `target_tweet_id + mint` is already in progress or recently completed
- mention author is not allowlisted

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
- trigger tweet URL
- target tweet ID
- mint
- trigger mode: `mention | manual`
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

- remain as a small page inside this repo for fallback mode
- or be mounted into the main dashboard behind existing login

Recommendation:

- mount fallback mode into the main dashboard behind existing login when operationally convenient

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
- use operator-only mention polling as primary mode: yes
- require explicit mint-in-mention parsing in primary mode: yes
- use internal manual trigger as Plan B: yes
- require explicit target tweet URL in Plan B: yes
- no ack tweet: yes
- one final reply only: yes
- default response should include deterministic PNG social card: yes
- bound v1 strictly to holder profiles, not similarity: yes
- include token metadata for symbol/icon when available: yes
- answer everyone publicly on X: no
- process only allowed operator X user IDs: yes
- accept that mention reads are billed before local filtering: yes
- enforce hard monthly spend cap in X Developer Console: yes
- keep posting transport replaceable: yes
