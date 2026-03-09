'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function RadarPage() {
  const router = useRouter();
  const { user, isAuthenticated, isInitialized } = useAuth();

  useEffect(() => {
    if (!isInitialized) return;

    if (!isAuthenticated) {
      router.replace('/');
      return;
    }

    if (!user?.isAnalyst && !user?.isAdmin) {
      router.replace('/');
    }
  }, [isInitialized, isAuthenticated, user, router]);

  // Show nothing while auth initializes or access check is pending
  if (!isInitialized || !isAuthenticated || (!user?.isAnalyst && !user?.isAdmin)) {
    return null;
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <h1 className="text-2xl font-semibold">Holdings Radar</h1>
      </div>
      <p className="text-muted-foreground">Loading radar feed…</p>
    </div>
  );
}
