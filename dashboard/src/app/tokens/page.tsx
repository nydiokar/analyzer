"use client";

import React, { useState } from 'react';
import WatchedTokenList from '@/components/tokens/WatchedTokenList';
import GlobalChat from '@/components/chat/GlobalChat';
import TokenThread from '@/components/chat/TokenThread';

export default function TokensPage() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border text-sm font-medium">Watched Tokens</div>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 h-full">
        <div className="border-r border-border overflow-auto">
          <WatchedTokenList onSelect={setSelectedToken} />
        </div>
        <div className="h-full flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto border-b border-border">
            <GlobalChat />
          </div>
          <div className="h-1/2 min-h-[220px] overflow-auto">
            {selectedToken ? <TokenThread tokenAddress={selectedToken} /> : <div className="p-3 text-xs text-muted-foreground">Select a token to open its thread below. Global chat stays visible.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}


