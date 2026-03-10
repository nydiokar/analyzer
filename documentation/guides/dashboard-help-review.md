# Dashboard Help Review

Purpose: keep user review narrow and fast while the Help page is being turned into real product docs.

## What was scaffolded

- Existing unauthenticated Help route was reused:
  - `dashboard/src/app/help/page.tsx`
- Changelog was preserved.
- The page now covers:
  - Discovery
  - Tracked Wallets
  - Similarity Lab
  - Holder Profiles
  - Wallet Hunt

## What I still need from you

Please review only these points:

1. Product truth
   - Is the one-line summary for each feature accurate enough for users?
   - Does any feature have a stronger "main job" than what is written?

2. Visibility of limits
   - Confirm that user-facing limits should stay visible:
     - tracked wallets: 300
     - similarity: 2-30 wallets
     - holder profiles token mode: top 1-50
     - wallet hunt: 5 hunts, 10 snapshots

3. Tone
   - Current tone is short and operational.
   - If needed, mark sections that should sound more premium / more direct / more beginner-friendly.

4. Screenshots
   - Decide whether the first version should ship:
     - without screenshots
     - with 1 screenshot per tool
     - with only 2-3 high-value screenshots total

5. Claims to avoid
   - Mark any phrasing that feels too strong, too salesy, or too uncertain.

## Recommended next steps

1. Approve the structure first.
2. Tighten copy second.
3. Add screenshots last.

## Notes

- This Help page is intentionally laconic so users will actually read it.
- External API docs for `/intel` should stay a separate documentation task.
