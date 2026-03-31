# Execution Protocol

Universal execution contract for AI agents working on Sova Intel.

---

## 1. Context Management

- **Read** `.ai/CONTEXT.md` at session start
- **Update** `.ai/CONTEXT.md` after completing each task
- **Never modify** `.ai/RULES.md` or `.ai/GUIDE.md` without maintainer approval
- **Commit** context updates regularly

---

## 2. Session Protocol

### Starting a Session

**First Visit:**
```
1. Read .ai/CONTEXT.md and .ai/GUIDE.md
2. Skim .ai/context/ for task-specific context
3. Verify environment: git status, npm run verify
```

**Continuing Work:**
```
1. Open .ai/CONTEXT.md, confirm Active task
2. Inspect referenced files (controller → service → core)
3. Run git status to verify clean working tree
4. Update "Updated By" field with timestamp
```

### Ending a Session

1. **Update CONTEXT.md**
   - Mark completed subtasks, refresh Active/Next sections
   - Document blockers with reproduction steps
   - Record tests or manual checks performed
   - Stamp timestamp and your handle

2. **Update CHANGELOG.md** (for user-facing changes)
   - Add completed features/fixes under `[Unreleased]` section using appropriate category (Added/Changed/Fixed/Removed)
   - For version releases, use `./scripts/release.sh [patch|minor|major]` or update manually following SemVer

3. **Verify Work**
   ```bash
   npm run verify
   npm run test:unit
   npm run analyze -- --address <WALLET> --period week   # confirm math remains sane (optional)
   ```

4. **Commit** (if applicable)
   ```bash
   git add <changed files>
   git commit -m "type(scope): brief summary"
   ```
   **Types**:
   | Type | Icon | Use for |
   |------|------|---------|
   | `feat` | ✨ | New feature or capability |
   | `fix` | 🐛 | Bug fix |
   | `docs` | 📝 | Documentation only |
   | `style` | 🎨 | Formatting, no logic change |
   | `refactor` | ♻️ | Code restructure, no feature/fix |
   | `test` | 🧪 | Adding or updating tests |
   | `chore` | 🔧 | Build, deps, config, tooling |

5. **Summarize for Next Session**
   - Deliverables shipped (file paths or endpoints)
   - Pending actions or open questions
   - Runtime state (queues running, env changes)
   - Analysis math validation results

### Recovery Playbook

If context feels off:
1. `git status` and `git diff --stat` to see outstanding changes
2. Review recent commits: `git log --oneline -5`
3. Check queue health: `GET /api/v1/jobs/queue/<queue>/stats` or logs in `logs/`
4. Align `.ai/CONTEXT.md` with actual repo state or raise the inconsistency

---

## 3. Execution Protocol

### Sequential Work
- Complete one task fully before starting next
- Validate work before moving on
- Don't skip steps without approval

### Approval Required For
- Deleting files or directories
- Force pushing to git
- Running system-wide installations
- Modifying CI/CD pipelines
- Changing dependencies without testing

### Proceed Without Asking
- Creating new files as documented
- Running tests
- Standard build/compile operations
- Updating documentation

---

## 4. Code Quality

### Standards
- Follow existing code style in project
- Run linters before committing
- Write tests for new functionality (if project has tests)
- Keep changes minimal and focused

### Language-Specific
- **TypeScript**: ESLint rules, strict mode, type safety
- **Python**: Type hints, PEP 8
- **Shell**: shellcheck compliance, `set -e`

---

## 4a. Project Structure — Non-Negotiable

**Before creating any new service, check where existing services live and mirror that pattern exactly.**

### Established structure

| Layer | Location | Pattern |
|:------|:---------|:--------|
| NestJS services | `src/api/services/*.service.ts` | `@Injectable()` class, receives deps via constructor DI |
| NestJS modules | `src/api/modules/*.module.ts` | `@Module({ imports, providers, exports })` |
| Core/standalone logic | `src/core/services/*.ts` | Plain classes/functions, no NestJS decorators, used by scripts + services |
| Queue processors | `src/queues/processors/*.processor.ts` | `@Injectable()`, injects NestJS services |
| Queue job types | `src/queues/jobs/types/index.ts` | Interface + result type per job name |
| Queue dispatch | `src/queues/queues/*.queue.ts` | One `add*()` method per job type |

### Rules

1. **Never create a new top-level directory under `src/`** (`src/services/`, `src/helpers/new-thing/`, etc.). Place the code in the correct existing layer.
2. **Never import the raw `prisma` singleton into a NestJS processor or module** unless the pattern already exists in that file. Use `DatabaseService` injection instead.
3. **New services must be `@Injectable()`**, registered in a module, and imported by the modules that use them — not called as plain functions with a passed-in `PrismaClient`.
4. **Before writing a new service**, check if `TokenInfoService`, `DatabaseService`, `HeliusApiClient`, or another existing service already provides what you need. Reuse — do not duplicate.
5. **Standalone scripts** (`scripts/*.ts`) may use the exported `prisma` singleton from `database-service.ts` directly. This is the only acceptable place for it outside `core/`.

### Reference implementation

`src/api/services/token-info.service.ts` + `src/api/integrations/token-info.module.ts` is the canonical example of how a new service should be structured. When in doubt, open that file and follow it.

---

## 5. Error Handling

### When Stuck
1. Re-read `.ai/GUIDE.md` for reference
2. Check `.ai/CONTEXT.md` for prior work
3. Review project documentation
4. Ask user (don't guess)

### Failures
- Document in `.ai/CONTEXT.md` as blocker
- Include error messages
- Note what was attempted
- Suggest potential solutions

---

## 6. Testing

- Run existing tests before committing
- Add tests for new features (if project has test suite)
- Verify functionality manually
- Document test results in CONTEXT.md

---

## 7. Scope

### In Scope
- Tasks listed in `.ai/GUIDE.md`
- Bug fixes related to current work
- Documentation updates
- Test improvements

### Out of Scope (Ask First)
- Major architecture changes
- Adding features not in guide
- Changing tech stack
- Performance optimizations (unless requested)

---

**Golden Rule**: Make minimal, focused changes. Update context frequently. Ask when uncertain.
