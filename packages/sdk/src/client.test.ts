// ---------------------------------------------------------------------------
// @sova/intel-sdk — unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SovaIntelClient } from "./client.js";
import { SovaHttpError, X402PaymentError } from "./http.js";
import type { X402Auth, WalletHud, WalletProfileResponse, BatchHudResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_BASE_URL = "http://localhost:3001/api/v1";
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function makeApiKeyClient(fetchMock: typeof fetch): SovaIntelClient {
  vi.stubGlobal("fetch", fetchMock);
  return new SovaIntelClient({
    baseUrl: TEST_BASE_URL,
    auth: { kind: "apikey", apiKey: "ak_test" },
    pollIntervalMs: 0,
    maxPollAttempts: 5,
  });
}

function makeX402Client(
  fetchMock: typeof fetch,
  buildPayment: X402Auth["buildPayment"] = async () => "base64_payment_header",
): SovaIntelClient {
  vi.stubGlobal("fetch", fetchMock);
  return new SovaIntelClient({
    baseUrl: TEST_BASE_URL,
    auth: { kind: "x402", buildPayment },
    pollIntervalMs: 0,
    maxPollAttempts: 5,
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

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

const MOCK_PROFILE: WalletProfileResponse = {
  status: "ok",
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
  hud: MOCK_HUD,
  behavior: {
    tradingStyle: "swing",
    speedCategory: "medium",
    avgHoldTimeHours: 18.4,
    medianHoldTimeHours: 12.1,
    buySellRatio: 0.98,
    exitPattern: "partial_exit",
  },
  pnl: {
    allTime: {
      realizedPnlSol: 142.87,
      unrealizedPnlSol: 9.3,
      netPnlSol: 152.17,
      winRate: 0.67,
    },
    period: null,
  },
};

// ---------------------------------------------------------------------------
// getWalletHud — warm path (200 immediately)
// ---------------------------------------------------------------------------

describe("getWalletHud", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends GET /intel/wallet/:addr/hud with X-Api-Key and returns typed HUD", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const headers = init?.headers as Record<string, string>;
      expect(url).toBe(`${TEST_BASE_URL}/intel/wallet/${WALLET}/hud`);
      expect(headers["X-Api-Key"]).toBe("ak_test");
      expect(init?.method ?? "GET").toBe("GET");
      return jsonResponse(MOCK_HUD);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const hud = await client.getWalletHud(WALLET);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(hud.behaviorCode).toBe("W");
    expect(hud.winRate).toBe(0.67);
    expect(hud.isBot).toBe(false);
    expect(hud.trimmedMeanPnl).toBe(12.4);
  });

  it("throws SovaHttpError on 404 (no data yet)", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse({ message: "No HUD data found" }, 404),
    );
    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    await expect(client.getWalletHud(WALLET)).rejects.toThrow(SovaHttpError);
  });

  it("handles 202 timeout fallback: polls job then re-calls with prepaid header", async () => {
    const queued202 = {
      status: "queued",
      walletAddress: WALLET,
      jobId: "hud-job-11",
      prepaidJobId: "hud-job-11",
      monitoringUrl: "/api/v1/jobs/hud-job-11",
      message: "Wallet analysis queued.",
    };

    let hudCallCount = 0;
    let pollCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const headers = (init?.headers ?? {}) as Record<string, string>;

      if (url.includes("/jobs/hud-job-11")) {
        pollCount++;
        if (pollCount === 1) return jsonResponse({ status: "active", progress: 30 });
        return jsonResponse({ status: "completed", progress: 100 });
      }

      if (url.includes(`/intel/wallet/${WALLET}/hud`)) {
        hudCallCount++;
        if (hudCallCount === 1) return jsonResponse(queued202, 202);
        expect(headers["X-Prepaid-Job-Id"]).toBe("hud-job-11");
        return jsonResponse(MOCK_HUD, 200);
      }

      return jsonResponse({ error: "unexpected" }, 500);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const hud = await client.getWalletHud(WALLET);

    expect(hudCallCount).toBe(2);
    expect(pollCount).toBe(2);
    expect(hud.behaviorCode).toBe("W");
  });
});

// ---------------------------------------------------------------------------
// getWalletProfile — warm path (200) and cold path (202 → poll → re-call → 200)
// ---------------------------------------------------------------------------

describe("getWalletProfile", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns profile immediately on 200 (warm wallet)", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => jsonResponse(MOCK_PROFILE));

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const profile = await client.getWalletProfile(WALLET);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(profile.status).toBe("ok");
    expect(profile.walletAddress).toBe(WALLET);
    expect(profile.hud?.trimmedMeanPnl).toBe(12.4);
    expect(profile.summary.currentSolBalance).toBe(4.21);
  });

  it("handles 202 cold wallet: polls job then re-calls endpoint for 200", async () => {
    const queued202 = {
      status: "queued",
      walletAddress: WALLET,
      jobId: "job-99",
      prepaidJobId: "job-99",
      monitoringUrl: "/api/v1/jobs/job-99",
      message: "Wallet analysis queued.",
    };

    let callCount = 0;
    let pollCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const headers = (init?.headers ?? {}) as Record<string, string>;

      if (url.includes("/jobs/job-99") && !url.includes("result")) {
        pollCount++;
        if (pollCount === 1) return jsonResponse({ status: "active", progress: 40 });
        return jsonResponse({ status: "completed", progress: 100 });
      }

      if (url.includes(`/intel/wallet/${WALLET}`) && !url.includes("/hud") && !url.includes("/tokens")) {
        callCount++;
        if (callCount === 1) return jsonResponse(queued202, 202);
        expect(headers["X-Prepaid-Job-Id"]).toBe("job-99");
        return jsonResponse(MOCK_PROFILE, 200);
      }

      return jsonResponse({ error: "unexpected" }, 500);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const profile = await client.getWalletProfile(WALLET);

    expect(callCount).toBe(2);
    expect(pollCount).toBe(2);
    expect(profile.status).toBe("ok");
    expect(profile.walletAddress).toBe(WALLET);
  });

  it("returns null fields without crashing (nullable hud/behavior/pnl)", async () => {
    const sparseProfile: WalletProfileResponse = {
      ...MOCK_PROFILE,
      hud: null,
      behavior: null,
      pnl: null,
    };
    const fetchMock = vi.fn(async (): Promise<Response> => jsonResponse(sparseProfile));
    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const profile = await client.getWalletProfile(WALLET);

    expect(profile.hud).toBeNull();
    expect(profile.behavior).toBeNull();
    expect(profile.pnl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getWalletTokens — query params forwarded correctly
// ---------------------------------------------------------------------------

describe("getWalletTokens", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards all query params to the correct URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      expect(url).toContain(`/intel/wallet/${WALLET}/tokens`);
      expect(url).toContain("pageSize=50");
      expect(url).toContain("sortBy=netSolProfitLoss");
      expect(url).toContain("sortOrder=DESC");
      expect(url).toContain("page=2");
      return jsonResponse({ data: [], total: 0, page: 2, pageSize: 50 });
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const result = await client.getWalletTokens(WALLET, {
      page: 2,
      pageSize: 50,
      sortBy: "netSolProfitLoss",
      sortOrder: "DESC",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
  });

  it("works without optional params (uses server defaults)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      expect(url).not.toContain("sortBy");
      expect(url).not.toContain("page=");
      return jsonResponse({ data: [], total: 0, page: 1, pageSize: 20 });
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    await client.getWalletTokens(WALLET);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// batchHud — correct POST body, correct response shape
// ---------------------------------------------------------------------------

describe("batchHud", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs wallets array and returns typed response", async () => {
    const mockResponse: BatchHudResponse = {
      huds: { addr1: MOCK_HUD },
      notFound: ["addr3"],
      calculatedAt: "2026-03-03T15:00:00.000Z",
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      expect(url).toBe(`${TEST_BASE_URL}/intel/wallets/batch-hud`);
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.wallets).toEqual(["addr1", "addr2", "addr3"]);
      return jsonResponse(mockResponse);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const result = await client.batchHud(["addr1", "addr2", "addr3"]);

    expect(result.huds["addr1"]?.behaviorCode).toBe("W");
    expect(result.notFound).toContain("addr3");
  });
});

// ---------------------------------------------------------------------------
// pollHolderProfiles — verifies jobId-based result key (the critical fix)
// ---------------------------------------------------------------------------

describe("pollHolderProfiles", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to /holders, polls job by jobId, fetches result at holder-profiles:result:{jobId}", async () => {
    const jobAccepted = {
      status: "queued",
      jobId: "job-55",
      requestId: "intel-holders-1234-abc",
      tokenMint: MINT,
      topN: 20,
      monitoringUrl: "/api/v1/jobs/job-55",
      message: "Holder-profiles analysis queued.",
    };

    const holdersResult = { profiles: [{ wallet: "addr1", winRate: 0.7 }] };

    let resultKeyUsed = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();

      if (url.includes("/jobs/result/by-key")) {
        resultKeyUsed = new URL(url).searchParams.get("key") ?? "";
        return jsonResponse(holdersResult);
      }
      if (url.includes(`/intel/token/${MINT}/holders`) && !url.includes("deep")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string).topN).toBe(20);
        return jsonResponse(jobAccepted, 202);
      }
      if (url.includes("/jobs/job-55")) {
        return jsonResponse({ status: "completed", progress: 100 });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const result = await client.pollHolderProfiles<typeof holdersResult>(MINT, 20);

    expect(resultKeyUsed).toBe("holder-profiles:result:job-55");
    expect(resultKeyUsed).not.toContain("intel-holders-1234-abc");
    expect(result.profiles[0].winRate).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// pollSimilarity — verifies requestId-based result key
// ---------------------------------------------------------------------------

describe("pollSimilarity", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs wallets, polls job, fetches result at similarity:result:{requestId}", async () => {
    const jobAccepted = {
      status: "queued",
      jobId: "job-42",
      requestId: "intel-similarity-1234-xyz",
      walletCount: 2,
      monitoringUrl: "/api/v1/jobs/job-42",
      message: "Similarity analysis queued.",
    };

    const similarityResult = { score: 0.91, clusters: [["addr1", "addr2"]] };

    let resultKeyUsed = "";
    let pollCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();

      if (url.includes("/jobs/result/by-key")) {
        resultKeyUsed = new URL(url).searchParams.get("key") ?? "";
        return jsonResponse(similarityResult);
      }
      if (url.includes("/intel/wallets/similarity")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string).wallets).toEqual(["addr1", "addr2"]);
        return jsonResponse(jobAccepted, 202);
      }
      if (url.includes("/jobs/job-42")) {
        pollCount++;
        if (pollCount === 1) return jsonResponse({ status: "active", progress: 50 });
        return jsonResponse({ status: "completed", progress: 100 });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const result = await client.pollSimilarity<typeof similarityResult>(["addr1", "addr2"]);

    expect(resultKeyUsed).toBe("similarity:result:intel-similarity-1234-xyz");
    expect(pollCount).toBe(2);
    expect(result.score).toBe(0.91);
  });

  it("throws when job fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes("/intel/wallets/similarity")) {
        return jsonResponse({ status: "queued", jobId: "job-bad", requestId: "req-bad", monitoringUrl: "" }, 202);
      }
      if (url.includes("/jobs/job-bad")) {
        return jsonResponse({ status: "failed" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    await expect(client.pollSimilarity(["addr1", "addr2"])).rejects.toThrow("Job job-bad failed");
  });
});

// ---------------------------------------------------------------------------
// pollDeepAnalysis — both result keys, and 206 partial failure
// SKIPPED: endpoint temporarily returns 501 (chain-job fix pending)
// ---------------------------------------------------------------------------

describe.skip("pollDeepAnalysis", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("polls both jobs in parallel, uses jobId for holders and requestId for similarity", async () => {
    const deepAccepted = {
      status: "queued",
      tokenMint: MINT,
      topN: 20,
      walletsCount: 2,
      holderProfiles: { jobId: "hp-job-1", requestId: "hp-req-1", monitoringUrl: "/api/v1/jobs/hp-job-1" },
      similarity: { jobId: "sim-job-1", requestId: "sim-req-1", monitoringUrl: "/api/v1/jobs/sim-job-1" },
      message: "Bundled jobs queued.",
    };

    const holdersResult = { profiles: [{ wallet: "addr1" }] };
    const simResult = { score: 0.85 };
    const resultKeysUsed: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();

      if (url.includes("/jobs/result/by-key")) {
        const key = new URL(url).searchParams.get("key") ?? "";
        resultKeysUsed.push(key);
        if (key.startsWith("holder-profiles:")) return jsonResponse(holdersResult);
        if (key.startsWith("similarity:")) return jsonResponse(simResult);
      }
      if (url.includes(`/intel/token/${MINT}/holders/deep`)) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.topN).toBe(20);
        expect(body.wallets).toEqual(["addr1", "addr2"]);
        return jsonResponse(deepAccepted, 202);
      }
      if (url.includes("/jobs/hp-job-1")) return jsonResponse({ status: "completed" });
      if (url.includes("/jobs/sim-job-1")) return jsonResponse({ status: "completed" });

      return jsonResponse({ error: "unexpected" }, 500);
    });

    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const result = await client.pollDeepAnalysis<typeof holdersResult, typeof simResult>(MINT, ["addr1", "addr2"], 20);

    expect(resultKeysUsed).toContain("holder-profiles:result:hp-job-1");
    expect(resultKeysUsed).toContain("similarity:result:sim-req-1");
    expect(result.holderProfiles.profiles[0].wallet).toBe("addr1");
    expect(result.similarity.score).toBe(0.85);
  });

  it("throws descriptive error on 206 partial failure", async () => {
    const partial206 = {
      status: "partial",
      tokenMint: MINT,
      topN: 20,
      holderProfiles: { jobId: "hp-job-2", requestId: "hp-req-2", monitoringUrl: "/api/v1/jobs/hp-job-2" },
      similarity: null,
      message: "Similarity failed to queue.",
    };

    const fetchMock = vi.fn(async (): Promise<Response> => jsonResponse(partial206, 206));
    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);

    await expect(
      client.pollDeepAnalysis(MINT, ["addr1", "addr2"])
    ).rejects.toThrow("Deep analysis partial failure");
  });
});

// ---------------------------------------------------------------------------
// X402 auth flow — 402 → buildPayment → retry → 200
// ---------------------------------------------------------------------------

describe("X402 auth flow", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("probes without auth, reads PAYMENT-REQUIRED header, retries with payment-signature", async () => {
    const paymentRequired = {
      x402Version: 2,
      accepts: [{
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "75000",
        payTo: "TREASURYpubkey1111111111111111111111111111",
        maxTimeoutSeconds: 60,
      }],
    };
    const paymentRequiredHeader = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");

    let callCount = 0;
    const buildPayment = vi.fn(async (payTo: string, amount: bigint) => {
      expect(payTo).toBe("TREASURYpubkey1111111111111111111111111111");
      expect(amount).toBe(75000n);
      return "base64encodedXPayment";
    });

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      callCount++;
      const headers = init?.headers as Record<string, string> | undefined;
      if (callCount === 1) {
        expect(headers?.["X-Api-Key"]).toBeUndefined();
        expect(headers?.["payment-signature"]).toBeUndefined();
        return jsonResponse(
          { error: "Payment required", required: 5 },
          402,
          { "PAYMENT-REQUIRED": paymentRequiredHeader },
        );
      }
      expect(headers?.["payment-signature"]).toBe("base64encodedXPayment");
      return jsonResponse(MOCK_HUD, 200);
    });

    const client = makeX402Client(fetchMock as unknown as typeof fetch, buildPayment);
    const hud = await client.getWalletHud(WALLET);

    expect(callCount).toBe(2);
    expect(buildPayment).toHaveBeenCalledOnce();
    expect(hud.trimmedMeanPnl).toBe(12.4);
  });

  it("throws X402PaymentError if 402 is returned after payment attempt", async () => {
    const paymentRequired = {
      x402Version: 2,
      accepts: [{
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "75000",
        payTo: "TREASURYpubkey1111111111111111111111111111",
        maxTimeoutSeconds: 60,
      }],
    };
    const paymentRequiredHeader = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");

    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse(
        { error: "Payment required", required: 5 },
        402,
        { "PAYMENT-REQUIRED": paymentRequiredHeader },
      )
    );
    const client = makeX402Client(fetchMock as unknown as typeof fetch);

    await expect(client.getWalletHud(WALLET)).rejects.toThrow(X402PaymentError);
  });
});

// ---------------------------------------------------------------------------
// Error handling — SovaHttpError surface
// ---------------------------------------------------------------------------

describe("error handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws SovaHttpError with correct status on 422 (system wallet)", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse({ status: "skipped", skipReason: "known-wallet" }, 422),
    );
    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const err = await client.getWalletProfile(WALLET).catch((e) => e);
    expect(err).toBeInstanceOf(SovaHttpError);
    expect((err as SovaHttpError).status).toBe(422);
  });

  it("throws SovaHttpError with correct status on 500", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse({ message: "Internal server error" }, 500),
    );
    const client = makeApiKeyClient(fetchMock as unknown as typeof fetch);
    const err = await client.getWalletHud(WALLET).catch((e) => e);
    expect(err).toBeInstanceOf(SovaHttpError);
    expect((err as SovaHttpError).status).toBe(500);
  });
});
