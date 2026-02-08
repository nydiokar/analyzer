'use client';

import { ReactNode } from 'react';
import { FavoriteModalProvider } from '@/providers/FavoriteModalProvider';

/**
 * Client-side providers wrapper
 * This wraps the entire app with client-only providers
 */
export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <FavoriteModalProvider>
      {children}
    </FavoriteModalProvider>
  );
}
