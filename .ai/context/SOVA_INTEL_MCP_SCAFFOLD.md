# Sova Intel MCP Scaffold

## Index

This document defines:

- what the Sova Intel MCP is
- what belongs in MCP vs Skill vs plugins
- the V1 tool surface
- auth, async, and output behavior
- package structure and extraction rules
- the minimum verification bar

Sections:

- `Purpose`
- `Repo Fit`
- `Product Definition`
- `Locked Decisions`
- `Surface Boundaries`
- `V1 Tool Surface`
- `Output Contract`
- `Auth and Startup`
- `Implementation Shape`
- `Async, Errors, Availability`
- `Verification`
- `Extraction`

## Purpose

Build a real product MCP for Sova Intel:

- not a raw endpoint mirror
- not a generic paid fetch wrapper
- not coupled to private backend internals
- built here against the real product, then extractable into a public repo

## Repo Fit

Observed in this repo:

- the product API already exists
- the SDK already handles auth, polling, and GET timeout fallback
- the product already has an agent-facing `SKILL.md`

Therefore the MCP should sit on top of the public API and `@sova-intel/sdk`, not on top of private service imports.

## Product Definition

The Sova Intel MCP is a single installable MCP server that exposes the highest-value Sova Intel workflows as tools.

Its job is to let an agent ask:

- what is this wallet like?
- what kind of holder base does this token have?
- are these wallets coordinated?
- what is the cheapest useful signal?

The MCP should hide:

- API key vs x402 auth
- GET timeout fallback
- async polling and result fetching
- resumable queued workflows

The MCP should return:

- a short factual summary
- the raw structured result
- stable metadata

## Locked Decisions

These are the product decisions to treat as fixed unless there is a strong reason to revisit them.

### Product shape

- The MCP is an agent product layer, not an API mirror.
- The default unit of value is the answer, not the transport.
- The MCP is one server, not "product MCP + payment MCP".

### Tool strategy

- Start cheap and high-signal.
- `wallet_hud` is the default wallet entrypoint.
- `token_holder_profiles` is the default token entrypoint.
- `wallet_similarity` is the default coordination entrypoint.
- `deep_token_analysis` exists, but is not the default first move.

### Output strategy

- Summary first, raw data second.
- No fabricated certainty.
- No silent auto-upgrade from cheap tools to expensive tools.
- Surface cost where it changes the next best action.

### State strategy

- No durable local cache in V1.
- In-memory in-flight dedupe is acceptable.
- No local DB, file cache, or secondary state system in V1.

### Scope exclusions

Keep out of V1:

- generic fetch tools
- unrelated write/mutate actions
- speculative recommendation engines
- backend-internal imports

## Surface Boundaries

Sova Intel should scale across surfaces by keeping a clear stack:

1. API
2. SDK
3. MCP
4. Skill
5. framework plugin

### API

Owns:

- endpoints
- auth/payment contracts
- async job contracts
- result schemas
- pricing

### SDK

Owns:

- typed client access
- auth wiring
- x402/API key support
- polling
- GET timeout fallback

### MCP

Owns:

- tools
- resources
- prompts (scoped — see below)
- MCP output envelopes
- summaries
- capability detection
- limited-mode behavior

Rule:

- MCP is executable capability, not agent identity

### Skill

Owns:

- when to use which tool
- escalation logic
- cost-aware usage guidance
- interpretation guardrails

Rule:

- Skill is usage policy, not execution

### Plugin

Examples:

- ElizaOS
- OpenServ/OpenClaw
- Hermes

Owns:

- framework registration
- framework-native config loading
- runtime wiring
- memory/lifecycle adaptation if needed

Rule:

- plugin is an adapter, not an alternate product definition

### MCP vs Skill

Belongs in MCP:

- `wallet_hud`
- `wallet_profile`
- `token_holder_profiles`
- `wallet_similarity`
- `job_wait`
- auth resolution
- polling
- result normalization

Belongs in Skill:

- use `wallet_hud` first
- escalate to `wallet_profile` when needed
- use deep analysis only when holder composition and coordination are both needed
- mention data quality and avoid overclaiming

### MCP vs Plugin

Preferred truth order:

1. API contract
2. SDK semantics
3. MCP tool surface
4. Skill routing policy
5. plugin mappings

A plugin should either wrap the MCP or wrap the SDK directly while honoring the same product semantics.

## V1 Tool Surface

### Core tools

`wallet_hud`
- fastest, cheapest wallet signal (1cr)
- SDK method: `client.getWalletHud(walletAddress)`
- sync, SDK handles GET timeout fallback internally

`wallet_profile`
- full wallet intelligence (5cr)
- SDK method: `client.getWalletProfile(walletAddress)`
- sync, SDK handles GET timeout fallback internally

`token_holder_profiles`
- top-holder behavioral intelligence — agent-optimised result (20cr)
- SDK method: `client.pollTokenHoldersAgent(tokenMint, topN?)`
- uses `/intel/token/:mint/holders/agent` — compact agent shape, ~10× smaller than full shape
- do NOT use `pollHolderProfiles()` — that calls the non-agent endpoint and returns the verbose developer shape
- `wait=true` by default; returns queued envelope on timeout

`wallet_similarity`
- coordination analysis for 2–30 wallets — agent-optimised result (20cr)
- SDK method: `client.pollWalletSimilarityAgent(wallets)`
- uses `/intel/wallets/similarity/agent` — returns `coordinationScore`, filtered pairs, and flags
- do NOT use `pollSimilarity()` — that calls the non-agent endpoint and returns the verbose developer shape
- `wait=true` by default; returns queued envelope on timeout

### Support tools

`wallet_token_pnl`
- per-token breakdown for a wallet (3cr)
- SDK method: `client.getWalletTokens(walletAddress, params?)`

`batch_wallet_hud`
- batch scan/ranking support, up to 30 wallets (5cr flat)
- SDK method: `client.batchHud(wallets)`

`deep_token_analysis`
- holder profiles + similarity in one call, 35cr
- SDK method: `client.pollDeepAnalysis(tokenMint, topN?)`
- returns full developer shapes (not agent-optimised) — note this in summary
- not the default token starting tool

`job_status`
- inspect a queued job by jobId
- SDK: direct `GET /jobs/:jobId` via HttpClient

`job_wait`
- standard resume path for any queued work
- polls jobId to completion, then fetches result by resultKey/agentResultKey
- standard resume tool referenced in every queued envelope

### Resources

`sova://pricing`
- live endpoint costs fetched from `GET /pricing` (free, no auth)
- do not bake static pricing into the resource; always fetch live
- the SKILL.md accompanying the MCP is also live and authoritative

`sova://skill`
- current machine-readable product skill
- fetched live from the published SKILL.md URL or embedded at build time with a staleness note

`sova://help/auth`
- concise setup and auth help for API key and x402 modes

### Prompts

Prompts are excluded from V1 scope. The intent — nudging the agent toward correct result interpretation — is valid, but client adoption is patchy and the risk of prompts adding noise outweighs the benefit at this stage.

Prompts are tracked for a future release. When added they should be thin routing hints only:

- `analyze_wallet` → routes to `wallet_hud`, escalates to `wallet_profile` when needed
- `analyze_token_holders` → routes to `token_holder_profiles`
- `check_coordination` → routes to `wallet_similarity`

Prompts must not embed product logic. They should read like: "use `wallet_hud` first, escalate only if the agent needs full behavior detail."

## Output Contract

Every tool should return the same top-level shape:

```json
{
  "ok": true,
  "tool": "wallet_hud",
  "mode": "completed",
  "summary": "Swing-trader profile, above-average win rate, GOLD data quality.",
  "data": {},
  "job": null,
  "meta": {
    "source": "sova-intel-api",
    "authMode": "apikey"
  }
}
```

Rules:

- summary is factual and concise
- raw result is preserved under `data`
- `meta.authMode` is always present
- queued responses use `mode: "queued"`

Queued responses should include:

- `jobId`
- `monitoringUrl` when available
- `resumeTool: "job_wait"`
- `resultType`
- `resultKey` or `agentResultKey` when known — prefer `agentResultKey` for agent-endpoint tools
- the original primary input

## Auth and Startup

The MCP should support:

- `apikey`
- `x402`
- `auto`

### Auth rules

`apikey`
- only needs `SOVA_API_KEY`
- no wallet required

`x402`
- needs Solana signing config
- payment remains internal to the MCP

`auto`
- prefer API key when present
- otherwise use x402 when wallet config exists
- otherwise start in limited mode

### Startup rules

Start in full mode when:

- explicit mode has valid config
- or `auto` has either API key or wallet config

Start in limited mode when:

- `auto` is selected
- no paid auth is configured

Limited mode should still expose:

- `sova://pricing`
- `sova://skill`
- `sova://help/auth`

Fail fast when:

- `apikey` is selected but key is missing
- `x402` is selected but wallet config is invalid

### Config surface

All config via environment variables. No `.mcp.json` in the package — the package is installed globally and wired into the agent's MCP client config, not run from the repo.

Required envs:

```text
SOVA_API_KEY=ak_your_key          # for apikey mode
SOLANA_PRIVATE_KEY=               # for x402 mode (base58 keypair)
```

Optional envs with defaults:

```text
SOVA_BASE_URL=https://api.sova-intel.com/api/v1
SOVA_AUTH_MODE=auto
SOVA_WAIT_TIMEOUT_MS=45000
SOVA_DEEP_WAIT_TIMEOUT_MS=45000
SOVA_POLL_INTERVAL_MS=5000
SOVA_MAX_POLL_ATTEMPTS=9
```

Wait timeouts are capped at 45s. MCP has a hard ~60s per-call timeout at the transport layer; all in-process waiting must complete well within that window. When a job has not completed within `SOVA_WAIT_TIMEOUT_MS`, the tool does not throw — it returns a queued envelope with `resumeTool: "job_wait"` so the agent can resume in a subsequent call. `SOVA_MAX_POLL_ATTEMPTS` defaults to 9 (9 × 5s = 45s).

### Client installation

The MCP server is installed globally via npm/npx and wired into the agent client's config. Each client uses a slightly different config file:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "sova-intel-mcp"],
      "env": {
        "SOVA_API_KEY": "ak_your_key"
      }
    }
  }
}
```

**Claude Code** (project-level `.mcp.json` at repo root):

```json
{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "sova-intel-mcp"],
      "env": {
        "SOVA_API_KEY": "ak_your_key"
      }
    }
  }
}
```

Both forms are identical in content. The README must show both.

### Transport

stdio. The server is started as a subprocess by the MCP client. This is the standard for npm-distributed MCP servers and is what Claude Desktop, Claude Code, Cursor, and all major clients expect for `npx`-style servers.

Streamable HTTP is the correct transport for a hosted/remote deployment but is out of scope for V1.

## Implementation Shape

Build in this repo first as:

- `packages/sova-intel-mcp`

Minimal structure:

```text
packages/sova-intel-mcp/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    server.ts
    config.ts
    client/
      create-sova-client.ts
    auth/
      api-key-auth.ts
      x402-auth.ts
      resolve-auth-mode.ts
    core/
      result.ts
      errors.ts
      polling.ts
      summary.ts
      availability.ts
    tools/
      wallet-hud.ts
      wallet-profile.ts
      wallet-token-pnl.ts
      batch-wallet-hud.ts
      token-holder-profiles.ts
      wallet-similarity.ts
      deep-token-analysis.ts
      job-status.ts
      job-wait.ts
    resources/
      pricing.ts
      skill.ts
      auth-help.ts
```

No `prompts/` directory in V1.

Layering rules:

- tools are thin
- auth is isolated
- tool handlers are auth-agnostic
- no imports from private backend internals

`package.json` must include:

```json
{
  "type": "module",
  "main": "dist/index.js",
  "exports": { ".": "./dist/index.js" },
  "bin": { "sova-intel-mcp": "dist/index.js" }
}
```

The `bin` entry is required. It is how `npx sova-intel-mcp` and `npx -y sova-intel-mcp` resolve the entrypoint.

Dependencies: `@modelcontextprotocol/sdk`, `zod`, `@sova-intel/sdk` (or local workspace ref).

## Async, Errors, Availability

### Async

Default behavior:

- try to finish analysis in the same tool call
- use SDK polling internally

Default waits:

- wallet tools: SDK defaults (30s server hold + fallback, handled by SDK)
- holder profiles: up to 45s (`SOVA_WAIT_TIMEOUT_MS`)
- similarity: up to 45s (`SOVA_WAIT_TIMEOUT_MS`)
- deep analysis: up to 45s (`SOVA_DEEP_WAIT_TIMEOUT_MS`)

On timeout:

- do not throw
- return queued response envelope with `resumeTool: "job_wait"`
- include `jobId`, `agentResultKey` (or `resultKey`), and original input

This keeps total in-process time under 50s, within the MCP 60s transport timeout.

### Error taxonomy

Use stable categories:

- `validation_error`
- `auth_error`
- `config_error`
- `payment_error`
- `rate_limit_error`
- `job_failed`
- `upstream_error`
- `limited_mode_unavailable`

MCP tool errors must be returned as structured responses (`isError: true` in the MCP result content), not thrown. Thrown errors surface as opaque protocol errors to the agent — structured errors let the agent understand what failed and recover.

### Availability

Examples:

- paid analysis tools unavailable in limited mode
- pricing/skill/auth-help always available

When unavailable, return a structured error with:

- reason
- missing config
- suggested remedy

## Verification

Minimum bar before extraction:

### Contract

- every tool returns the documented envelope
- `completed` vs `queued` is correct

### Functional

- `wallet_hud` works on warm and cold wallets
- `wallet_profile` handles GET timeout fallback
- `token_holder_profiles` calls `pollTokenHoldersAgent()` and returns agent shape
- `wallet_similarity` calls `pollWalletSimilarityAgent()` and returns agent shape with `coordinationScore`
- `job_wait` correctly resumes queued flows using `agentResultKey` where available

### Auth

- API key mode works
- x402 mode works
- `auto` prefers API key when both exist
- `auto` falls back to x402 when only wallet config exists
- `auto` enters limited mode cleanly when neither exists

### Failure

- invalid wallet
- invalid token mint
- expired result key
- upstream 500
- failed job
- missing explicit auth config fails fast

### Timeout behavior

- holder profiles and similarity jobs that exceed 45s return a queued envelope, not an error
- `job_wait` correctly resumes from that envelope

## Extraction

Once stable, copy `packages/sova-intel-mcp` into a public repo.

The extraction should be mechanical. If it is not, the package is too coupled.

Public repo readiness rules:

- no private imports
- README is enough to install and run it
- README shows both Claude Desktop and Claude Code installation snippets
- API key setup is documented first
- x402 is documented as optional advanced mode

## Decision Check

The version worth implementing is:

- one product MCP
- API/SDK-backed, using agent-optimised endpoints and SDK methods
- blocking by default (up to 45s), resumable via `job_wait` when needed
- summary-first plus raw-data-second
- API key first-class, x402 optional, `auto` supported
- stdio transport, npm-distributed, `npx` entrypoint
- clean boundary across MCP, Skill, and plugins
- prompts deferred to a future release
