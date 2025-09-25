"use client";

import React from 'react';
import TokenThread from '@/components/chat/TokenThread';
import { useParams } from 'next/navigation';

export default function TokenChatPage() {
  const params = useParams();
  const tokenAddress = (params?.tokenAddress as string) ?? '';
  if (!tokenAddress) return <div className="p-3">Missing token address.</div>;
  return (
    <div className="h-full min-h-0 flex flex-col">
      <TokenThread tokenAddress={tokenAddress} />
    </div>
  );
}


