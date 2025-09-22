"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetcher } from '@/lib/fetcher';

export default function MessagePermalinkPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = params.id;

  useEffect(() => {
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

