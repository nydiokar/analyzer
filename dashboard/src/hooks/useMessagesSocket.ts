"use client";

import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface Options {
  tokenAddress?: string;
  onMessageCreated?: (payload: { id: string; createdAt: string }) => void;
  onMessageEdited?: (payload: { id: string; body: string; updatedAt: string }) => void;
}

export const useMessagesSocket = ({ tokenAddress, onMessageCreated, onMessageEdited }: Options) => {
  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || '';
    const socket: Socket = io(baseUrl, {
      path: '/socket.io/messages',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    const handleConnect = () => {
      if (tokenAddress) {
        socket.emit('join-token-thread', { tokenAddress });
      } else {
        socket.emit('join-global');
      }
    };

    const handleMessageCreated = (payload: any) => {
      onMessageCreated?.(payload);
    };
    const handleMessageEdited = (payload: any) => {
      onMessageEdited?.(payload);
    };

    socket.on('connect', handleConnect);
    socket.on('message.created', handleMessageCreated);
    socket.on('message.edited', handleMessageEdited);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('message.created', handleMessageCreated);
      socket.off('message.edited', handleMessageEdited);
      socket.disconnect();
    };
  }, [onMessageCreated, onMessageEdited, tokenAddress]);
};


