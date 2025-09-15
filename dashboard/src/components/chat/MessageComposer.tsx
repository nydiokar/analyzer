"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { parseMentionsClient, extractUnresolvedSymbols, mentionNamespaces } from '@/lib/mention-grammar';
import { postMessage } from '@/hooks/useMessages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface MessageComposerProps {
  onPosted?: () => void;
  tokenAddress?: string; // optional scope for token thread
}

export default function MessageComposer({ onPosted, tokenAddress }: MessageComposerProps) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mentions = useMemo(() => parseMentionsClient(text), [text]);
  const unresolvedSymbols = useMemo(() => extractUnresolvedSymbols(text), [text]);

  const canSubmit = text.trim().length > 0 && unresolvedSymbols.length === 0 && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
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
  }, [canSubmit, onPosted, text, tokenAddress]);

  return (
    <div className="w-full border-t border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tokenAddress ? `Discuss token ${tokenAddress.slice(0,4)}… use @meta:, @risk:` : "Share insight… use @ca:, @sym:, @meta:"}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <Button disabled={!canSubmit} onClick={handleSubmit}>
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
        Tips: {mentionNamespaces.map((n) => n.example).join('  •  ')}
      </div>
    </div>
  );
}


