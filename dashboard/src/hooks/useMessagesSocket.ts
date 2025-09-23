"use client";

import { useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface Options {
  tokenAddress?: string;
  onMessageCreated?: (payload: { id: string; createdAt: string }) => void;
  onMessageEdited?: (payload: { id: string; body: string; updatedAt: string }) => void;
  onMessageDeleted?: (payload: { id: string; deletedAt: string }) => void;
  onMessagePinned?: (payload: { id: string; isPinned: boolean }) => void;
  onReactionUpdated?: (payload: { id: string; type: string; delta: 1|-1 }) => void;
}

export const useMessagesSocket = ({ tokenAddress, onMessageCreated, onMessageEdited, onMessageDeleted, onMessagePinned, onReactionUpdated }: Options) => {
  const socketRef = useRef<Socket | null>(null);

  // Keep latest callbacks in refs so listeners stay stable
  const createdRef = useRef<typeof onMessageCreated | undefined>(undefined);
  const editedRef = useRef<typeof onMessageEdited | undefined>(undefined);
  const deletedRef = useRef<typeof onMessageDeleted | undefined>(undefined);
  const pinnedRef = useRef<typeof onMessagePinned | undefined>(undefined);
  const reactionRef = useRef<typeof onReactionUpdated | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(tokenAddress);

  createdRef.current = onMessageCreated;
  editedRef.current = onMessageEdited;
  deletedRef.current = onMessageDeleted;
  pinnedRef.current = onMessagePinned;
  reactionRef.current = onReactionUpdated;
  tokenRef.current = tokenAddress;

  const connectionOptions = useMemo(() => ({
    baseUrl: process.env.NEXT_PUBLIC_WEBSOCKET_URL || '',
    path: '/socket.io/messages',
  }), []);

  // Establish a single socket connection for the lifetime of the component
  useEffect(() => {
    if (socketRef.current) return;
    const socket: Socket = io(connectionOptions.baseUrl, {
      path: connectionOptions.path,
      transports: ['websocket'], // avoid long-polling noise
      withCredentials: true,
    });
    socketRef.current = socket;

    const handleConnect = () => {
      const curr = tokenRef.current;
      if (curr) {
        socket.emit('join-token-thread', { tokenAddress: curr });
      } else {
        socket.emit('join-global');
      }
    };

    // Delegate to latest refs
    const handleMessageCreated = (payload: unknown) => createdRef.current?.(payload as any);
    const handleMessageEdited = (payload: unknown) => editedRef.current?.(payload as any);
    const handleMessageDeleted = (payload: unknown) => deletedRef.current?.(payload as any);
    const handleMessagePinned = (payload: unknown) => pinnedRef.current?.(payload as any);
    const handleReactionUpdated = (payload: unknown) => reactionRef.current?.(payload as any);

    socket.on('connect', handleConnect);
    socket.on('message.created', handleMessageCreated);
    socket.on('message.edited', handleMessageEdited);
    socket.on('message.deleted', handleMessageDeleted);
    socket.on('message.pinned', handleMessagePinned);
    socket.on('reaction.updated', handleReactionUpdated);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('message.created', handleMessageCreated);
      socket.off('message.edited', handleMessageEdited);
      socket.off('message.deleted', handleMessageDeleted);
      socket.off('message.pinned', handleMessagePinned);
      socket.off('reaction.updated', handleReactionUpdated);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [connectionOptions]);

  // When token changes, (re)join appropriate room without recreating socket
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (tokenAddress) {
      socket.emit('join-token-thread', { tokenAddress });
    } else {
      socket.emit('join-global');
    }
  }, [tokenAddress]);
};


