# Sova Intel .ai Contract

Shared working agreement tailored to the NestJS + BullMQ wallet analysis stack in this repo. Read these files before writing a line of code so you stay aligned with the scaling plan and the real system state.

---

## What Lives Here

```
.ai/
├── CONTEXT.md   # Live status, blockers, next steps
├── GUIDE.md     # Roadmap distilled from docs/1. scaling_plan.md and the code
├── HANDOFF.md   # Start/end session checklist
├── RULES.md     # Execution contract (do not edit without maintainer sign-off)
└── init-ai.sh   # Helper to refresh metadata fields in CONTEXT.md
```

All paths referenced here point to real code: `src/api/**`, `src/core/**`, `src/queues/**`, `dashboard/`, and `prisma/`.

---

## How to Use It

1. **Onboarding**: Read `CONTEXT.md`, `GUIDE.md`, and the relevant sections of `docs/1. scaling_plan.md`. Confirm the code paths mentioned actually exist.
2. **During work**: Keep `CONTEXT.md` accurate (progress, tests, blockers). Follow the tasks and references in `GUIDE.md`. When unsure, inspect the code rather than relying on scattered docs.
3. **Handoff**: Follow `HANDOFF.md` exactly—run the verification commands, note results, and summarize what is left.

When specs drift, update the guide after verifying against the implementation. Never change `RULES.md` unless the maintainer tells you to.

---

## Refreshing Metadata

Use the helper script if you need to reset the header fields in `CONTEXT.md`:

```bash
./.ai/init-ai.sh "Sova Intel - Wallet Analysis System" "Finish Scaling Plan Phase 6 with AI similarity reports" "In Progress"
```

The script only updates the header metadata (project, goal, status, timestamp, updated-by). It will not overwrite the rest of the file.

---

## Source of Truth

- Current priorities: `docs/1. scaling_plan.md`
- Prompt for the AI interpreter: `docs/behavioral_reconstruction_task.md`
- Queue behaviour: `src/queues/**`
- Analysis math (P/L, KPI, dashboard aggregates): `src/core/analysis/**`, `docs/usage/wallet-behavior-kpis.md`, `analysis_reports/`
- Similarity engine: `src/core/analysis/similarity/`
- Persistence layer: `prisma/schema.prisma`

Check the code, confirm behaviour with CLI/API calls, and then document reality here.
