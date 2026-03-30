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
- The MCP is one server, not “product MCP + payment MCP”.

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
- optional prompts
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
- fastest, cheapest wallet signal
- uses SDK `getWalletHud()`

`wallet_profile`
- full wallet intelligence
- uses SDK `getWalletProfile()`

`token_holder_profiles`
- top-holder behavioral intelligence
- uses `/holders/agent` path via SDK
- `wait=true` by default

`wallet_similarity`
- coordination analysis for 2-30 wallets
- uses `/similarity/agent` path via SDK
- `wait=true` by default

### Support tools

`wallet_token_pnl`
- per-token breakdown for a wallet

`batch_wallet_hud`
- batch scan/ranking support

`deep_token_analysis`
- holder profiles + similarity in one call
- not the default token starting tool

`job_status`
- inspect queued work

`job_wait`
- standard resume path for queued work

### Resources

`sova://pricing`
- endpoint costs and product pricing

`sova://skill`
- current machine-readable product skill

`sova://help/auth`
- concise setup and auth help

### Prompts

Optional only. If included, keep them thin:

- `analyze_wallet`
- `analyze_token_holders`
- `check_coordination`

Prompts should route to tools, not hide product logic.

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
- `resultKey` when known
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

Suggested envs:

```text
SOVA_BASE_URL=https://api.sova-intel.com/api/v1
SOVA_AUTH_MODE=auto
SOVA_API_KEY=
SOLANA_PRIVATE_KEY=
SOVA_DEFAULT_WAIT_TIMEOUT_MS=180000
SOVA_DEEP_WAIT_TIMEOUT_MS=300000
SOVA_POLL_INTERVAL_MS=5000
SOVA_MAX_POLL_ATTEMPTS=60
```

## Implementation Shape

Build in this repo first as:

- `packages/sova-intel-mcp`

Minimal structure:

```text
packages/sova-intel-mcp/
  package.json
  tsconfig.json
  README.md
  .mcp.json
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
    prompts/
      analyze-wallet.ts
      analyze-token-holders.ts
      check-coordination.ts
```

Layering rules:

- tools are thin
- auth is isolated
- tool handlers are auth-agnostic
- no imports from private backend internals

## Async, Errors, Availability

### Async

Default behavior:

- try to finish analysis in the same tool call
- use SDK polling internally

Default waits:

- wallet tools: use SDK defaults
- holder profiles: up to 180s
- similarity: up to 180s
- deep analysis: up to 300s

On timeout:

- do not throw
- return queued response envelope

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
- `token_holder_profiles` returns agent shape
- `wallet_similarity` returns agent shape
- `job_wait` correctly resumes queued flows

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

## Extraction

Once stable, copy `packages/sova-intel-mcp` into a public repo.

The extraction should be mechanical. If it is not, the package is too coupled.

Public repo readiness rules:

- no private imports
- README is enough to install and run it
- `.mcp.json` supports the common single-server setup
- API key setup is documented first
- x402 is documented as optional advanced mode

## Decision Check

The version worth implementing is:

- one product MCP
- API/SDK-backed
- blocking by default, resumable when needed
- summary-first plus raw-data-second
- API key first-class, x402 optional, `auto` supported
- clean boundary across MCP, Skill, and plugins
