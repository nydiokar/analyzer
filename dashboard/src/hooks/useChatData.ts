"use client";

import { useGlobalMessages, useTokenMessages } from '@/hooks/useMessages';
import type { MessageDto } from '@/hooks/useMessages';
import type { Scope } from '@/chat/types';

type DataShape<T> = {
  data?: { items: T[]; nextCursor: string | null } | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
  loadMore?: () => void;
  setCursor?: (cursor: string | null) => void;
};

export function useChatData(scope: Scope, pageSize: number = 50): DataShape<MessageDto> {
  if (scope.kind === 'global') {
    const { data, isLoading, error, mutate, loadMore, setCursor } = useGlobalMessages(pageSize);
    return { data, isLoading, error, mutate, loadMore, setCursor } as const;
  }
  const { data, isLoading, error, mutate, loadMore, setCursor } = useTokenMessages(scope.tokenAddress, pageSize);
  return { data, isLoading, error, mutate, loadMore, setCursor } as const;
}


