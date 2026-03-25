import { PrismaClient } from "@prisma/client";

const HELIUS_RPC = process.env.HELIUS_RPC_URL; // should already exist in your env

/**
 * Fetch total supply for an SPL token mint via Solana RPC.
 * Uses your existing Helius RPC — no additional cost.
 */
export async function fetchTokenSupply(
  mintAddress: string
): Promise<{ totalSupply: number; decimals: number } | null> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenSupply",
    params: [mintAddress],
  };

  const res = await fetch(HELIUS_RPC!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) {
    console.warn(`RPC error for ${mintAddress}: ${data.error.message}`);
    return null;
  }

  const supply = data.result?.value;
  if (!supply || !supply.uiAmount) return null;

  return {
    totalSupply: supply.uiAmount,
    decimals: supply.decimals,
  };
}

/**
 * Ensure supplies are cached for all provided mint addresses.
 * Only fetches mints not already in the cache.
 */
export async function ensureSuppliesCached(
  prisma: PrismaClient,
  mintAddresses: string[]
): Promise<number> {
  // Deduplicate
  const uniqueMints = [...new Set(mintAddresses)];

  // Find which ones we already have
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
 * Get cached supply for a mint. Returns null if not cached.
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
