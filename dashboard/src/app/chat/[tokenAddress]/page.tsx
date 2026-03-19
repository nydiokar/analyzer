"use client";

import React, { useEffect } from 'react';
import TokenThread from '@/components/chat/TokenThread';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function TokenChatPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const isAuthorized = isInitialized && isAuthenticated && (!!user?.isAnalyst || !!user?.isAdmin);
  const tokenAddress = (params?.tokenAddress as string) ?? '';

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthorized) {
      router.replace('/');
    }
  }, [isAuthorized, isInitialized, router]);

  if (!isAuthorized) return null;
  if (!tokenAddress) return <div className="p-3">Missing token address.</div>;
  return (
    <div className="h-full min-h-0 flex flex-col">
      <TokenThread tokenAddress={tokenAddress} />
    </div>
  );
}


