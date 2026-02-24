# Agent Prompt — Log Level Refactor + Signal Review

## Context

This is a NestJS backend (`sova-backend-api`) for a Solana wallet analysis service. The logging is too noisy at INFO — a 20-wallet job produces 900+ INFO lines where 40 would suffice. An audit has already been done. Your job is two things: apply the changes, then assess whether what remains is actually enough.

---

## Step 1 — Apply the verdicts

Read `.ai/context/log_audit/INFO_VERDICT.md`. It contains a table of every INFO-level log call with a verdict: KEEP, DEBUG, or REMOVE.

**Rules:**
- `DEBUG` verdict → change `logger.info(` to `logger.debug(` or `this.logger.log(` to `this.logger.debug(`
- `REMOVE` verdict → delete the full logger statement (entire line or multi-line call)
- `KEEP` verdict → do not touch
- Do not change any DEBUG, WARN, or ERROR calls
- Do not touch anything else in the files

Locate each line by the message content shown in the verdict table (not just line number — numbers may have drifted). Files are under `src/`.

---

## Step 2 — After the changes, answer honestly: do we see enough?

Read the golden reference at the bottom of `.ai/context/log_audit/IMPLEMENTATION_PLAN.md` — that's what INFO should look like after. Now consider the full backend lifecycle and answer:

**For each major job type (holder-profiles, dashboard analysis, similarity, enrichment):**
- From INFO alone, can an operator answer: what ran, for which wallet/token, did it succeed or fail, how long did it take?
- Is there any failure mode that would now be **invisible** at INFO — i.e. something goes wrong silently and the only evidence is in DEBUG?
- Are there any KEEP lines that fire so rarely they add no value, or so frequently they still create noise?

**Specific things to check:**
- If a wallet sync fails mid-job, does that surface at INFO or only at DEBUG/ERROR?
- If the entire holder-profiles job fails after processing 15/20 wallets, does the completion log show `1 failed` or does it vanish entirely?
- If enrichment is skipped (cached), does INFO show that or is it silent?
- Is behavior analysis completion visible anywhere at INFO, or did we remove too much?

Write your assessment as a short section at the bottom of `IMPLEMENTATION_PLAN.md` under `## Signal check after Phase 1`. Be direct — if something is missing, say what log line needs to be added or promoted back to INFO and why.

---

## Working directory

Repo root. Backend source is in `src/`. The verdict file is at `.ai/context/log_audit/INFO_VERDICT.md`.
