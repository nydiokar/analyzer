# Sova Intel — Five-Agent Dissemination System Manifest

**Version:** 1.0
**Date:** 2026-03-18
**Purpose:** Architecture reference and verification document for the Sova Intel multi-agent GTM system.

---

## 1. System Architecture Overview

```
                        ┌─────────────────────────┐
                        │   sova-playbook-manager  │
                        │   (Orchestrator/CoS)     │
                        │   model: opus            │
                        └────────────┬────────────┘
                                     │ reads PROGRESS.md
                    ┌────────────────┼────────────────┐
                    │                │                 │
          ┌─────────▼──────┐  ┌──────▼───────┐  ┌────▼──────────────┐
          │technical-content│  │   social-    │  │  integration-     │
          │    -writer      │  │content-gener │  │   engineer        │
          │  model: sonnet  │  │model: sonnet │  │  model: opus      │
          └─────────────────┘  └──────────────┘  └───────────────────┘
                    │                │                 │
                    └────────────────┼─────────────────┘
                                     │
                        ┌────────────▼────────────┐
                        │   outreach-researcher    │
                        │   model: haiku           │
                        └─────────────────────────┘

All agents read/write: .claude/agent-progress/PROGRESS.md  (shared log)
Each agent reads/writes: .claude/agent-memory/<agent-name>/MEMORY.md  (persistent memory)
Outreach researcher also maintains: .claude/agent-progress/outreach-targets.md
```

---

## 2. Agent Definitions

### 2.1 Manager Agent — `sova-playbook-manager`

| Field | Value |
|-------|-------|
| **Model** | claude-opus-4-6 |
| **File** | `.claude/agents/sova-playbook-manager.md` |
| **Memory** | `.claude/agent-memory/sova-playbook-manager/` (project scope) |
| **Color** | Red |

**Role:** Chief of Staff. Tracks the 30-day GTM playbook, reads the shared progress log cold at every session start, identifies what's done vs. overdue, dispatches the right specialist for each task, verifies outputs against the weekly scorecard, and flags decision points at days 14/21/30.

**Tools:** `Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch`

**Input schema:**
```json
{
  "type": "session_start" | "task_request" | "status_check" | "verification_request",
  "context": "optional additional context from founder",
  "day": "optional: current day of 30-day plan"
}
```

**Output schema:**
```json
{
  "current_status": "summary of where the plan stands",
  "overdue_items": ["list of tasks behind schedule"],
  "todays_priorities": [
    {
      "priority": 1,
      "task": "task description",
      "delegate_to": "agent-name | founder",
      "rationale": "why this agent / why now"
    }
  ],
  "blockers": ["list of active blockers"],
  "decision_points": ["any day 14/21/30 checkpoints approaching or triggered"]
}
```

**Routing logic:**

```
GIVEN a campaign objective or task request:

IF task_type == "integration_guide" OR "api_tutorial" OR "comparison_page" OR "x_thread_draft":
  → dispatch to: technical-content-writer
  → input: { content_type, topic, target_audience, playbook_week }

IF task_type == "daily_tweet" OR "weekly_thread" OR "engagement_response":
  → dispatch to: social-content-generator
  → input: { content_type, data_available, trending_context }

IF task_type == "mcp_server" OR "framework_integration" OR "demo_agent" OR "code_snippet":
  → dispatch to: integration-engineer
  → input: { target_framework, integration_type, spec_requirements }

IF task_type == "prospect_research" OR "directory_listing" OR "rug_investigator_list":
  → dispatch to: outreach-researcher
  → input: { research_type, target_segment, count_needed }

IF task_type == "campaign_package" (full end-to-end):
  → dispatch to ALL FOUR specialists in sequence or parallel
  → aggregate outputs into unified campaign package
  → log all completions to PROGRESS.md

AFTER any dispatch:
  → verify output exists and meets quality standard
  → append to PROGRESS.md
  → update own MEMORY.md with session notes
```

---

### 2.2 Technical Content Writer — `technical-content-writer`

| Field | Value |
|-------|-------|
| **Model** | claude-sonnet-4-6 |
| **File** | `.claude/agents/technical-content-writer.md` |
| **Memory** | `.claude/agent-memory/technical-content-writer/` (project scope) |
| **Color** | Blue |

**Role:** Produces integration guides, API tutorials, comparison pages, and X thread drafts for developer audiences. Every piece doubles as marketing — leads with the problem, not the feature.

**Tools:** `Read, Write, Glob, Grep, WebSearch, WebFetch`
*(No Edit/Bash — drafts only, no code execution, founder publishes)*

**Input schema:**
```json
{
  "content_type": "integration_guide" | "x_thread" | "comparison_page" | "api_tutorial",
  "topic": "e.g. 'Add wallet intelligence to Telegram bot'",
  "target_audience": "e.g. 'Solana Telegram bot developers'",
  "playbook_week": "W1" | "W2" | "W3" | "W4",
  "api_data": "optional: real Sova API response to include as example"
}
```

**Output schema:**
```json
{
  "content_type": "integration_guide",
  "title": "string",
  "file_path": ".claude/drafts/guides/<slug>.md",
  "word_count": 1200,
  "has_working_code": true,
  "cta_present": true,
  "review_status": "DRAFT — awaiting founder review"
}
```

**Output formats:**
- Integration guides: markdown, 800–1500 words, TypeScript code blocks, curl fallback
- X threads: 8–12 tweets, ≤280 chars each, `[IMAGE: ...]` placeholders, no emojis
- Comparison pages: side-by-side JSON output, minimal editorializing

---

### 2.3 Social Content Generator — `social-content-generator`

| Field | Value |
|-------|-------|
| **Model** | claude-sonnet-4-6 |
| **File** | `.claude/agents/social-content-generator.md` |
| **Memory** | `.claude/agent-memory/social-content-generator/` (project scope) |
| **Color** | Yellow |

**Role:** Produces 1–2 daily @Sova_intel post drafts using real Sova Intel API data on trending Solana wallets and tokens. Maintains the CT voice — direct, data-driven, slightly irreverent.

**Tools:** `Read, Write, Glob, Grep, WebSearch, WebFetch`
*(No Edit/Bash — drafts only)*

**Input schema:**
```json
{
  "content_type": "token_holder_breakdown" | "wallet_spotlight" | "similarity_check" | "educational",
  "sova_data": "optional: pre-fetched API result",
  "trending_context": "optional: token/wallet/event to feature",
  "batch_size": 2
}
```

**Output schema:**
```json
{
  "drafts": [
    {
      "type": "standalone_tweet" | "thread",
      "tweet_count": 1,
      "content": "tweet text here",
      "image_placeholder": "[IMAGE: description]",
      "character_count": 241,
      "cashtags": ["$SOL", "$TICKER"],
      "review_status": "DRAFT"
    }
  ],
  "file_path": ".claude/drafts/social/<date>-drafts.md"
}
```

**Content rotation:**
1. Token holder breakdown (trending token → behavioral distribution)
2. Wallet spotlight (notable wallet → HUD profile)
3. Similarity check (suspicious wallet group → pairwise score)
4. Educational (explain one behavioral type with real example)

---

### 2.4 Integration Engineer — `integration-engineer`

| Field | Value |
|-------|-------|
| **Model** | claude-opus-4-6 |
| **File** | `.claude/agents/integration-engineer.md` |
| **Memory** | `.claude/agent-memory/integration-engineer/` (project scope) |
| **Color** | Purple |

**Role:** Builds and maintains Sova Intel framework integrations and the demo agent. Writes production-quality TypeScript and Python that other developers will fork.

**Tools:** `Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch`
*(Full tools — needs Bash to test code)*

**Input schema:**
```json
{
  "integration_type": "mcp_server" | "elizaos_plugin" | "langchain_tool" | "vercel_ai_sdk" | "crewai_tool" | "demo_agent",
  "target_framework": "string",
  "language": "typescript" | "python",
  "spec_notes": "optional additional requirements"
}
```

**Output schema:**
```json
{
  "integration_type": "mcp_server",
  "language": "typescript",
  "file_paths": ["src/index.ts", "README.md", ".env.example"],
  "tools_exposed": ["get_wallet_profile", "get_wallet_hud", "batch_wallet_hud", "get_token_holders", "analyze_wallet_similarity"],
  "async_polling_handled": true,
  "has_readme": true,
  "has_env_example": true,
  "review_status": "READY FOR REVIEW — do not publish until approved"
}
```

**Priority build order:**
1. MCP Server (TypeScript) — works with Claude, ChatGPT, any MCP client
2. ElizaOS Plugin (TypeScript)
3. Langchain Tool (Python)
4. Demo Agent (TypeScript) — monitors tokens, profiles holders, posts summary
5. Vercel AI SDK Tool / CrewAI Tool (stretch)

**Critical implementation requirement:** All async endpoints (`/holders`, `/similarity`) must implement the `pollJob()` pattern. Sync endpoints that return 202 on timeout must handle `X-Prepaid-Job-Id` resume. This is non-negotiable.

---

### 2.5 Outreach Researcher — `outreach-researcher`

| Field | Value |
|-------|-------|
| **Model** | claude-haiku-4-5 |
| **File** | `.claude/agents/outreach-researcher.md` |
| **Memory** | `.claude/agent-memory/outreach-researcher/` (project scope) |
| **Color** | Orange |

**Role:** Researches and qualifies Solana developers, CT rug investigators, and directory listing opportunities. Produces structured, actionable prospect lists. The founder sends every DM — this agent only does the legwork.

**Tools:** `Read, Write, Glob, Grep, WebSearch, WebFetch`
*(Read-only + Write for saving lists — no code execution)*

**Input schema:**
```json
{
  "research_type": "developer_targets" | "rug_investigators" | "directory_listings",
  "target_segment": "e.g. 'Solana Telegram bot builders'",
  "count": 20,
  "exclude_handles": ["handles already researched"]
}
```

**Output schema:**
```json
{
  "research_type": "developer_targets",
  "count_produced": 20,
  "file_path": ".claude/agent-progress/outreach-targets.md",
  "targets": [
    {
      "handle": "@example",
      "platform": "X + GitHub",
      "building": "Solana copy-trade Telegram bot",
      "why_sova_fits": "behavioral type on copied wallet = better signal quality",
      "audience_size": "~2K followers",
      "status": "PENDING",
      "notes": "Active GitHub commits, DMs likely open"
    }
  ]
}
```

---

## 3. Inter-Agent Communication Protocol

All agents communicate via **file-based structured logging**, not direct API calls between agents. This makes the system inspectable, resumable, and robust across sessions.

### 3.1 Shared Progress Log

**File:** `.claude/agent-progress/PROGRESS.md`
**Written by:** All agents after task completion
**Read by:** `sova-playbook-manager` at every session start

Append format:
```
| {YYYY-MM-DD} | {W#D#} | {task description} | {agent-name} | {output path or URL} |
```

### 3.2 Agent Memory Files

**Path pattern:** `.claude/agent-memory/<agent-name>/MEMORY.md`
**Written by:** Each agent, updating its own memory
**Read by:** Each agent at own session start; manager reads all for status verification

Content: running notes on decisions made, style calibration, what's in progress, known issues.

### 3.3 Outreach State File

**File:** `.claude/agent-progress/outreach-targets.md`
**Written by:** `outreach-researcher` (adds targets), founder (updates status as DMs sent/responded)
**Read by:** `sova-playbook-manager` (for DM outreach progress tracking)

---

## 4. Campaign Package Assembly (End-to-End Flow)

When the Manager receives a campaign brief like:
> *"Generate outreach package for Solana agent builder communities"*

It dispatches as follows:

```
Step 1 → outreach-researcher
  Input:  { research_type: "developer_targets", target_segment: "Solana agent builders", count: 10 }
  Output: Prioritized target list in outreach-targets.md

Step 2 → technical-content-writer  (can run parallel with Step 1)
  Input:  { content_type: "integration_guide", topic: "MCP server for Sova Intel", target_audience: "AI agent developers" }
  Output: Draft guide at .claude/drafts/guides/mcp-server-guide.md

Step 3 → social-content-generator  (can run parallel with Step 1)
  Input:  { content_type: "educational", trending_context: "agent builders discovering Sova Intel x402 + skill.md" }
  Output: 2 tweet drafts at .claude/drafts/social/{date}-agent-builder-drafts.md

Step 4 → integration-engineer
  Input:  { integration_type: "mcp_server", language: "typescript" }
  Output: MCP server code + README

Step 5 → sova-playbook-manager (aggregation)
  Reads all four outputs
  Assembles unified campaign package:
    - Target list (who to reach)
    - Integration guide (what to send them)
    - Social content (what to post)
    - Code integration (what they can build with it)
  Appends all completions to PROGRESS.md
  Updates own MEMORY.md
```

**Assembled campaign package output:**
```
campaign-package-{date}/
  ├── outreach-targets.md       (who: 10 qualified developer targets)
  ├── integration-guide.md      (what: technical content to share)
  ├── social-drafts.md          (amplification: X posts for the launch)
  ├── mcp-server/               (product: working integration code)
  │   ├── src/index.ts
  │   └── README.md
  └── campaign-summary.md       (manager's assembled overview)
```

---

## 5. File Structure

```
.claude/
├── agents/
│   ├── sova-playbook-manager.md
│   ├── technical-content-writer.md
│   ├── social-content-generator.md
│   ├── integration-engineer.md
│   └── outreach-researcher.md
├── agent-progress/
│   ├── PROGRESS.md              ← shared task log (all agents write here)
│   └── outreach-targets.md      ← prospect CRM (outreach-researcher maintains)
└── agent-memory/
    ├── sova-playbook-manager/
    │   └── MEMORY.md
    ├── technical-content-writer/
    │   └── MEMORY.md
    ├── social-content-generator/
    │   └── MEMORY.md
    ├── integration-engineer/
    │   └── MEMORY.md
    └── outreach-researcher/
        └── MEMORY.md
```

---

## 6. Quality Gates

Before the Manager marks any task complete in PROGRESS.md:

| Agent | Verification check |
|-------|--------------------|
| technical-content-writer | Draft file exists, has working code block, has CTA, word count 800–1500 |
| social-content-generator | Draft file exists, each tweet ≤280 chars, has IMAGE placeholder, no financial advice language |
| integration-engineer | Code file exists, README exists, async polling handled, no hardcoded keys |
| outreach-researcher | Target list has ≥N entries, each has handle + building + why_sova_fits + status field |

---

## 7. What Requires Human Action (Cannot Be Delegated)

| Task | Reason |
|------|--------|
| Publishing content | Brand voice, final approval |
| Sending DMs | Founder credibility is the asset |
| Publishing to npm/PyPI/GitHub | Code review before public release |
| Strategic pivots (day 14/21/30 decisions) | Judgment calls requiring business context |
| Updating real-time API metrics | Agents don't have dashboard access |

---

## 8. Campaign Package Routing Clarification

For `campaign_package` work, the manager should not treat all four specialists as fully independent.

- Keep independent work parallel only where there is no cross-output dependency.
- `outreach-researcher` can run in parallel with `integration-engineer`.
- If the package includes a technical deliverable, `technical-content-writer` must receive `integration-engineer.output.summary` and relevant output paths before drafting or finalizing the guide.
- `social-content-generator` must receive `integration-engineer.output.summary` and, when available, `technical-content-writer.output.summary` before drafting the final social copy.
- The manager's aggregation step is also a consistency gate: if social or guide drafts no longer match the shipped technical artifact, reroute them for one alignment pass before marking the package complete.

Preferred order for code-backed campaign packages:

1. `outreach-researcher` and `integration-engineer` in parallel
2. `technical-content-writer` using the integration summary
3. `social-content-generator` using the integration summary and guide summary
4. `sova-playbook-manager` final aggregation and verification
