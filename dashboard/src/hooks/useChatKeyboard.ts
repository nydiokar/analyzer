"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

export type ChatKeyboardParams<T extends { id: string }> = {
  items: T[];
  openActionsFor: (messageId: string) => void;
  onReply: (messageId: string) => void;
  onTogglePin?: (messageId: string, nextIsPinned: boolean) => void;
  getIsPinned?: (messageId: string) => boolean;
  onWatchToggle?: () => void;
  options?: {
    initialSelected?: 'last' | 'first' | number;
    isTyping?: () => boolean;
    getRowEl?: (id: string) => HTMLElement | null;
  };
};

export function useChatKeyboard<T extends { id: string }>(params: ChatKeyboardParams<T>) {
  const { items, openActionsFor, onReply, onTogglePin, getIsPinned, onWatchToggle } = params;
  const { initialSelected = 'last', isTyping, getRowEl } = params.options || {};

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selectedId = useMemo(() => (selectedIndex != null ? items[selectedIndex]?.id : undefined), [items, selectedIndex]);

  // Initialize/rebase selection on items change
  useEffect(() => {
    if (!items.length) {
      setSelectedIndex(null);
      return;
    }
    if (typeof initialSelected === 'number') {
      const idx = Math.max(0, Math.min(items.length - 1, initialSelected));
      setSelectedIndex(idx);
    } else if (initialSelected === 'first') {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(items.length - 1);
    }
  }, [items.length, initialSelected]);

  const scrollToRow = useCallback((id?: string) => {
    if (!id) return;
    const el = (getRowEl ? getRowEl(id) : document.getElementById(`msg-${id}`));
    el?.scrollIntoView({ block: 'center' });
  }, [getRowEl]);

  const isSelected = useCallback((idx: number) => selectedIndex === idx, [selectedIndex]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!items.length) return;
    if (isTyping && isTyping()) return;

    // J next
    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      setSelectedIndex((idx) => {
        const next = idx == null ? items.length - 1 : Math.min(items.length - 1, idx + 1);
        scrollToRow(items[next]?.id);
        return next;
      });
      return;
    }

    // K prev
    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setSelectedIndex((idx) => {
        const curr = idx == null ? items.length - 1 : idx;
        const next = Math.max(0, curr - 1);
        scrollToRow(items[next]?.id);
        return next;
      });
      return;
    }

    // Enter: open actions
    if (e.key === 'Enter' && !e.shiftKey) {
      const idx = selectedIndex ?? (items.length - 1);
      const id = items[idx]?.id;
      if (id) {
        e.preventDefault();
        openActionsFor(id);
      }
      return;
    }

    // Q: quote-reply
    if (e.key.toLowerCase() === 'q') {
      const idx = selectedIndex ?? (items.length - 1);
      const id = items[idx]?.id;
      if (id) {
        e.preventDefault();
        onReply(id);
      }
      return;
    }

    // Alt+P: toggle pin
    if (e.altKey && e.key.toLowerCase() === 'p' && onTogglePin) {
      const idx = selectedIndex ?? (items.length - 1);
      const id = items[idx]?.id;
      if (id) {
        e.preventDefault();
        const curr = getIsPinned ? !!getIsPinned(id) : false;
        onTogglePin(id, !curr);
      }
      return;
    }

    // Alt+W: watch/unwatch (if provided)
    if (e.altKey && e.key.toLowerCase() === 'w' && onWatchToggle) {
      e.preventDefault();
      onWatchToggle();
      return;
    }
  }, [items, selectedIndex, isTyping, openActionsFor, onReply, onTogglePin, getIsPinned, onWatchToggle, scrollToRow]);

  const containerProps = useMemo(() => ({ tabIndex: 0, onKeyDown }), [onKeyDown]);

  return { containerProps, selectedIndex, selectedId, isSelected } as const;
}


