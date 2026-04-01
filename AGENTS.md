# Goal: correct code changes with minimal disruption, verified against the repo, Windows-only execution.

## 0) HARD CONSTRAINTS (SAFETY / BEHAVIOR)
- NEVER run destructive commands or make destructive changes without explicit user confirmation.
- NEVER use `--force` in any command. You may suggest it, but must not run it.
- NEVER assume. VERIFY AGAINST THE CODEBASE. If unsure, ASK CLARIFYING QUESTIONS.
- Be proactive like an engineer/app developer. Do not act passively.
- DON'T frenzy-create summary documents. 
 
## 1) MANDATORY WORKFLOW STEPS (OpenProse-like order; NOT enforced, MUST be followed)
For ANY task, follow this sequence:

STEP 1 — BOOT
- Read `.ai/CONTEXT.md` from repo root FIRST.
- Summarize key points before starting work:
  - project purpose
  - structure / key folders
  - setup / scripts
  - conventions/patterns to follow

STEP 2 — SCOPE / MAP
- Identify likely files/modules involved.
- Reason over file structure and state what must be parsed/read before taking action.
- Read the relevant files before proposing changes.

STEP 3 — CURRENT BEHAVIOR
- Describe current behavior from what was observed in code (not guesses).

STEP 4 — ROOT CAUSE
- Identify root cause before implementing any fix.

STEP 5 — MINIMAL PLAN
- Propose minimal change plan in small, verifiable steps.
- If minimal changes are not possible, explain why and request approval before larger changes.

STEP 6 — IMPLEMENT (IN INCREMENTS)
- Implement step-by-step (small increments).
- Preserve existing structure/formatting.
- Avoid unrelated improvements.

STEP 7 — VERIFY
- Prefer TDD: write tests first when feasible.
- If tests-first is not feasible, verify technical correctness explicitly (project-appropriate checks).
- Keep verification tied to the minimal step(s) just changed.

STEP 8 — DB / ARCH INTEGRATION CHECK
- Ensure new work fits existing project architecture/patterns (e.g., existing WebSocket/Socket.IO, Bull queues, useJobProgress).
- Do not introduce generic patterns that conflict with the repo.
- Before implementing, ask: can this be served from an existing projection layer, or am I accidentally introducing a second serving model?
- Before coding and before finalizing, explicitly re-evaluate: minimality, layer ownership, and migration/backfill cost.

## 2) CODE CHANGE RULES (ALL LANGUAGES)
- DO NOT create a class unless necessary. Prefer functional programming (FP). OOP allowed only in rare cases.
- Minimal changes only:
  - modify only what’s necessary for the task
  - focus on the specific task; avoid unrelated improvements
  - preserve existing code structure and formatting
  - make changes in small, verifiable steps
  - choose solutions that require minimal code changes
  - if larger changes are required: state why minimal change is impossible and ask for approval
- Follow:
  - TDD (tests first when feasible; otherwise explicit technical verification)
  - DRY (avoid duplication; extract reusable components when justified)
  - KISS (prefer simple solutions)
  - YAGNI (don’t implement unnecessary functionality)
  - Big-O awareness (choose optimal approaches)
  - Lazy evaluation when it reduces unnecessary work

## 3) PYTHON RULES
- Use strict types for variables where practical.
- Annotate function return types: `-> ...`.
- Use Pydantic models for data structures (not TypedDict or similar alternatives).
- Avoid `Any` when possible.
- Do not use `@staticmethod`.
- Prefer FP over OOP when possible.
- Use `pyproject.toml` (not `requirements.txt`).
- When introducing a variable, annotate type when practical:
  - example: `scopes: list[str] = [...]`

## 4) OTHER LANGUAGES RULES
- Use strict types.
- Use clean functions:
  - no hidden changes
  - no in-place changes
- Follow all linter rules.
- Follow best practices ONLY insofar as they match the repo’s established conventions.

## 5) LIBRARIES / DEPENDENCIES
- Install Python packages in the repo virtual environment, not system-wide.
- Do not install libraries ad-hoc as the primary method (avoid one-off `pip install` as the plan).
- Add dependencies to project configuration (`pyproject.toml`) and use the project install workflow.
- Prefer editable install with dev extras when applicable:
  - `pip install -e ".[dev]"`
- Prefer reading library source code locally rather than googling:
  - `pip show <package>`
  - locate installed source via the reported Location and inspect it

## 6) TERMINAL / COMMAND RULES (WINDOWS ONLY)
- Windows only. PowerShell commands only.
- Start ALL terminal command sequences with `pwd` as a separate call.
- If the task depends on current date (filenames/behavior), run `date` as a separate call before proceeding.
- If pnpm is available, use it instead of npm.
- Example PowerShell style:
  - `npm install ttkbootstrap pydantic openai`

## 6.1) CANONICAL DB ACCESS (DO NOT REDISCOVER)
- PostgreSQL investigations go through Docker.
- Canonical container: `analyzer-postgres`
- Canonical application DB: `sova_analyzer`
- Canonical read-only command shape:
  - `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "<SQL>"`
- Minimal connectivity check:
  - `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "SELECT current_database(), current_user;"`
- Baseline size check:
  - `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "SELECT pg_size_pretty(pg_database_size('sova_analyzer')), pg_database_size('sova_analyzer');"`
- Runtime sanity before DB work:
  - `pm2 status`
  - `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'`
- Do not investigate app tables against the default `postgres` DB unless you are explicitly listing databases.
- For “ghost token” / missing-wallet-token investigations, check in this order:
  - `SwapAnalysisInput` -> token mapped at ingest
  - `AnalysisResult` -> token survived aggregation/API source table
  - `TokenLot` -> FIFO lots exist
  - `HolderProfileSnapshot` / `SignificantBuyersCache` -> downstream caches/views include it

## 7) USER PREFERENCES (OPERATIONAL)
- Confirm before destructive commands/changes.
- Minimal logging only; add logs only when essential.
- Root-cause-first before fixes.
- Be proactive; reason over file structures; do not make chaotic changes.
- Avoid DB inefficiencies:
  - Never introduce N+1 query patterns.
  - Prefer batched operations (Prisma createMany/updateMany/transactions/bulk ops).
  - Tailor implementations to existing architecture patterns (WebSocket/Socket.IO, Bull, useJobProgress).
  - Investigate existing patterns before proposing changes.

## 8) ARCHITECTURE & SIGNAL DISCIPLINE
- **Re-check constraints before and after implementation.** Before coding and before finalizing, explicitly re-evaluate:
  - minimality — is this the smallest change that satisfies the requirement?
  - layer ownership — does this data/logic belong in this layer?
  - migration/backfill cost — what does adding this field/path require to maintain?
- **Keep signal surfaces lean.** HUD is a high-signal surface — it must stay lean. Richer analytics belong in persisted projections or fuller profile/behavior surfaces, not in the HUD.
- **Prefer existing projections over new paths.** When a new requirement appears, first ask:
  - can this be served from the repo's existing projection layer?
  - or am I accidentally introducing a second serving model?
