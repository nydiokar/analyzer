# AGENT_13 — Thesis Gate (read-only, :5434, 2026-07-14)

The load-bearing measurements run BEFORE building the D2 scorer / D3 typology, so the
build rests on proven ground rather than the owner doc's assumption. Script:
`scripts/spec-agent13-thesis-gate.ts` (read-only). Reproducible on :5434.

## Base rate (does a "skilled" verdict even have a population?)
`WalletCapitalVector`: 64,271 total · **dataQuality > 0.9 = 51,380 (80%)** · >0.8 = 52,271 ·
>0.5 = 56,171 · mean dq 0.890 · median dq 1.000.
→ The high-dq population is LARGE, not a curiosity. AGENT_14 §3c "tiny population" worry does
NOT apply to the scorer/typology. Verdict framing is honest for ~80% of wallets.

## The load-bearing number — behavior↔capital correlation
Sample: 390 high-dq seeds (10 skipped for thin neighborhoods), k=20, dq>0.9 both sides.
- **corr(behavior-nbhd realizedPnl, capital-nbhd realizedPnl) = 0.425** → MODERATE-LOW.
  The two lenses are related but far from redundant. **The two-vector thesis holds** — the
  capital vector adds distinct signal. (Had this been ~0.9, D2/D3 would rest on a false
  premise and the honest move would be to stop. It does not.)
- **median neighbor-set overlap (Jaccard) = 0.0** → behavior-kNN and capital-kNN point at
  almost entirely DIFFERENT wallets. The combined query (D1) is a real intersection of two
  different sets. Confirms combine method must be intersection / rank-fusion, NEVER
  cosine-averaging (the two distance spaces don't co-rank).

## Outcome-by-analogy premise (the D2 scorer's foundation)
Seeds split by their capital-neighborhood profitable fraction:
- rich capital nbhd (top 20%): **seed win rate 1.00**
- poor capital nbhd (bottom 20%): **seed win rate 0.00**
- population baseline: **0.39**
→ A rich capital neighborhood tracks a profitable seed; a poor one tracks a loser, vs a 39%
base rate. Finding 1 reproduced independently. Outcome-by-analogy WORKS at the tails.

## Caveats carried into the build
- 1.00 / 0.00 are TAIL buckets. The D2 scorer must report the full gradient + a confidence
  interval + n neighbors + dq, NOT a binary label — over-promising on the tails is the trap.
- `realizedPnl` (SOL) is itself dq-sensitive; the dq>0.9 gate is applied throughout for this
  reason. Never present transfer-distorted PnL as skill.

## Gate verdict: GREEN — proceed to D2 (scorer) → D1 (combined query) → D3 (2×2).
