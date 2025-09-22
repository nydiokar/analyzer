"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { parseMentionsClient, extractUnresolvedSymbols, mentionNamespaces, extractBareSymbols } from '@/lib/mention-grammar';
import { postMessage } from '@/hooks/useMessages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
// SymbolResolverModal intentionally not used. We auto-resolve bare @SYMBOL on submit for convenience.

interface MessageComposerProps {
  onPosted?: () => void;
  tokenAddress?: string; // optional scope for token thread
}

export default function MessageComposer({ onPosted, tokenAddress }: MessageComposerProps) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mentions = useMemo(() => parseMentionsClient(text), [text]);
  const unresolvedSymbols = useMemo(() => extractUnresolvedSymbols(text), [text]);
  const bareSymbols = useMemo(() => extractBareSymbols(text), [text]);

  const canSubmit = text.trim().length > 0 && unresolvedSymbols.length === 0 && !isSubmitting;

  // No modal; we resolve inline on submit when a unique match exists.

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    // If there are bare symbols like @FARTCOIN, try to resolve the first one inline
    if (bareSymbols.length > 0) {
      const sym = bareSymbols[0];
      const results = await fetcher(`/messages/resolve/symbol?sym=${encodeURIComponent(sym)}`);
      if (Array.isArray(results) && results.length === 1) {
        const address = results[0].tokenAddress as string;
        const re = new RegExp(`@${sym}\\b`, 'i');
        const next = text.trim().replace(re, `@ca:${address}`);
        await postMessage(tokenAddress && !next.includes(`@ca:${tokenAddress}`) ? `@ca:${tokenAddress} ${next}` : next);
        setText('');
        onPosted?.();
        setIsSubmitting(false);
        return;
      }
      // Ambiguous or not found → show a small inline hint and abort
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(true);
    try {
      const base = text.trim();
      const withScope = tokenAddress && !base.includes(`@ca:${tokenAddress}`)
        ? `@ca:${tokenAddress} ${base}`
        : base;
      await postMessage(withScope);
      setText('');
      onPosted?.();
    } finally {
      setIsSubmitting(false);
    }
  }, [bareSymbols, canSubmit, onPosted, text, tokenAddress]);

  return (
    <div className="w-full border-t border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tokenAddress ? `Discuss token ${tokenAddress.slice(0,4)}… use @meta:, @risk:` : "Share insight… use @ca:, @sym:, @meta:"}
          aria-label={tokenAddress ? `Message input for token ${tokenAddress}` : 'Global message input'}
          onKeyDown={(e) => {
            const isCmdEnter = (e.key === 'Enter') && (e.metaKey || e.ctrlKey);
            if ((e.key === 'Enter' && !e.shiftKey) || isCmdEnter) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <Button disabled={!canSubmit} onClick={handleSubmit} aria-label="Post message">
          Post
        </Button>
      </div>
      {unresolvedSymbols.length > 0 && (
        <div className="text-xs text-yellow-500">
          Resolve symbol before posting: {unresolvedSymbols.map((s) => `@sym:${s}`).join(', ')}
        </div>
      )}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {mentions.map((m, idx) => (
            <span key={idx} className="px-2 py-1 rounded bg-muted">
              {m.rawValue}
            </span>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        Tips: {mentionNamespaces.map((n) => n.example).join('  •  ')}  •  Ctrl/⌘+Enter to send
      </div>

      {/* Symbol Resolver Modal */}
      {/* No resolver modal; handled inline on submit. */}
    </div>
  );
}


