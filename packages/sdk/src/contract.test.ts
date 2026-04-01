// ---------------------------------------------------------------------------
// @sova/intel-sdk — CONTRACT TESTS
//
// These tests hit the REAL API. They exist to catch type drift: if the API
// changes its response shape and the SDK types are not updated, these tests
// will fail with clear field-level errors.
//
// They are SKIPPED automatically when env vars are absent (CI / unit test runs).
// To run locally:
//   INTEL_API_KEY=ak_xxx INTEL_BASE_URL=http://localhost:3001/api/v1 pnpm test:contract
//
// A known-good wallet and token mint must exist in the API's database.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import { SovaIntelClient } from "./client.js";
import type {
  WalletHud,
  WalletProfileResponse,
  WalletBehavior,
  WalletSummary,
  HolderProfilesResult,
  HolderProfile,
} from "./types.js";

const API_KEY   = process.env.INTEL_API_KEY;
const BASE_URL  = process.env.INTEL_BASE_URL ?? "http://localhost:3001/api/v1";
// Wallet that is guaranteed to have HUD + profile data in the DB
const TEST_WALLET = process.env.CONTRACT_TEST_WALLET ?? "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
// Token mint that has holder profiles in the DB
const TEST_MINT   = process.env.CONTRACT_TEST_MINT   ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SKIP = !API_KEY;

// ---------------------------------------------------------------------------
// Helpers — assert shape, not values
// ---------------------------------------------------------------------------

function assertWalletHud(hud: WalletHud, label = "hud") {
  // Required string fields
  expect(typeof hud.walletAddress,    `${label}.walletAddress`).toBe("string");
  expect(typeof hud.signalType,       `${label}.signalType`).toBe("string");
  expect(typeof hud.behaviorCode,     `${label}.behaviorCode`).toBe("string");
  expect(typeof hud.dataQualityTier,  `${label}.dataQualityTier`).toBe("string");
  expect(typeof hud.calculatedAt,     `${label}.calculatedAt`).toBe("string");

  // Required number fields
  expect(typeof hud.trimmedMeanPnl,     `${label}.trimmedMeanPnl`).toBe("number");
  expect(typeof hud.avgTxValueSol,      `${label}.avgTxValueSol`).toBe("number");
  expect(typeof hud.avgTradesPerDay,    `${label}.avgTradesPerDay`).toBe("number");
  expect(typeof hud.winRate,            `${label}.winRate`).toBe("number");
  expect(typeof hud.uniqueTokensPerDay, `${label}.uniqueTokensPerDay`).toBe("number");
  expect(typeof hud.currentHoldingsSol, `${label}.currentHoldingsSol`).toBe("number");

  // winRate must be 0–1
  expect(hud.winRate, `${label}.winRate in [0,1]`).toBeGreaterThanOrEqual(0);
  expect(hud.winRate, `${label}.winRate in [0,1]`).toBeLessThanOrEqual(1);

  // Required boolean fields
  expect(typeof hud.isBot,   `${label}.isBot`).toBe("boolean");
  expect(typeof hud.isWhale, `${label}.isWhale`).toBe("boolean");

  // dataQualityTier must be one of the known values
  expect(
    ["GOLD", "SILVER", "BRONZE", "INSUFFICIENT"].includes(hud.dataQualityTier),
    `${label}.dataQualityTier is valid tier`,
  ).toBe(true);

  // Optional fields — if present must be correct type
  if (hud.behaviorCategory !== undefined) {
    expect(typeof hud.behaviorCategory, `${label}.behaviorCategory`).toBe("string");
  }
  if (hud.medianHoldTimeHours !== undefined) {
    expect(typeof hud.medianHoldTimeHours, `${label}.medianHoldTimeHours`).toBe("number");
  }
  if (hud.currentHoldingsUsd !== undefined) {
    expect(typeof hud.currentHoldingsUsd, `${label}.currentHoldingsUsd`).toBe("number");
  }
  if (hud.typicalEntryMcapUsd !== undefined) {
    expect(typeof hud.typicalEntryMcapUsd, `${label}.typicalEntryMcapUsd`).toBe("number");
  }
  if (hud.dominantEntryMcapBucket !== undefined) {
    expect(typeof hud.dominantEntryMcapBucket, `${label}.dominantEntryMcapBucket`).toBe("string");
  }
  if (hud.provenance !== undefined) {
    expect(typeof hud.provenance.provider,       `${label}.provenance.provider`).toBe("string");
    expect(typeof hud.provenance.schemaVersion,  `${label}.provenance.schemaVersion`).toBe("string");
    expect(typeof hud.provenance.generatedAt,    `${label}.provenance.generatedAt`).toBe("string");
  }
}

function assertWalletSummary(s: WalletSummary, label = "summary") {
  expect(typeof s.lastAnalyzedAt,           `${label}.lastAnalyzedAt`).toBe("string");
  expect(typeof s.realizedPnl,              `${label}.realizedPnl`).toBe("number");
  expect(typeof s.profitableTradesCount,    `${label}.profitableTradesCount`).toBe("number");
  expect(typeof s.totalTradesCount,         `${label}.totalTradesCount`).toBe("number");
  expect(s.currentSolBalance === null || typeof s.currentSolBalance === "number",
    `${label}.currentSolBalance is number|null`).toBe(true);
  expect(s.knownType  === null || typeof s.knownType  === "string", `${label}.knownType`).toBe(true);
  expect(s.knownLabel === null || typeof s.knownLabel === "string", `${label}.knownLabel`).toBe(true);
}

function assertWalletBehavior(b: WalletBehavior, label = "behavior") {
  expect(b.tradingStyle   === null || typeof b.tradingStyle   === "string", `${label}.tradingStyle`).toBe(true);
  expect(b.speedCategory  === null || typeof b.speedCategory  === "string", `${label}.speedCategory`).toBe(true);
  expect(b.exitPattern    === null || typeof b.exitPattern    === "string", `${label}.exitPattern`).toBe(true);
  expect(b.avgHoldTimeHours    === null || typeof b.avgHoldTimeHours    === "number", `${label}.avgHoldTimeHours`).toBe(true);
  expect(b.medianHoldTimeHours === null || typeof b.medianHoldTimeHours === "number", `${label}.medianHoldTimeHours`).toBe(true);
  expect(b.buySellRatio        === null || typeof b.buySellRatio        === "number", `${label}.buySellRatio`).toBe(true);
  expect(b.avgEntryMcapUsd === null || typeof b.avgEntryMcapUsd === "number", `${label}.avgEntryMcapUsd`).toBe(true);
  expect(b.typicalEntryMcapUsd === null || typeof b.typicalEntryMcapUsd === "number", `${label}.typicalEntryMcapUsd`).toBe(true);
  expect(b.entryMcapP25Usd === null || typeof b.entryMcapP25Usd === "number", `${label}.entryMcapP25Usd`).toBe(true);
  expect(b.entryMcapP75Usd === null || typeof b.entryMcapP75Usd === "number", `${label}.entryMcapP75Usd`).toBe(true);
  expect(b.dominantEntryMcapBucket === null || typeof b.dominantEntryMcapBucket === "string", `${label}.dominantEntryMcapBucket`).toBe(true);
  expect(b.dominantEntryMcapBucketShare === null || typeof b.dominantEntryMcapBucketShare === "number", `${label}.dominantEntryMcapBucketShare`).toBe(true);
}

function assertHolderProfile(p: HolderProfile, label = "profile") {
  expect(typeof p.walletAddress,   `${label}.walletAddress`).toBe("string");
  expect(typeof p.rank,            `${label}.rank`).toBe("number");
  expect(typeof p.supplyPercent,   `${label}.supplyPercent`).toBe("number");
  expect(typeof p.dataQualityTier, `${label}.dataQualityTier`).toBe("string");
  expect(typeof p.completedCycleCount, `${label}.completedCycleCount`).toBe("number");
  expect(typeof p.confidence,      `${label}.confidence`).toBe("number");
  expect(p.behaviorType  === null || typeof p.behaviorType  === "string", `${label}.behaviorType`).toBe(true);
  expect(p.exitPattern   === null || typeof p.exitPattern   === "string", `${label}.exitPattern`).toBe(true);
  expect(p.medianHoldTimeHours === null || typeof p.medianHoldTimeHours === "number", `${label}.medianHoldTimeHours`).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("CONTRACT: getWalletHud", () => {
  let client: SovaIntelClient;

  beforeAll(() => {
    client = new SovaIntelClient({
      baseUrl: BASE_URL,
      auth: { kind: "apikey", apiKey: API_KEY! },
      pollIntervalMs: 3000,
      maxPollAttempts: 20,
    });
  });

  it("returns a valid WalletHud shape from the live API", async () => {
    const hud = await client.getWalletHud(TEST_WALLET);
    assertWalletHud(hud);
    // walletAddress in the response must match what we requested
    expect(hud.walletAddress).toBe(TEST_WALLET);
  });
});

describe.skipIf(SKIP)("CONTRACT: getWalletProfile", () => {
  let client: SovaIntelClient;

  beforeAll(() => {
    client = new SovaIntelClient({
      baseUrl: BASE_URL,
      auth: { kind: "apikey", apiKey: API_KEY! },
      pollIntervalMs: 3000,
      maxPollAttempts: 20,
    });
  });

  it("returns a valid WalletProfileResponse shape from the live API", async () => {
    const profile: WalletProfileResponse = await client.getWalletProfile(TEST_WALLET);

    expect(profile.status).toBe("ok");
    expect(profile.walletAddress).toBe(TEST_WALLET);

    assertWalletSummary(profile.summary);

    if (profile.hud !== null) {
      assertWalletHud(profile.hud, "profile.hud");
    }

    if (profile.behavior !== null) {
      assertWalletBehavior(profile.behavior, "profile.behavior");
    }
  });
});

describe.skipIf(SKIP)("CONTRACT: pollHolderProfiles", () => {
  let client: SovaIntelClient;

  beforeAll(() => {
    client = new SovaIntelClient({
      baseUrl: BASE_URL,
      auth: { kind: "apikey", apiKey: API_KEY! },
      pollIntervalMs: 3000,
      maxPollAttempts: 40,
    });
  });

  it("returns a valid HolderProfilesResult shape from the live API", async () => {
    const result = await client.pollHolderProfiles<HolderProfilesResult>(TEST_MINT, 5);

    expect(typeof result.tokenMint,  "result.tokenMint").toBe("string");
    expect(Array.isArray(result.profiles), "result.profiles is array").toBe(true);
    expect(result.profiles.length,   "at least 1 profile").toBeGreaterThan(0);

    // Metadata shape
    const m = result.metadata;
    expect(typeof m.totalHoldersRequested,      "metadata.totalHoldersRequested").toBe("number");
    expect(typeof m.totalHoldersAnalyzed,        "metadata.totalHoldersAnalyzed").toBe("number");
    expect(typeof m.totalProcessingTimeMs,       "metadata.totalProcessingTimeMs").toBe("number");
    expect(typeof m.avgProcessingTimePerWalletMs,"metadata.avgProcessingTimePerWalletMs").toBe("number");

    // Validate first profile
    assertHolderProfile(result.profiles[0], "profiles[0]");
  });
});
