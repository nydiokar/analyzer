"use client";

import { fetcher } from '@/lib/fetcher';
import type { TokenInfoRow } from '@/hooks/useTokenInfo';

type Cached = { row: TokenInfoRow; ts: number };

const cacheByMint = new Map<string, Cached>();
const pendingMints = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const waiters: Array<{ addrs: string[]; resolve: (rows: TokenInfoRow[]) => void; reject: (e: unknown) => void }> = [];

const DEBOUNCE_MS = 250;
const CACHE_TTL_MS = 5000; // keep small; server also refreshes frequently

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
  const batch = Array.from(pendingMints);
  pendingMints.clear();
  const localWaiters = waiters.splice(0, waiters.length);
  timer = null;

  try {
    if (batch.length > 0) {
      const rows = (await fetcher('/token-info', {
        method: 'POST',
        body: JSON.stringify({ tokenAddresses: batch }),
      })) as TokenInfoRow[];
      const now = Date.now();
      for (const r of rows || []) {
        cacheByMint.set(r.tokenAddress, { row: r, ts: now });
      }
    }
    // Resolve all waiters from cache
    const nowTs = Date.now();
    for (const w of localWaiters) {
      const out: TokenInfoRow[] = [];
      for (const a of w.addrs) {
        const c = cacheByMint.get(a);
        if (c && nowTs - c.ts <= CACHE_TTL_MS) {
          out.push(c.row);
        }
      }
      w.resolve(out);
    }
  } catch (e) {
    for (const w of localWaiters) w.reject(e);
  }
}

export async function aggregateTokenInfo(addrs: string[]): Promise<TokenInfoRow[]> {
  const addresses = Array.from(new Set((addrs || []).filter(Boolean)));
  if (addresses.length === 0) return [];

  const now = Date.now();
  const missing: string[] = [];
  for (const a of addresses) {
    const c = cacheByMint.get(a);
    if (!c || now - c.ts > CACHE_TTL_MS) missing.push(a);
  }

  if (missing.length === 0) {
    // All served from cache
    return addresses
      .map((a) => cacheByMint.get(a)!)
      .filter(Boolean)
      .map((c) => c.row);
  }

  for (const m of missing) pendingMints.add(m);
  return new Promise<TokenInfoRow[]>((resolve, reject) => {
    waiters.push({ addrs: addresses, resolve, reject });
    scheduleFlush();
  });
}

export function primeTokenInfoCache(rows: TokenInfoRow[]) {
  const now = Date.now();
  for (const r of rows || []) cacheByMint.set(r.tokenAddress, { row: r, ts: now });
}


