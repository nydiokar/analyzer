"use client";

import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface Options {
  tokenAddress?: string;
  onMessageCreated?: (payload: { id: string; createdAt: string }) => void;
  onMessageEdited?: (payload: { id: string; body: string; updatedAt: string }) => void;
  onMessageDeleted?: (payload: { id: string; deletedAt: string }) => void;
}

export const useMessagesSocket = ({ tokenAddress, onMessageCreated, onMessageEdited, onMessageDeleted }: Options) => {
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
    const handleMessageDeleted = (payload: any) => {
      onMessageDeleted?.(payload);
    };

    socket.on('connect', handleConnect);
    socket.on('message.created', handleMessageCreated);
    socket.on('message.edited', handleMessageEdited);
    socket.on('message.deleted', handleMessageDeleted);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('message.created', handleMessageCreated);
      socket.off('message.edited', handleMessageEdited);
      socket.off('message.deleted', handleMessageDeleted);
      socket.disconnect();
    };
  }, [onMessageCreated, onMessageEdited, onMessageDeleted, tokenAddress]);
};


