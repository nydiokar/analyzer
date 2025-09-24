"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetcher } from '@/lib/fetcher';

export default function PermalinkPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    async function go() {
      const id = params.id;
      try {
        const msg = await fetcher(`/messages/${encodeURIComponent(id)}`);
        if (aborted) return;
        let addr: string | null = null;
        const mentions = (msg?.mentions || []) as Array<{ kind?: string; refId?: string | null; rawValue?: string }>;
        const tokenMentions = mentions.filter((m) => (m.kind === 'TOKEN' || m.kind === 'token') && m.refId);
        if (tokenMentions.length > 0) {
          addr = tokenMentions[0]!.refId as string;
        } else if (typeof msg?.body === 'string') {
          const m = msg.body.match(/@ca:([1-9A-HJ-NP-Za-km-z]{32,44})/);
          if (m) addr = m[1];
        }
        if (addr) {
          router.replace(`/tokens?view=token&addr=${encodeURIComponent(addr)}&mid=${encodeURIComponent(id)}`, { scroll: false });
        } else {
          router.replace('/tokens', { scroll: false });
        }
      } catch (e) {
        if (aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        router.replace('/tokens', { scroll: false });
      }
    }
    go();
    return () => { aborted = true; };
  }, [params.id, router]);

  return (
    <div className="p-4 text-sm text-muted-foreground">Resolving link…{error ? ` (${error})` : ''}</div>
  );
}

