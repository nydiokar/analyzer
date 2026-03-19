"use client";

import React from 'react';
import { useEffect } from 'react';
import GlobalChat from '@/components/chat/GlobalChat';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function ChatPage() {
  const router = useRouter();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const isAuthorized = isInitialized && isAuthenticated && (!!user?.isAnalyst || !!user?.isAdmin);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthorized) {
      router.replace('/');
    }
  }, [isAuthorized, isInitialized, router]);

  if (!isAuthorized) return null;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border text-sm font-medium">Global Chat</div>
      <GlobalChat />
    </div>
  );
}


