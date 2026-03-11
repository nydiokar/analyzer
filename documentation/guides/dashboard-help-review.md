# Dashboard Help Review

Purpose: keep your future review narrow and fast while the in-app Help center expands.

## What now exists

- Existing unauthenticated Help route was reused and expanded:
  - `dashboard/src/app/help/page.tsx`
  - `dashboard/src/app/help/[slug]/page.tsx`
- Shared docs content now lives in:
  - `dashboard/src/lib/help-docs.tsx`
- Shared docs UI now lives in:
  - `dashboard/src/components/help/`
- Changelog was preserved.
- Contextual docs links were added into the main feature pages.

## Covered features

- Discovery
- Tracked Wallets
- Similarity Lab
- Holder Profiles
- Wallet Hunt

## What I may still want from you later

1. Product-truth review
   - Are the one-line summaries exactly right?
   - Is any feature undersold or overstated?

2. Screenshots
   - Decide whether the next pass should add:
     - no screenshots
     - 1 screenshot per feature
     - only 2-3 highest-value screenshots total

3. Tone
   - Current tone is short, product-operational, and intentionally low-fluff.
   - If needed, mark sections that should sound more premium or more beginner-friendly.

4. Claims to avoid
   - Mark any sentence that feels too strong, too weak, or too uncertain.

## Recommended next steps

1. Keep the current docs structure.
2. Add screenshots only after structure and copy are stable.
3. Build `/intel` external docs as a separate system later.
