"use client";

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import WatchedTokenList from '@/components/tokens/WatchedTokenList';
import GlobalChat from '@/components/chat/GlobalChat';
import TokenThread from '@/components/chat/TokenThread';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRouter, useSearchParams } from 'next/navigation';

export default function TokensPage() {
  return (
    <Suspense fallback={<div className="p-3 text-sm">Loading...</div>}>
      <TokensPageInner />
    </Suspense>
  );
}

function TokensPageInner() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const isXL = useMediaQuery('(min-width: 1280px)');
  const router = useRouter();
  const search = useSearchParams();

  // Reflect query params ?view=token&addr=...&mid=...
  const qpView = search.get('view');
  const qpAddr = search.get('addr');
  const qpMid = search.get('mid');

  // Sync selected token with URL hash #thread=<addr> and query params
  useEffect(() => {
    const readHash = () => {
      const h = (typeof window !== 'undefined' ? window.location.hash : '') || '';
      const m = h.match(/^#thread=([^&]+)/);
      const addr = m?.[1] ? decodeURIComponent(m[1]) : null;
      if (addr) setSelectedToken(addr);
    };
    // Prefer query params; fallback to hash once on mount
    if (qpView === 'token' && qpAddr) {
      setSelectedToken(qpAddr);
    } else {
      readHash();
    }
    const onHash = () => readHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [qpAddr, qpView]);

  const handleSelect = useCallback((addr: string) => {
    // Shallow push query params; keep hash for backward compat
    router.push(`/tokens?view=token&addr=${encodeURIComponent(addr)}${qpMid ? `&mid=${encodeURIComponent(qpMid)}` : ''}`, { scroll: false });
    if (typeof window !== 'undefined') {
      window.location.hash = `#thread=${encodeURIComponent(addr)}`;
    }
    setSelectedToken(addr);
  }, [qpMid, router]);

  return (
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-background">
      <div className="h-full grid grid-cols-1 xl:grid-cols-[minmax(300px,0.33fr)_minmax(320px,0.34fr)_minmax(0,0.33fr)] 2xl:grid-cols-[minmax(340px,0.33fr)_minmax(360px,0.34fr)_minmax(0,0.33fr)] gap-0 overflow-hidden">
        {/* Left: Global chat */}
        <section className="order-1 flex min-h-0 flex-col border-b border-border/60 xl:border-b-0 xl:border-r bg-[#0E0E12] text-white/80" aria-label="Global chat panel">
          <div className="px-4 py-3 border-b border-white/5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">Global Chat</div>
          <div className="flex-1 min-h-0">
            <GlobalChat surface="global-pane" />
          </div>
        </section>

        {/* Middle: Tokens anchor */}
        <section className="order-2 flex min-h-0 flex-col bg-[#14141B] border-b border-border/60 xl:border-x xl:border-border/60 text-foreground" aria-label="Watched tokens">
          <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold tracking-tight text-white/80">Tokens</div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <WatchedTokenList onSelect={handleSelect} selectedToken={selectedToken ?? undefined} />
          </div>
        </section>

        {/* Right: Token thread */}
        <aside
          className={`order-3 hidden xl:flex h-full min-h-0 flex-col overflow-hidden border-l border-border/60 bg-[#181820] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${selectedToken ? '' : 'opacity-60'}`}
          aria-label="Token thread drawer"
        >
          {selectedToken ? (
            <TokenThread tokenAddress={selectedToken} highlightId={qpMid || undefined} />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground/80 p-6">
              Select a token to open its thread
            </div>
          )}
        </aside>
      </div>

      {/* Mobile/tablet: fall back to modal for the token thread */}
      <Dialog
        open={!!selectedToken && !isXL}
        onOpenChange={(open) => {
          if (!open) {
            if (typeof window !== 'undefined') {
              window.location.hash = '';
            }
            setSelectedToken(null);
          }
        }}
      >
        <DialogContent className="xl:hidden max-w-3xl w-full p-0 sm:max-w-3xl sm:rounded-lg rounded-none h-[100dvh] sm:h-auto bg-[#181820] text-foreground">
          <DialogTitle className="sr-only">Token Thread</DialogTitle>
          {selectedToken ? <TokenThread tokenAddress={selectedToken} highlightId={qpMid || undefined} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}


