// ---------------------------------------------------------------------------
// analyze_token — MCP prompt for token holder + coordination analysis
//
// This prompt gives an agent a concrete, step-by-step instruction set for
// analyzing a Solana token using the two primary agent-optimised tools:
//   1. token_holder_profiles  — who holds this token and how they trade
//   2. wallet_similarity      — are the top holders coordinated / sybil
//
// It handles the async reality of these tools: both can return mode:"queued"
// with a job envelope. The prompt instructs the agent to use job_wait to
// resume rather than retrying the original tool call.
// ---------------------------------------------------------------------------

export interface AnalyzeTokenPromptArgs {
  tokenMint: string;
  topN?: number;
}

export function analyzeTokenPrompt(args: AnalyzeTokenPromptArgs): string {
  const { tokenMint, topN = 20 } = args;

  return `You are analyzing the Solana token ${tokenMint} using the Sova Intel MCP tools.

## Goal

Produce a structured token intelligence report covering:
- Holder behavior profile (what types of traders hold this token)
- Supply concentration (how much is held by the top wallets)
- Coordination risk (whether top holders appear to be coordinated or sybil)

## Step 1 — Holder profiles

Call token_holder_profiles with:
  tokenMint: "${tokenMint}"
  topN: ${topN}

This costs 5 credits and queues a background job.

**If the response has mode:"queued":**
  The job is still running. Call job_wait with the job envelope from the response:
    jobId: <job.jobId>
    agentResultKey: <job.agentResultKey>
  Continue calling job_wait until mode:"completed" or an error is returned.
  Do not call token_holder_profiles again — the job is already running.

**When mode:"completed":**
  Extract the wallet addresses from data.profiles[].walletAddress.
  Collect the top ${Math.min(topN, 30)} addresses for the next step.
  Note: data.aggregate contains the summary — behavior distribution, supply concentration, avg PnL.

## Step 2 — Coordination analysis

Call wallet_similarity with the wallet addresses collected from Step 1:
  wallets: [<list of wallet addresses from profiles>]

This costs 5 credits. Apply the same job_wait pattern if the response has mode:"queued".

**When mode:"completed":**
  Note data.coordinationScore (0–1 scale) and data.metadata.flaggedPairs.
  Flagged pairs have a flag field explaining why they were flagged (e.g. HIGH_SIMILARITY_AND_OVERLAP).

## Step 3 — Synthesize

Combine the two results into a structured report:

**Token:** ${tokenMint}

**Holder profile:**
- <dominant behavior type and count from aggregate.behaviorDistribution[0]>
- Top-5 wallets hold <aggregate.top5SupplyPct>% of supply
- Avg holder PnL: <aggregate.avgWalletPnlSol> SOL
- Total holders analyzed: <aggregate.analyzedHolders>

**Coordination risk:**
- Score: <coordinationScore> (<LOW|MODERATE|HIGH>)
- Flagged pairs: <flaggedPairs>
- <If any pairs are flagged: briefly describe the highest-scoring flagged pair>

**Assessment:**
- <1–3 sentence plain-language summary of what this means for the token>
- <Note any significant concerns: high coordination score, whale concentration, bot-heavy holder base>

## Notes

- Do not call deep_token_analysis for this workflow — it returns raw developer shapes, not the agent-optimised format.
- Credit cost: 5cr (holder profiles) + 5cr (similarity) = 10cr total.
- If either step fails with a payment error, read sova://pricing for current credit costs.
- If either step fails with a rate limit or server error, wait 10 seconds and retry once before reporting failure.
`;
}
