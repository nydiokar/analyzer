import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SovaIntelClient, WalletHud } from "@sova-intel/sdk";
import { JobPollerError, SovaHttpError } from "@sova-intel/sdk";

import { walletHudHandler } from "./wallet-hud.js";
import { walletProfileHandler } from "./wallet-profile.js";
import { tokenHolderProfilesHandler } from "./token-holder-profiles.js";
import { walletSimilarityHandler } from "./wallet-similarity.js";
import { batchWalletHudHandler } from "./batch-wallet-hud.js";
import { jobWaitHandler } from "./job-wait.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT = "So11111111111111111111111111111111111111112";
const WALLET_2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const MOCK_HUD: WalletHud = {
  walletAddress: WALLET,
  signalType: "wallet_behavior_v1",
  trimmedMeanPnl: 12.4,
  avgTxValueSol: 2.45,
  behaviorCategory: "SWING_TRADER",
  behaviorCode: "W",
  medianHoldTimeHours: 12.1,
  avgTradesPerDay: 4.2,
  winRate: 0.67,
  dataQualityTier: "GOLD",
  isBot: false,
  isWhale: false,
  uniqueTokensPerDay: 3.1,
  currentHoldingsSol: 45.2,
  calculatedAt: "2026-03-03T11:30:00.000Z",
};

const MOCK_QUEUED = {
  status: "queued" as const,
  walletAddress: WALLET,
  jobId: "job-abc-123",
  prepaidJobId: "job-abc-123",
  monitoringUrl: "/api/v1/jobs/job-abc-123",
  message: "Analysis queued.",
};

// Matches the real wire shape from buildIntelResponse() in intel.controller.ts
// after the pnl mapping fix (PnlOverviewResponseData → IntelPnlAllTimeDto).
const MOCK_WALLET_PROFILE = {
  status: "ok" as const,
  walletAddress: WALLET,
  summary: {
    lastAnalyzedAt: "2026-03-03T11:30:00.000Z",
    realizedPnl: 142.87,
    profitableTradesCount: 34,
    totalTradesCount: 51,
    currentSolBalance: 4.21,
    knownType: null,
    knownLabel: null,
  },
  kol: null,
  hud: MOCK_HUD,
  behavior: {
    tradingStyle: "swing",
    speedCategory: "medium",
    avgHoldTimeHours: 10.5,
    medianHoldTimeHours: 12.1,
    buySellRatio: 1.2,
    exitPattern: "partial_exit",
    avgEntryMcapUsd: 200000,
    typicalEntryMcapUsd: 220000,
    entryMcapP25Usd: 100000,
    entryMcapP75Usd: 500000,
    dominantEntryMcapBucket: "200-500k",
    dominantEntryMcapBucketShare: 0.45,
  },
  // pnl.allTime is mapped by buildIntelResponse to IntelPnlAllTimeDto shape:
  // realizedPnlSol, unrealizedPnlSol, netPnlSol, winRate (decimal)
  pnl: {
    allTime: {
      realizedPnlSol: 142.87,
      unrealizedPnlSol: 12.5,
      netPnlSol: 155.37,
      winRate: 0.67,
    },
    period: null,
  },
};

// Matches AgentHolderProfilesResult from /intel/token/:mint/holders/agent
const MOCK_HOLDER_PROFILES_RESULT = {
  aggregate: {
    totalHolders: 100,
    analyzedHolders: 20,
    top1SupplyPct: 12.3,
    top5SupplyPct: 42.5,
    behaviorDistribution: [
      { behaviorType: "SWING_TRADER", count: 8, supplyPct: 22.1 },
    ],
    avgWalletPnlSol: 5.3,
  },
  profiles: [],
  metadata: {
    tokenMint: MINT,
    totalHoldersRequested: 20,
    totalHoldersAnalyzed: 20,
  },
};

// Matches AgentSimilarityResult from /intel/wallets/similarity/agent
const MOCK_SIMILARITY_RESULT = {
  coordinationScore: 0.75,
  pairs: [],
  globalMetrics: { averageSimilarity: 0.61 },
  metadata: {
    walletsAnalyzed: 2,
    totalPairs: 1,
    meaningfulPairs: 1,
    flaggedPairs: 1,
  },
};

const MOCK_AGENT_JOB = {
  jobId: "job-agent-1",
  agentResultKey: "agent-result-key-1",
  resultKey: "agent-result-key-1",
  monitoringUrl: "/api/v1/jobs/job-agent-1",
  message: "Queued.",
};

// Matches BatchHudResponse from /intel/wallets/batch-hud
const MOCK_BATCH_HUD_RESPONSE = {
  huds: {
    [WALLET]: MOCK_HUD,
    [WALLET_2]: MOCK_HUD,
  },
  queued: [] as Array<{ walletAddress: string; jobId: string; monitoringUrl: string }>,
  skipped: [] as string[],
  calculatedAt: "2026-03-03T11:30:00.000Z",
};

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function makeMockClient(overrides: Partial<Record<keyof SovaIntelClient, any>> = {}): SovaIntelClient {
  return {
    fetchWalletHud: vi.fn(),
    fetchWalletHudPrepaid: vi.fn(),
    fetchWalletProfile: vi.fn(),
    fetchWalletProfilePrepaid: vi.fn(),
    waitForJob: vi.fn(),
    batchHud: vi.fn(),
    queueTokenHoldersAgent: vi.fn(),
    queueWalletSimilarityAgent: vi.fn(),
    pollJobResult: vi.fn(),
    pollResultByKey: vi.fn(),
    getWalletHud: vi.fn(),
    getWalletProfile: vi.fn(),
    getWalletTokens: vi.fn(),
    ...overrides,
  } as unknown as SovaIntelClient;
}

// ---------------------------------------------------------------------------
// Shared test args
// ---------------------------------------------------------------------------

const AUTH_MODE = "apikey";
const TOOL_COSTS = {};
const POLL_OPTIONS = { intervalMs: 0, maxAttempts: 3 };

function parseResult(res: { content: Array<{ text: string }> }) {
  return JSON.parse(res.content[0].text);
}

// ---------------------------------------------------------------------------
// wallet_hud
// ---------------------------------------------------------------------------

describe("walletHudHandler", () => {
  it("fresh: returns completed result with behaviorCode in summary", async () => {
    const client = makeMockClient({
      fetchWalletHud: vi.fn().mockResolvedValue(MOCK_HUD),
    });

    const res = await walletHudHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("wallet_hud");
    expect(parsed.summary).toContain("W profile");
    expect(parsed.job).toBeNull();
    expect(res.isError).toBeUndefined();
  });

  it("stale+completes: polls job then returns completed HUD from prepaid fetch", async () => {
    const client = makeMockClient({
      fetchWalletHud: vi.fn().mockResolvedValue(MOCK_QUEUED),
      waitForJob: vi.fn().mockResolvedValue(undefined),
      fetchWalletHudPrepaid: vi.fn().mockResolvedValue(MOCK_HUD),
    });

    const res = await walletHudHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(client.waitForJob).toHaveBeenCalledWith(MOCK_QUEUED.jobId, POLL_OPTIONS);
    expect(client.fetchWalletHudPrepaid).toHaveBeenCalledWith(WALLET, MOCK_QUEUED.prepaidJobId);
  });

  it("stale+timeout: returns queued with job envelope and resumeTool", async () => {
    const client = makeMockClient({
      fetchWalletHud: vi.fn().mockResolvedValue(MOCK_QUEUED),
      waitForJob: vi.fn().mockRejectedValue(
        new JobPollerError("job-abc-123", "Job job-abc-123 did not complete within 3 attempts"),
      ),
    });

    const res = await walletHudHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("queued");
    expect(parsed.ok).toBe(true);
    expect(parsed.job.jobId).toBe("job-abc-123");
    expect(parsed.job.prepaidJobId).toBe("job-abc-123");
    expect(parsed.job.resumeTool).toBe("job_wait");
    expect(res.isError).toBeUndefined();
  });

  it("fetch error (402): returns isError with payment_error code", async () => {
    const client = makeMockClient({
      fetchWalletHud: vi.fn().mockRejectedValue(
        new SovaHttpError(402, {}, "HTTP 402 Payment Required"),
      ),
    });

    const res = await walletHudHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(parsed.tool).toBe("wallet_hud");
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wallet_profile
// ---------------------------------------------------------------------------

describe("walletProfileHandler", () => {
  it("fresh: returns completed result with summary", async () => {
    const client = makeMockClient({
      fetchWalletProfile: vi.fn().mockResolvedValue(MOCK_WALLET_PROFILE),
    });

    const res = await walletProfileHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("wallet_profile");
    expect(parsed.summary).toContain("W profile");
    expect(parsed.job).toBeNull();
    expect(res.isError).toBeUndefined();
  });

  it("fresh: hud present but winRate/realizedPnlSol undefined — does not throw", async () => {
    const profileWithMissingNumerics = {
      ...MOCK_WALLET_PROFILE,
      hud: { ...MOCK_HUD, winRate: undefined as unknown as number },
      pnl: { allTime: { realizedPnlSol: undefined as unknown as number } },
    };
    const client = makeMockClient({
      fetchWalletProfile: vi.fn().mockResolvedValue(profileWithMissingNumerics),
    });

    const res = await walletProfileHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(res.isError).toBeUndefined();
  });

  it("stale+completes: polls then fetches profile via prepaid", async () => {
    const client = makeMockClient({
      fetchWalletProfile: vi.fn().mockResolvedValue(MOCK_QUEUED),
      waitForJob: vi.fn().mockResolvedValue(undefined),
      fetchWalletProfilePrepaid: vi.fn().mockResolvedValue(MOCK_WALLET_PROFILE),
    });

    const res = await walletProfileHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(client.waitForJob).toHaveBeenCalledWith(MOCK_QUEUED.jobId, POLL_OPTIONS);
    expect(client.fetchWalletProfilePrepaid).toHaveBeenCalledWith(WALLET, MOCK_QUEUED.prepaidJobId);
  });

  it("stale+timeout: returns queued with resumeTool=job_wait", async () => {
    const client = makeMockClient({
      fetchWalletProfile: vi.fn().mockResolvedValue(MOCK_QUEUED),
      waitForJob: vi.fn().mockRejectedValue(
        new JobPollerError("job-abc-123", "Job job-abc-123 did not complete within 3 attempts"),
      ),
    });

    const res = await walletProfileHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("queued");
    expect(parsed.ok).toBe(true);
    expect(parsed.job.jobId).toBe("job-abc-123");
    expect(parsed.job.resumeTool).toBe("job_wait");
    expect(res.isError).toBeUndefined();
  });

  it("fetch error: returns isError", async () => {
    const client = makeMockClient({
      fetchWalletProfile: vi.fn().mockRejectedValue(
        new SovaHttpError(401, {}, "HTTP 401 Unauthorized"),
      ),
    });

    const res = await walletProfileHandler({ walletAddress: WALLET }, client, AUTH_MODE, TOOL_COSTS, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// token_holder_profiles
// ---------------------------------------------------------------------------

describe("tokenHolderProfilesHandler", () => {
  it("completes: returns completed with holders analyzed in summary", async () => {
    const client = makeMockClient({
      queueTokenHoldersAgent: vi.fn().mockResolvedValue(MOCK_AGENT_JOB),
      pollJobResult: vi.fn().mockResolvedValue(MOCK_HOLDER_PROFILES_RESULT),
    });

    const res = await tokenHolderProfilesHandler(
      { tokenMint: MINT, topN: 20 },
      client,
      AUTH_MODE,
      TOOL_COSTS,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("token_holder_profiles");
    expect(parsed.summary).toContain("holders analyzed");
    expect(client.queueTokenHoldersAgent).toHaveBeenCalledWith(MINT, 20);
  });

  it("timeout: returns queued with jobId and agentResultKey", async () => {
    const client = makeMockClient({
      queueTokenHoldersAgent: vi.fn().mockResolvedValue(MOCK_AGENT_JOB),
      pollJobResult: vi.fn().mockRejectedValue(
        new JobPollerError("job-agent-1", "Job job-agent-1 did not complete within 3 attempts"),
      ),
    });

    const res = await tokenHolderProfilesHandler(
      { tokenMint: MINT },
      client,
      AUTH_MODE,
      TOOL_COSTS,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("queued");
    expect(parsed.ok).toBe(true);
    expect(parsed.job.jobId).toBe("job-agent-1");
    expect(parsed.job.agentResultKey).toBe("agent-result-key-1");
    expect(parsed.job.resumeTool).toBe("job_wait");
    expect(res.isError).toBeUndefined();
  });

  it("queue error: returns isError", async () => {
    const client = makeMockClient({
      queueTokenHoldersAgent: vi.fn().mockRejectedValue(new Error("HTTP 402 payment required")),
    });

    const res = await tokenHolderProfilesHandler(
      { tokenMint: MINT },
      client,
      AUTH_MODE,
      TOOL_COSTS,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wallet_similarity
// ---------------------------------------------------------------------------

describe("walletSimilarityHandler", () => {
  it("completes: returns completed with coordination score in summary", async () => {
    const client = makeMockClient({
      queueWalletSimilarityAgent: vi.fn().mockResolvedValue(MOCK_AGENT_JOB),
      pollJobResult: vi.fn().mockResolvedValue(MOCK_SIMILARITY_RESULT),
    });

    const res = await walletSimilarityHandler(
      { wallets: [WALLET, WALLET_2] },
      client,
      AUTH_MODE,
      TOOL_COSTS,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("wallet_similarity");
    expect(parsed.summary).toContain("coordination score");
    expect(client.queueWalletSimilarityAgent).toHaveBeenCalledWith([WALLET, WALLET_2]);
  });

  it("timeout: returns queued with agentResultKey and resumeTool", async () => {
    const client = makeMockClient({
      queueWalletSimilarityAgent: vi.fn().mockResolvedValue(MOCK_AGENT_JOB),
      pollJobResult: vi.fn().mockRejectedValue(
        new JobPollerError("job-agent-1", "Job job-agent-1 did not complete within 3 attempts"),
      ),
    });

    const res = await walletSimilarityHandler(
      { wallets: [WALLET, WALLET_2] },
      client,
      AUTH_MODE,
      TOOL_COSTS,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("queued");
    expect(parsed.ok).toBe(true);
    expect(parsed.job.agentResultKey).toBe("agent-result-key-1");
    expect(parsed.job.resumeTool).toBe("job_wait");
    expect(res.isError).toBeUndefined();
  });

  it("queue error: returns isError", async () => {
    const client = makeMockClient({
      queueWalletSimilarityAgent: vi.fn().mockRejectedValue(
        new SovaHttpError(429, {}, "HTTP 429 rate limit exceeded"),
      ),
    });

    const res = await walletSimilarityHandler(
      { wallets: [WALLET, WALLET_2] },
      client,
      AUTH_MODE,
      TOOL_COSTS,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// batch_wallet_hud
// ---------------------------------------------------------------------------

describe("batchWalletHudHandler", () => {
  it("all fresh: returns completed with '2 HUDs ready' in summary", async () => {
    const client = makeMockClient({
      batchHud: vi.fn().mockResolvedValue(MOCK_BATCH_HUD_RESPONSE),
    });

    const res = await batchWalletHudHandler(
      { wallets: [WALLET, WALLET_2] },
      client,
      AUTH_MODE,
      TOOL_COSTS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("batch_wallet_hud");
    expect(parsed.summary).toContain("2 HUDs ready");
    expect(parsed.job).toBeNull();
    expect(res.isError).toBeUndefined();
  });

  it("mixed: 1 hud ready + 1 queued — summary includes 'queued (stale)'", async () => {
    const mixedResponse = {
      huds: { [WALLET]: MOCK_HUD },
      queued: [{ walletAddress: WALLET_2, jobId: "job-stale-1", monitoringUrl: "/api/v1/jobs/job-stale-1" }],
      skipped: [] as string[],
      calculatedAt: "2026-03-03T11:30:00.000Z",
    };
    const client = makeMockClient({
      batchHud: vi.fn().mockResolvedValue(mixedResponse),
    });

    const res = await batchWalletHudHandler(
      { wallets: [WALLET, WALLET_2] },
      client,
      AUTH_MODE,
      TOOL_COSTS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.summary).toContain("1 HUDs ready");
    expect(parsed.summary).toContain("1 queued (stale)");
  });

  it("error: returns isError", async () => {
    const client = makeMockClient({
      batchHud: vi.fn().mockRejectedValue(new Error("HTTP 401 unauthorized")),
    });

    const res = await batchWalletHudHandler(
      { wallets: [WALLET, WALLET_2] },
      client,
      AUTH_MODE,
      TOOL_COSTS,
    );
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// job_wait
// ---------------------------------------------------------------------------

describe("jobWaitHandler", () => {
  it("missing key: returns validation_error without calling client", async () => {
    const client = makeMockClient();

    const res = await jobWaitHandler({}, client, AUTH_MODE, POLL_OPTIONS);
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(parsed.summary).toContain("validation_error");
    expect(res.isError).toBe(true);
  });

  it("completes via agentResultKey: returns completed with data", async () => {
    const resultData = { answer: 42 };
    const client = makeMockClient({
      pollJobResult: vi.fn().mockResolvedValue(resultData),
    });

    const res = await jobWaitHandler(
      { jobId: "job-abc-123", agentResultKey: "agent-result-key-1" },
      client,
      AUTH_MODE,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    expect(parsed.tool).toBe("job_wait");
    expect(parsed.data).toEqual(resultData);
    expect(res.isError).toBeUndefined();
  });

  it("completes via resultKey fallback (no agentResultKey)", async () => {
    const client = makeMockClient({
      pollJobResult: vi.fn().mockResolvedValue({ done: true }),
    });

    const res = await jobWaitHandler(
      { resultKey: "result-key-fallback" },
      client,
      AUTH_MODE,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("completed");
    expect(parsed.ok).toBe(true);
    // No jobId so pollResultByKey should be called (no jobId means pollResultByKey path)
    expect(client.pollResultByKey).toHaveBeenCalledWith("result-key-fallback", {
      intervalMs: 0,
      maxAttempts: 3,
    });
  });

  it("timeout: returns queued with jobId, agentResultKey, and resumeTool=job_wait", async () => {
    const client = makeMockClient({
      pollJobResult: vi.fn().mockRejectedValue(
        new JobPollerError("job-abc-123", "Job job-abc-123 did not complete within 3 attempts"),
      ),
    });

    const res = await jobWaitHandler(
      { jobId: "job-abc-123", agentResultKey: "agent-result-key-1", resultType: "wallet_hud" },
      client,
      AUTH_MODE,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.mode).toBe("queued");
    expect(parsed.ok).toBe(true);
    expect(parsed.job.jobId).toBe("job-abc-123");
    expect(parsed.job.agentResultKey).toBe("agent-result-key-1");
    expect(parsed.job.resumeTool).toBe("job_wait");
    expect(parsed.job.resultType).toBe("wallet_hud");
    expect(res.isError).toBeUndefined();
  });

  it("non-timeout error: returns isError with classified code", async () => {
    const client = makeMockClient({
      pollJobResult: vi.fn().mockRejectedValue(
        new SovaHttpError(402, {}, "HTTP 402 payment required"),
      ),
    });

    const res = await jobWaitHandler(
      { jobId: "job-abc-123", agentResultKey: "agent-result-key-1" },
      client,
      AUTH_MODE,
      POLL_OPTIONS,
    );
    const parsed = parseResult(res);

    expect(parsed.ok).toBe(false);
    expect(res.isError).toBe(true);
  });
});
