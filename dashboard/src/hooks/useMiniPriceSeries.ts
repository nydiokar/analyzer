"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetcher } from '@/lib/fetcher';

export function useMiniPriceSeries(tokenAddress: string, points: number = 20, intervalMs: number = 60000) {
  const [series, setSeries] = useState<number[]>([]);
  const timerRef = useRef<number | null>(null);

  const fetchPrice = async () => {
    try {
      // Reuse token-info batch endpoint for current price; backend enriches price periodically
      const rows = await fetcher('/token-info', { method: 'POST', body: JSON.stringify({ tokenAddresses: [tokenAddress] }) });
      const priceStr = rows?.[0]?.priceUsd as string | undefined;
      const price = priceStr ? Number(priceStr) : NaN;
      if (!isFinite(price)) return;
      setSeries((prev) => {
        const next = prev.concat([price]);
        if (next.length > points) next.shift();
        return next.slice();
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!tokenAddress) return;
    // seed immediately
    fetchPrice();
    timerRef.current = (setInterval(fetchPrice, intervalMs) as unknown) as number;
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tokenAddress, intervalMs]);

  // derive trend color
  const trend = useMemo(() => {
    if (series.length < 2) return 0;
    return Math.sign(series[series.length - 1] - series[0]);
  }, [series]);

  return { series, trend } as const;
}
