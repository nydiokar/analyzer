# Session Handoff Protocol

---

## Starting a Session

### First Visit
```
Read .ai/CONTEXT.md and .ai/GUIDE.md, then skim docs/1. scaling_plan.md to confirm priorities. Spin up local .env (HELIUS_API_KEY, Redis), run `npx prisma migrate status`, and ensure Redis + queues are reachable.
```

### Continuing Work
```
Open .ai/CONTEXT.md, confirm the Active task, inspect referenced files (controller -> service -> core), and run `git status` to verify a clean working tree before resuming.
```

---

## Ending a Session

1. **Update CONTEXT.md**
   - Mark completed subtasks, refresh Active/Next sections, capture blockers with reproduction steps.
   - Record tests or manual checks (API calls, CLI runs, queue observations).
   - Stamp timestamp and your handle.

2. **Verify Work**
   ```bash
   npm run verify
   npm run test:unit            # add npm run test:integration or CLI flows when relevant
   npm run analyze -- --address <WALLET> --period week   # confirm dashboard analysis numbers remain sane
   ```
   Document any failures, skipped suites, or manual validation in CONTEXT.md.

3. **Commit (if applicable)**
   ```bash
   git add <changed files>
   git commit -m "type(scope): brief summary"
   ```

4. **Summarize for the next agent**
   - Deliverables shipped (with file paths or endpoints)
   - Pending actions or open questions
   - Runtime state that matters (queues running, background workers, env changes)
   - Notes on analysis math validation or discrepancies uncovered

---

## Handoff Expectations

**Outgoing**
- Finish the current subtask or clearly state why it is paused.
- Point to the exact code paths you touched (e.g., `src/api/controllers/analyses.controller.ts`).
- Mention observability checks performed (job status, logs, Redis metrics).

**Incoming**
- Confirm migrations are up to date: `npx prisma migrate status`.
- Re-run key tests or CLI commands for the area you are touching.
- Update `.ai/CONTEXT.md` with your name and timestamp once you take over.

---

## Recovery Playbook

If the context feels off:
1. `git status` and `git diff --stat` to see outstanding changes.
2. Review recent commits: `git log --oneline -5`.
3. Check queue health via `GET /api/v1/jobs/queue/<queue>/stats` or logs in `logs/`.
4. Verify `.env` vs `.env.example`, restart Redis/PM2 if needed.
5. Align `.ai/CONTEXT.md` with actual repo state or raise the inconsistency.

---

Keep `.ai/CONTEXT.md` honest, run the core verification commands before leaving, and note anything non-obvious directly in the handoff summary.
