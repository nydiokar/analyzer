"use client";

import { useEffect, useRef } from 'react';

export const useInfiniteScroll = (onLoadMore?: () => void, options?: IntersectionObserverInit) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || !onLoadMore) return;
    const el = ref.current;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          onLoadMore();
        }
      }
    }, { root: null, rootMargin: '800px 0px', threshold: 0, ...(options || {}) });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, options]);

  return ref;
};

