"use client";

import { useEffect, useState } from 'react';

export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setMatches('matches' in e ? e.matches : (e as MediaQueryList).matches);
    // Initial sync
    setMatches(mql.matches);
    const listener = (e: MediaQueryListEvent) => handler(e);
    if (mql.addEventListener) mql.addEventListener('change', listener);
    else mql.addListener(listener);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', listener);
      else mql.removeListener(listener);
    };
  }, [query]);

  return matches;
};

