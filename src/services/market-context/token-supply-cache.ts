import { PrismaClient } from "@prisma/client";

/**
 * Token supply cache backed by the `TokenSupplyCache` Prisma table.
 *
 * IMPORTANT — integration note:
 * Inside the NestJS app, `TokenInfoService.getTokenSupply(mint)` already
 * handles supply fetching with a permanent Redis cache (no TTL) backed by
 * `HeliusApiClient.getTokenSupply()`. Prefer that path for live/online use.
 *
 * These functions are for the standalone backfill scripts and enrichment
 * engine, which run outside the NestJS DI container and need their own
 * direct-to-DB supply cache.
 */

/**
 * Fetch total supply for an SPL token mint via Solana RPC.
 * Uses HELIUS_RPC_URL env var — read inside the function to avoid
 * capturing undefined at module load time.
 */
export async function fetchTokenSupply(
  mintAddress: string
): Promise<{ totalSupply: number; decimals: number } | null> {
  const heliusRpcUrl = process.env.HELIUS_RPC_URL;
  if (!heliusRpcUrl) {
    throw new Error("HELIUS_RPC_URL env var is not set");
  }

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenSupply",
    params: [mintAddress],
  };

  const res = await fetch(heliusRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn(`Helius RPC returned ${res.status} for mint ${mintAddress}`);
    return null;
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    console.warn(`Helius RPC returned non-JSON for mint ${mintAddress}`);
    return null;
  }

  if (data.error) {
    console.warn(`RPC error for ${mintAddress}: ${data.error.message}`);
    return null;
  }

  const supply = data.result?.value;
  // uiAmount is null when supply is 0 (burned token) — treat as unavailable
  if (!supply || supply.uiAmount == null) return null;

  return {
    totalSupply: supply.uiAmount,
    decimals: supply.decimals,
  };
}

/**
 * Ensure supplies are cached for all provided mint addresses.
 * Fetches missing mints in sequence with a polite 50ms delay between calls.
 * Only mints absent from `TokenSupplyCache` are fetched — existing ones are skipped.
 */
export async function ensureSuppliesCached(
  prisma: PrismaClient,
  mintAddresses: string[]
): Promise<number> {
  const uniqueMints = [...new Set(mintAddresses)];
  if (uniqueMints.length === 0) return 0;

  // Single query to find everything we already have
  const existing = await prisma.tokenSupplyCache.findMany({
    where: { mint: { in: uniqueMints } },
    select: { mint: true },
  });
  const existingMints = new Set(existing.map((r) => r.mint));

  const missing = uniqueMints.filter((m) => !existingMints.has(m));
  if (missing.length === 0) return 0;

  console.log(`Fetching supply for ${missing.length} new tokens...`);
  let fetched = 0;

  for (const mint of missing) {
    try {
      const result = await fetchTokenSupply(mint);
      if (result) {
        await prisma.tokenSupplyCache.create({
          data: {
            mint,
            totalSupply: result.totalSupply,
            decimals: result.decimals,
          },
        });
        fetched++;
      }
    } catch (err: any) {
      console.warn(`Failed to fetch supply for ${mint.slice(0, 12)}...: ${err.message}`);
    }

    // Rate limit: Helius free tier is generous but be polite
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`Token supply cache: fetched ${fetched} new tokens.`);
  return fetched;
}

/**
 * Load supplies for a set of mints in a single DB query.
 * Returns a Map<mint, totalSupply>. Mints not in cache are absent from the map.
 * Use this inside batch loops to avoid N+1 DB queries.
 */
export async function buildSupplyMap(
  prisma: PrismaClient,
  mints: string[]
): Promise<Map<string, number>> {
  if (mints.length === 0) return new Map();

  const uniqueMints = [...new Set(mints)];
  const rows = await prisma.tokenSupplyCache.findMany({
    where: { mint: { in: uniqueMints } },
    select: { mint: true, totalSupply: true },
  });

  return new Map(rows.map((r) => [r.mint, r.totalSupply]));
}

/**
 * Get cached supply for a single mint. Returns null if not cached.
 * Prefer `buildSupplyMap()` when resolving multiple mints to avoid N+1.
 */
export async function getTokenSupply(
  prisma: PrismaClient,
  mint: string
): Promise<number | null> {
  const cached = await prisma.tokenSupplyCache.findUnique({
    where: { mint },
  });
  return cached?.totalSupply ?? null;
}
