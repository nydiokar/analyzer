// ---------------------------------------------------------------------------
// sova://playbooks/token-analysis — static embedded playbook
//
// This resource gives an agent (or developer) the concrete decision tree for
// token analysis: which tools to call, in what order, how to handle async
// job envelopes, and when NOT to use deep_token_analysis.
//
// Embedded rather than remote-fetched so it's always available even in
// limited mode or when network is unavailable.
// ---------------------------------------------------------------------------

export function tokenAnalysisPlaybookHandler(): string {
  return `# Sova Intel — Token Analysis Playbook

## Overview

Token analysis uses two agent-optimised tools in sequence:

  1. token_holder_profiles (20cr) — behavioral profiles of top holders
  2. wallet_similarity (20cr)     — coordination / sybil detection across those holders

Total cost: 40 credits. Use this path when you need both behavioral and coordination data.
Use deep_token_analysis (35cr) only if you need the raw developer-format payloads — it does
not return the agent-optimised aggregate or per-pair similarity flags.

## Tool reference

| Tool                    | Credits | Output                                                      |
|-------------------------|---------|-------------------------------------------------------------|
| token_holder_profiles   | 20      | Aggregate behavior distribution, supply concentration,      |
|                         |         | per-holder profiles with behaviorType + PnL                 |
| wallet_similarity       | 20      | coordinationScore 0–1, flagged pairs, per-pair overlap      |
| deep_token_analysis     | 35      | Raw holder + similarity in developer format (not optimised) |
| wallet_hud              | 1       | Single-wallet quick signal — not part of token analysis     |
| wallet_profile          | 5       | Single-wallet full detail — escalation from wallet_hud      |
| batch_wallet_hud        | 5 flat  | Up to 30 wallets HUD scan                                   |
| job_status              | 0       | Check queued job status (non-blocking)                      |
| job_wait                | 0       | Resume queued job and retrieve result (blocking poll)       |

## Async job pattern

token_holder_profiles and wallet_similarity both run as background jobs.
Responses can be mode:"completed" (result ready) or mode:"queued" (still running).

When mode:"queued":
  {
    "ok": true,
    "tool": "<tool_name>",
    "mode": "queued",
    "job": {
      "jobId": "<id>",
      "agentResultKey": "<key>",
      "resultKey": "<key>",
      "resumeTool": "job_wait"
    }
  }

To resume: call job_wait with jobId and agentResultKey from the envelope.
Do NOT call the original tool again — the job is already queued and will be double-billed.
Keep calling job_wait until mode:"completed". Default poll timeout is 45 seconds per call.

## Token analysis decision tree

1. Call token_holder_profiles(tokenMint, topN=20)
   → if queued: call job_wait(jobId, agentResultKey) until completed
   → extract wallet addresses from data.profiles[].walletAddress
   → note data.aggregate for holder summary

2. Call wallet_similarity(wallets=[...addresses from step 1...])
   → if queued: call job_wait(jobId, agentResultKey) until completed
   → note data.coordinationScore and data.metadata.flaggedPairs

3. Synthesize:
   - Holder behavior: aggregate.behaviorDistribution[0].behaviorType is the dominant type
   - Concentration: aggregate.top5SupplyPct — above 40% is high concentration
   - Coordination: coordinationScore >= 0.7 is HIGH risk, 0.4–0.7 MODERATE, < 0.4 LOW
   - Flagged pairs: check flag field — HIGH_SIMILARITY_AND_OVERLAP is the most significant flag

## When to escalate to single-wallet tools

If a specific holder warrants deeper investigation:
  - Call wallet_hud(walletAddress)        — quick behavior + win rate check (1cr)
  - Call wallet_profile(walletAddress)    — full PnL, KOL identity, behavior detail (5cr)
  - Call wallet_token_pnl(walletAddress)  — per-token profit/loss breakdown (3cr)

## Auth and credits

API key mode (SOVA_API_KEY): credits are deducted from your account balance.
X402 mode (SOLANA_PRIVATE_KEY): USDC is paid per request from your Solana wallet.

To check current credit costs: read resource sova://pricing
To check auth setup: read resource sova://help/auth
To check full tool skill reference: read resource sova://skill
`;
}
