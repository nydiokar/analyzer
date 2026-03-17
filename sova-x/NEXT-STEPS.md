# Sova X Next Steps

This file is the implementation backlog for `sova-x` only.

It intentionally excludes concerns that belong to the main analyzer backend, such as token metadata caching or holder-profile result caching.

## Decision Snapshot

- Primary mode: operator-only mention polling on X
- Fallback mode: manual trigger UI
- Reply target: the operator's trigger tweet
- Mint source in primary mode: explicit mint inside the mention text
- Mint source in fallback mode: explicit form input
- Cost rule: all returned mentions may count toward X usage before local filtering
- Safety rule: only configured allowed operator X user IDs may trigger replies
- Spend control: enforce a hard monthly spend cap in X Developer Console

## Vector 1: Manual Trigger Production Readiness

- Mount the existing manual trigger flow behind main dashboard login instead of serving it only as a local standalone page.
- Restrict manual mode to trusted internal users only.
- Persist manual trigger runs, statuses, reply tweet IDs, errors, and timestamps.
- Add a basic run history view for manual mode.
- Keep preview-first behavior and require explicit confirmation before posting.
- Keep duplicate protection on `target_tweet_id + mint`.
- Add retry for failed manual runs.
- Add text-only fallback if media upload fails but plain reply posting is still possible.
- Improve operator-facing errors for:
  - analyzer unavailable
  - X auth failure
  - reply restriction on the target conversation
  - invalid tweet URL
  - invalid mint
- Make manual mode deployable as a server route with no localhost-only assumptions.

## Vector 2: Mention Polling Production Path

- Replace the current mention test script with a real polling worker/service.
- Persist `last_seen_mention_id` durably.
- Poll `GET /2/users/:id/mentions` using `since_id`.
- Keep author expansions and username fields in the mentions request.
- Filter returned mentions locally to `X_ALLOWED_CALLER_IDS`.
- Ignore self-mentions unless they are intentionally allowed.
- Parse exactly one mint from mention text.
- Reply to the trigger tweet itself.
- Persist processed mention state.
- Persist ignored reasons:
  - unauthorized author
  - invalid mint
  - duplicate
  - self-mention
- Persist failure reasons for reply or analysis failures.
- Add safe retry/backoff for transient X or analyzer failures.
- Add a hard kill switch to stop polling without code changes.
- Add a dry-run mode that reads and classifies mentions without replying.

## Vector 3: Shared Bot Pipeline

- Keep one shared pipeline for:
  - trigger validation
  - mint validation
  - Intel call
  - metadata fetch
  - summary text generation
  - image render
  - reply post
- Keep one shared posting service for reply creation and media upload.
- Keep one shared persistence model for:
  - trigger mode
  - trigger tweet ID
  - mint
  - status
  - posted reply ID
  - error details
- Keep one shared dedupe/idempotency layer.
- Add structured logs with:
  - run ID
  - mode
  - mint
  - trigger tweet ID
  - reply tweet ID

## Vector 4: Cost And Safety Controls

- Expose counts for:
  - mentions read
  - mentions ignored
  - valid operator triggers
  - replies posted
- Add a visible config note or admin surface documenting the X spend cap requirement.
- Stop work before the Intel call for unauthorized mentions.
- Keep parent-tweet reads disabled unless a real product need appears.
- Add alerting/logging when mention volume jumps unexpectedly.

## Vector 5: Operational Protections

- Add a global disable flag for posting.
- Add a preview-only mode for production safety.
- Add replay tooling for:
  - one mention trigger
  - one manual trigger run
- Capture and persist X API error bodies for debugging.
- Handle reply-restricted conversations gracefully and mark them failed without infinite retry.

## Recommended Implementation Order

1. Productionize manual mode behind dashboard auth.
2. Add persistence, run history, retries, and posting fallbacks.
3. Extract the shared trigger/render/post pipeline cleanly.
4. Implement the real mention polling worker with durable `since_id`.
5. Add kill switch, preview-only mode, and dry-run mode.
6. Add usage counters and operational logging.

## Explicit Non-Goals For This Backlog

Do not expand this file with tasks that belong to the main analyzer backend, including:

- token metadata caching
- holder-profile result caching
- core analyzer performance work unrelated to `sova-x`
- generic dashboard refactors unrelated to mounting the bot UI
