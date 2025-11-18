# Holder Profiles v2 — 2-Day MVP UX Plan

**Status:** MVP UX/FE Implementation Plan  
**Scope:** 1–2 days of focused frontend work  
**Context:** Data model and backend are already wired; this is a presentation + interaction redesign.

---

## 1. Objectives

1. **Primary:**  
   - Let a trader answer in ≤3 seconds:
     - “Is this token still alive or already dead?”  
     - “Is this wallet worth following or just noise?”

2. **Secondary:**  
   - Modernize the UI (less table-centric, more visual).  
   - Reduce visible metrics to a small set of **cognitive primitives**:
     - **Speed** (how fast they move)  
     - **Conviction** (how aggressively they exit/flip)  
     - **Consistency** (how repeatable their pattern is)  

3. **Constraints:**  
   - No backend changes.  
   - No AI / LLM features.  
   - Keep tooltips minimal; labels should be mostly self-explanatory.  
   - Implementation feasible in 1–2 days of frontend work.

---

## 2. High-Level Page Layout

Single page, two blocks stacked top-to-bottom:

1. **Token Pulse (Top-N Holders)** — “Is this token alive?”  
2. **Wallet Classifier** — “Is this wallet followable?”

You can keep your current mode switching (Token / Wallet), or simply show both sections when relevant inputs are present.

---

## 3. Token Pulse — Top-N Holders

### 3.1. Inputs (Existing)

- **Token Mint** (text input)  
- **Top N** (number input, default 10)

### 3.2. Output Layout

Structure:

1. **Token Outcome Strip** (decision layer)
2. **Core Metrics Row** (Speed, Conviction, Consistency)
3. **Behavior Composition Bar** (visual replacement for “full table first”)
4. **Minimal Holders Table** (supporting detail)

#### 3.2.1. Token Outcome Strip

Topmost, full width, visually strong.

**Example copy (logic-driven, no AI):**

- “Outcome: **High churn, likely short-lived.** Top holders exit within minutes.”
- “Outcome: **Mixed behavior, token still has room.** Some fast flippers, some mid-term holders.”
- “Outcome: **Relatively stable.** Early holders are not dumping immediately.”

Derive this from thresholds on:

- Top-N median hold time  
- Top-N average flip ratio  
- Distribution of behavior types  

#### 3.2.2. Core Metrics Row (Cognitive Primitives)

Three compact cards, same height:

1. **Speed**  
   - Label: `Speed`  
   - Value: e.g. `Median 42s`  
   - Subtext: short discrete category:
     - “Ultra-fast”
     - “Fast”
     - “Intraday”
     - “Multi-day”
     - “Long-term”

2. **Conviction**  
   - Label: `Conviction`  
   - Value: e.g. `Flip 81%`  
   - Subtext:  
     - “Low conviction (frequent flips)”  
     - “Mixed conviction”  
     - “High conviction (rare flips)”

3. **Consistency**  
   - Label: `Consistency`  
   - Value: derived from variance / cycle count, but shown as a simple label:
     - “Chaotic”
     - “Moderate”
     - “Consistent”
   - Subtext: `Based on X holder profiles`

These three cards replace a cluster of raw metrics. Actual formulas stay internal; the UI exposes the primitives.

#### 3.2.3. Behavior Composition Bar

A single horizontal bar visualizing the **top-N behavior mix**.

- One row component, e.g. `BehaviorCompositionBar`.
- Data: counts of holders per behavior type (SNIPER, SCALPER, SWING, HOLDER, etc.).
- Render as stacked segments with labels on hover and a legend below.

Text below the bar:

- “Dominant: Snipers (9 of 10 holders)”  
- or “Mixed: 4 Snipers, 3 Swing, 3 Holders”

This is the quickest pattern recognition element; it should be close to the Token Outcome Strip.

#### 3.2.4. Minimal Holders Table (Support, Not Primary)

Under the composition bar, one simplified table:

Columns:

- Wallet  
- Behavior (with probabilistic badge)  
- Speed (median hold, formatted)  
- Flip %  
- Quality

No extra derived columns here.  
Keep row density high and avoid horizontal scroll.

---

## 4. Wallet Classifier — Single Wallet Focus

### 4.1. Input

- Single **wallet address** input (can reuse your existing input).

### 4.2. Layout

One main hero card, and optionally a small radar chart (if time allows).

Structure:

1. Header row (address + quality + probability badge)  
2. Behavior & probability  
3. Cognitive primitives row (Speed, Conviction, Consistency)  
4. Optional radar plot (compact, small)  
5. Outcome sentence

#### 4.2.1. Header Row

Left: truncated wallet + external link icon.  
Right: **Quality badge** (HIGH / MEDIUM / LOW / INSUFFICIENT).

#### 4.2.2. Probabilistic Behavior Badge

Replace simple behavior label with probabilistic version:

- `SNIPER (89%)`  
- `SCALPER (72%)`  
- Show secondary when relevant: “Secondary: Swing (11%)”

UI:

- A pill/badge with:
  - main label: primary behavior  
  - small “89%” text inside the badge  
- Optionally a tooltip with:
  - “SNIPER: <1m median hold, high flip frequency”

You already have a discrete behavior classification; this just surfaces confidence and secondary behavior.

#### 4.2.3. Cognitive Primitives Row (Wallet)

Three small cards, same pattern as Token Pulse but wallet-specific:

1. **Speed** — `Median hold 42s` + category text  
2. **Conviction** — `Flip 81%` + category text  
3. **Consistency** — `47 cycles, consistent pattern` or `Few cycles, low confidence`

This row is the main decision anchor for “follow / ignore”.

#### 4.2.4. Optional: Wallet Behavior Radar (If Time Allows)

Small radar chart with up to 4–5 axes, normalized 0–1:

- Speed (inverse of median hold time)  
- Conviction (flip ratio / exit aggressiveness)  
- Consistency (variance / cycles)  
- Size Impact (average position size relative to typical)  

The radar should be **compact**, not the hero; it acts as a *shape* to recognize pattern style.

If this is too heavy for 2 days, keep it as a stub for later.

#### 4.2.5. Outcome Sentence

Single line under the metrics:

Examples:

- “Outcome: Ultra-fast sniper. Not safe to follow for more than seconds.”  
- “Outcome: Mid-term swing wallet. Sometimes worth following across 1–3 days.”  
- “Outcome: Inconsistent pattern, low data quality. Do not rely on this wallet.”

This is deterministic logic: thresholds + if/else, no AI.

---

## 5. Visual Hierarchy & Style

### 5.1. Priority Hierarchy

1. Token Outcome Strip / Wallet Behavior + Probability  
2. Cognitive Primitives (Speed / Conviction / Consistency)  
3. Behavior Composition Bar (for tokens) / Radar (for wallet, if added)  
4. Minimal table / details

Tables are *supporting evidence*, not the main surface.

### 5.2. Style Guidelines (Reuse, Don’t Rewrite)

- Reuse your existing color scale per behavior type (SNIPER red, HOLDER green, etc.).  
- Keep gradients subtle; avoid heavy glassmorphism for this sprint.  
- Use `tabular-nums` for metrics.  
- Use consistent spacing between cards and sections (e.g. `gap-4` within sections, `gap-6` between sections).  
- Limit tooltips to:
  - behavior badge  
  - quality badge  
  - maybe one info icon on Speed / Conviction / Consistency row

If the text label is clear enough, do not add a tooltip.

---

## 6. Implementation Plan (2 Days)

### Day 1 — Token Pulse Refactor

1. **Create reusable primitives:**
   - `CognitiveMetricCard` (label + value + short label)  
   - `BehaviorBadgeProbabilistic`  
   - `QualityBadge` (if not already isolated)

2. **Token Pulse section:**
   - Implement Token Outcome Strip (header component).  
   - Implement three **Token-level** CognitiveMetricCard instances:
     - Speed  
     - Conviction  
     - Consistency  

3. **Behavior Composition Bar:**
   - Implement a stacked bar using your chart library (or simple div flex with width percentages).
   - Compute proportions from top-N profiles.

4. **Simplify holders table:**
   - Reduce to the minimal column set.  
   - Make sure it visually sits under the visuals, not above.

### Day 2 — Wallet Classifier + Polish

1. **Wallet Hero Card:**
   - Header with address + QualityBadge.  
   - Probabilistic behavior badge.  
   - Wallet-level CognitiveMetricCard row.  
   - Outcome sentence logic based on thresholds.

2. **Optional Radar:**
   - If time permits, integrate a simple radar chart with 3–5 normalized axes.
   - Otherwise, leave a placeholder section commented in the code for later.

3. **Consistent styling & responsive:**
   - Ensure both Token Pulse and Wallet Card look good on mobile (stacked).  
   - Check spacing and font sizes.  

4. **Minimal copy pass:**
   - Make sure labels (“Speed”, “Conviction”, “Consistency”) are present and readable.  
   - Outcome sentences are short and not jargon-heavy.

---

## 7. Data & Logic Mapping (Internal)

This section is internal; used to keep frontend naming consistent.

- **Speed**  
  - Derived from median hold time, optionally bucketed into categories.  
  - Use an internal helper: `getSpeedCategory(medianHoldSeconds) -> {label, color}`

- **Conviction**  
  - Derived from flip ratio (% of sub-5m exits, or similar).  
  - Helper: `getConvictionCategory(flipRatio)`

- **Consistency**  
  - Derived from cycle count and some stability measure (variance or a precomputed score).  
  - Helper: `getConsistencyCategory({cycleCount, varianceScore})`

- **Token Outcome**  
  - A small ruleset that combines:
    - Top-N median speed category  
    - Top-N conviction category  
    - Behavior composition dominance  

- **Wallet Outcome**  
  - Similar rule set, but per wallet, plus data quality tier.

All these helpers can live in a `holder-metrics-interpretation.ts` util.

---

## 8. Out-of-Scope for This MVP

Explicitly not in this 1–2 day sprint:

- AI summaries or natural-language long explanations.  
- Historical trend charts over days/weeks.  
- Cohort clustering / “similar wallets” visualizations.  
- Complex multi-wallet radar overlays.  
- Full redesign of all tables across the app.

These can plug into this layout later without breaking the mental model.

---

## 9. Success Criteria (For This MVP Only)

- A trader can:
  - Glance at Token Pulse and answer “alive/dead/mixed” in under 3 seconds.  
  - Glance at a wallet card and decide “follow/ignore” in under 3 seconds.  

- Frontend work fits in 1–2 days:
  - New components are mostly compositional (cards, bar, badges).  
  - No changes to APIs or data pipelines.  
  - No need for heavy documentation: labels mostly explain themselves.

