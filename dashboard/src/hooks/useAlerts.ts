"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import { useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface TokenAlert {
  id: string;
  userId: string;
  tokenAddress: string;
  label?: string;
  condition: any;
  channels: string[];
  isActive: boolean;
  lastTriggeredAt?: string;
  triggerCount: number;
  cooldownMinutes: number;
  createdAt: string;
  TokenInfo?: {
    symbol?: string;
    name?: string;
    priceUsd?: string;
  };
}

export interface AlertNotification {
  id: string;
  alertId: string;
  userId: string;
  triggeredAt: string;
  snapshot: any;
  isRead: boolean;
  readAt?: string;
  Alert: TokenAlert;
}

export const useAlerts = (userId: string, tokenAddress?: string) => {
  const key = [`/alerts?userId=${userId}${tokenAddress ? `&tokenAddress=${tokenAddress}` : ''}`];
  const { data, error, isLoading, mutate } = useSWR<TokenAlert[]>(key, ([url]) => fetcher(url), {
    revalidateOnFocus: false,
  });

  return { data: data ?? [], error, isLoading, mutate };
};

export const useNotifications = (userId: string, unreadOnly = false) => {
  const key = [`/alerts/notifications/list?userId=${userId}${unreadOnly ? '&unread=true' : ''}`];
  const { data, error, isLoading, mutate } = useSWR<AlertNotification[]>(key, ([url]) => fetcher(url), {
    revalidateOnFocus: false,
  });

  return { data: data ?? [], error, isLoading, mutate };
};

export const createAlert = async (data: {
  userId: string;
  tokenAddress: string;
  label?: string;
  condition: any;
  channels?: string[];
  cooldownMinutes?: number;
}) => {
  return fetcher('/alerts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateAlert = async (alertId: string, data: {
  label?: string;
  isActive?: boolean;
  condition?: any;
  cooldownMinutes?: number;
}) => {
  return fetcher(`/alerts/${alertId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
};

export const deleteAlert = async (alertId: string) => {
  return fetcher(`/alerts/${alertId}`, {
    method: 'DELETE',
  });
};

export const markNotificationRead = async (notificationId: string) => {
  return fetcher(`/alerts/notifications/${notificationId}/read`, {
    method: 'PATCH',
  });
};

export const markAllNotificationsRead = async (userId: string) => {
  return fetcher(`/alerts/notifications/read-all?userId=${userId}`, {
    method: 'PATCH',
  });
};

// Socket hook for real-time alert notifications
export const useAlertSocket = (userId: string, onAlertTriggered?: (payload: any) => void) => {
  const socketRef = useRef<Socket | null>(null);
  const callbackRef = useRef(onAlertTriggered);

  callbackRef.current = onAlertTriggered;

  useEffect(() => {
    if (!userId) return;

    // Create socket connection
    const socket: Socket = io(process.env.NEXT_PUBLIC_WEBSOCKET_URL || '', {
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
    });

    socketRef.current = socket;

    const handleAlertTriggered = (payload: any) => {
      console.log('[Alert Socket] Alert triggered:', payload);
      callbackRef.current?.(payload);
    };

    // Listen for user-specific alert events
    const eventName = `user:${userId}:alert`;
    socket.on(eventName, handleAlertTriggered);

    socket.on('connect', () => {
      console.log('[Alert Socket] Connected');
    });

    socket.on('disconnect', () => {
      console.log('[Alert Socket] Disconnected');
    });

    return () => {
      socket.off(eventName, handleAlertTriggered);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  return socketRef;
};
