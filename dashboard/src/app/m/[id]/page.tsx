"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetcher } from '@/lib/fetcher';

export default function MessagePermalinkPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    params.then((resolvedParams) => {
      setId(resolvedParams.id);
    });
  }, [params]);

  useEffect(() => {
    if (!id) return;
    
    let cancelled = false;
    (async () => {
      try {
        const msg = await fetcher(`/messages/${encodeURIComponent(id)}`);
        if (cancelled) return;
        // Find first token mention
        const tokenMention = Array.isArray(msg?.mentions)
          ? msg.mentions.find((m: any) => (m.kind === 'TOKEN' || m.kind === 'token') && m.refId)
          : null;
        const addr = tokenMention?.refId as string | undefined;
        if (addr) {
          router.replace(`/tokens?view=token&addr=${encodeURIComponent(addr)}&mid=${encodeURIComponent(id)}`);
        } else {
          router.replace('/tokens');
        }
      } catch {
        router.replace('/tokens');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return null;
}

