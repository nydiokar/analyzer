"use client";

import React from 'react';
import GlobalChat from '@/components/chat/GlobalChat';

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border text-sm font-medium">Global Chat</div>
      <GlobalChat />
    </div>
  );
}


