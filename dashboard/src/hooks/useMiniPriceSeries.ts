"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetcher } from '@/lib/fetcher';

export function useMiniPriceSeries(tokenAddress: string, points: number = 24) {
  const [series, setSeries] = useState<number[]>([]);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    let aborted = false;
    async function load() {
      if (!tokenAddress) return;
      try {
        const res = await fetcher(`/token-info/${encodeURIComponent(tokenAddress)}/sparkline?points=${points}`);
        const pts = (res?.points as Array<[number, number]> | undefined) || [];
        if (aborted) return;
        setSeries(pts.map(([, p]) => p));
        loadedForRef.current = tokenAddress;
      } catch {
        // ignore
      }
    }
    // fetch once on token change
    load();
    return () => { aborted = true; };
  }, [tokenAddress, points]);

  // Intentionally no websocket dependency here to avoid duplicate connections.

  // derive trend color
  const trend = useMemo(() => {
    if (series.length < 2) return 0;
    return Math.sign(series[series.length - 1] - series[0]);
  }, [series]);

  return { series, trend } as const;
}
