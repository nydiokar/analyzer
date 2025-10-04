"use client";

import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';

export interface CurrentUser {
  id: string;
  isDemo: boolean;
}

export const useCurrentUser = () => {
  const { data, error, isLoading } = useSWR<CurrentUser>('/users/me', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  return {
    user: data,
    userId: data?.id,
    isDemo: data?.isDemo ?? false,
    isLoading,
    error,
  };
};
