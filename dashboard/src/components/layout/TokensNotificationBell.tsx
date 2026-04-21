"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Bell, MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useTokensNotifications, type TokensNotificationItem } from '@/hooks/useTokensNotifications';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface Props {
  enabled: boolean;
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function timeAgo(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NotificationRow({
  item,
  isUnread,
  now,
  onNavigate,
}: {
  item: TokensNotificationItem;
  isUnread: boolean;
  now: number;
  onNavigate: () => void;
}) {
  const isTokenAdded = item.kind === 'token_added';
  const href = item.tokenAddress
    ? `/tokens?view=token&addr=${encodeURIComponent(item.tokenAddress)}`
    : '/tokens';

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex gap-3 px-3 py-2.5 rounded-md transition-colors hover:bg-white/5 cursor-pointer',
        isUnread && 'bg-white/[0.03]',
      )}
    >
      <div className={cn(
        'mt-0.5 flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full',
        isTokenAdded ? 'bg-blue-500/15 text-blue-400' : 'bg-white/10 text-white/60',
      )}>
        {isTokenAdded ? <Plus className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-white/80 leading-snug">
          {isTokenAdded ? (
            <>
              New token added:{' '}
              <span className="font-mono text-white/60 text-[10px]">
                {item.tokenAddress
                  ? `${item.tokenAddress.slice(0, 6)}…${item.tokenAddress.slice(-4)}`
                  : ''}
              </span>
            </>
          ) : (
            <>
              {item.actor && (
                <span className="font-medium text-white/90">{item.actor}: </span>
              )}
              <span className="text-white/60">{item.snippet ?? '(empty message)'}</span>
            </>
          )}
        </p>
        <p className="text-[10px] text-white/30 mt-0.5">{timeAgo(item.createdAt, now)}</p>
      </div>

      {isUnread && (
        <div className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" />
      )}
    </Link>
  );
}

export function TokensNotificationBell({ enabled }: Props) {
  const [open, setOpen] = useState(false);
  const { items, unreadCount, markAllRead, lastClearedAt } = useTokensNotifications(enabled);
  const now = useNow(30_000);

  // Track whether there were unreads when the popover opened so the badge
  // stays visible while the list is being read, then clears on close.
  const hadUnreadsOnOpenRef = useRef(false);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      hadUnreadsOnOpenRef.current = unreadCount > 0;
    } else {
      // Mark read when the popover closes, not when it opens
      if (hadUnreadsOnOpenRef.current) {
        markAllRead();
      }
    }
    setOpen(next);
  };

  const handleRowNavigate = () => {
    if (hadUnreadsOnOpenRef.current) markAllRead();
    setOpen(false);
  };

  if (!enabled) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 hidden sm:flex"
          title="Tokens activity"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} unread`}
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-400 ring-1 ring-background"
            />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-2 bg-[#0E0E12] border-white/10 shadow-xl"
      >
        <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-white/5">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">
            Tokens Activity
          </span>
          {items.length > 0 && (
            <Link
              href="/tokens"
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              onClick={handleRowNavigate}
            >
              Open Tokens →
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/30">No activity yet</p>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-80 overflow-y-auto pr-0.5">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                isUnread={new Date(item.createdAt).getTime() > lastClearedAt}
                now={now}
                onNavigate={handleRowNavigate}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
