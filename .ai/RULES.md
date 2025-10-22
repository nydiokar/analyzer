# Agent Rules

Universal execution contract for AI agents.

---

## 1. Context Management

- **Read** `.ai/CONTEXT.md` at session start
- **Update** `.ai/CONTEXT.md` after completing each task
- **Never modify** `.ai/RULES.md` or `.ai/GUIDE.md`
- **Commit** context updates regularly

---

## 2. Execution Protocol

### Sequential Work
- Complete one task fully before starting next
- Don't skip steps without approval
- Validate work before moving on

### Approval Required
**Ask before**:
- Deleting files or directories
- Force pushing to git
- Running system-wide installations
- Modifying CI/CD pipelines
- Changing dependencies without testing

**Proceed without asking**:
- Creating new files as documented
- Running tests
- Standard build/compile operations
- Updating documentation

---

## 3. Code Quality

### Standards
- Follow existing code style in project
- Run linters before committing (if available)
- Write tests for new functionality (if project has tests)
- Keep changes minimal and focused

### Language-Specific
- **Python**: Type hints, follow PEP 8
- **JavaScript/TypeScript**: ESLint rules, strict mode
- **Rust**: cargo fmt, cargo clippy
- **Shell**: shellcheck compliance, `set -e`

---

## 4. Documentation

### Update As You Go
- Document decisions in `.ai/CONTEXT.md`
- Update README if adding features
- Add comments for non-obvious code
- Keep docs in sync with code

### When Unsure
- Check existing documentation first
- Review similar code in project
- Ask user for clarification
- Don't invent patterns

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

## 6. Version Control

### Commit Messages
```
type(scope): brief description

- Detail 1
- Detail 2
```

**Types**: feat, fix, docs, style, refactor, test, chore

### Frequency
- Commit after each complete task
- Before ending session
- When switching focus areas

---

## 7. Session Handoff

### Before Ending
1. Update `.ai/CONTEXT.md` with progress
2. Mark completed tasks
3. Note next task
4. Document any blockers
5. Update timestamp and agent name
6. Commit changes

### Starting New Session
1. Read `.ai/CONTEXT.md`
2. Continue from last incomplete task
3. Update "Updated By" field

---

## 8. Testing

- Run existing tests before committing
- Add tests for new features (if project has test suite)
- Verify functionality manually
- Document test results in CONTEXT.md

---

## 9. Communication

### Status Updates
Be clear about:
- What was completed
- What's next
- Any issues encountered
- Decisions made

### Asking Questions
Provide context:
- What you're trying to do
- What you've tried
- What the options are
- Your recommendation

---

## 10. Scope

### In Scope
- Tasks listed in `.ai/GUIDE.md`
- Bug fixes related to current work
- Documentation updates
- Test improvements

### Out of Scope
- Major architecture changes (ask first)
- Adding features not in guide (ask first)
- Changing tech stack (ask first)
- Performance optimizations (unless requested)

---

**Golden Rule**: Make minimal, focused changes. Update context frequently. Ask when uncertain.
