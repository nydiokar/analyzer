"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetcher } from '@/lib/fetcher';

export function useMiniPriceSeries(tokenAddress: string, points: number = 20, intervalMs: number = 60000) {
  const [series, setSeries] = useState<number[]>([]);
  const timerRef = useRef<number | null>(null);
  const visibleRef = useRef<boolean>(true);

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
    // Only poll when tab is visible to avoid waste
    const onVisibility = () => {
      visibleRef.current = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      if (visibleRef.current) {
        // fetch once on becoming visible
        void fetchPrice();
        if (!timerRef.current) timerRef.current = (setInterval(() => { if (visibleRef.current) void fetchPrice(); }, intervalMs) as unknown) as number;
      } else {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    // initial
    onVisibility();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [tokenAddress, intervalMs]);

  // derive trend color
  const trend = useMemo(() => {
    if (series.length < 2) return 0;
    return Math.sign(series[series.length - 1] - series[0]);
  }, [series]);

  return { series, trend } as const;
}
