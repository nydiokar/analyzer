import { useState, useEffect, useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { formatAddress } from './utils/formatters';
import { fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import { createPortal } from 'react-dom';

type TimeBucket = 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position';

interface Props {
  walletAddress: string;
  timeBucket: TimeBucket;
  bucketLabel: string;
  anchor?: { x: number; y: number };
  isOpen: boolean;
  onClose: () => void;
}

interface ExitTimingTokensResponse {
  walletAddress: string;
  timeBucket: string;
  tokens: string[]; // Just mint addresses - TokenBadge handles metadata
  count: number;
}

const INITIAL_DISPLAY_LIMIT = 50;
const LOAD_MORE_INCREMENT = 50;

export function ExitTimingDrilldownPanel({
  walletAddress,
  timeBucket,
  bucketLabel,
  anchor,
  isOpen,
  onClose,
}: Props) {
  const [tokens, setTokens] = useState<string[]>([]);
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 40, y: 40 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number }>({ width: 640, height: 420 });
  const panelRef = useRef<HTMLDivElement | null>(null);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // ONE API call - just get token mints (fast, cached)
      const data: ExitTimingTokensResponse = await fetcher(
        `/wallets/${walletAddress}/exit-timing-tokens/${timeBucket}`
      );
      setTokens(data.tokens);
      // TokenBadge will handle enrichment automatically for each token
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error fetching exit timing tokens:', err);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, timeBucket]);

  useEffect(() => {
    if (isOpen && walletAddress && timeBucket) {
      fetchTokens();
      // Initialize panel position near the click anchor, clamped to viewport
      if (typeof window !== 'undefined') {
        const padding = 12;
        const targetX = anchor?.x ?? window.innerWidth / 2;
        const targetY = anchor?.y ?? window.innerHeight / 2;
        const width = Math.min(panelSize.width, window.innerWidth - padding * 2);
        const height = Math.min(panelSize.height, window.innerHeight - padding * 2);
        const clampedX = Math.min(Math.max(targetX - width / 2, padding), window.innerWidth - padding - width);
        const clampedY = Math.min(Math.max(targetY - 80, padding), window.innerHeight - padding - height);
        setPosition({ x: clampedX, y: clampedY });
      }
    } else {
      // Reset state when panel closes
      setTokens([]);
      setDisplayLimit(INITIAL_DISPLAY_LIMIT);
      setError(null);
      setIsDragging(false);
      setDragStart(null);
    }
  }, [isOpen, walletAddress, timeBucket, anchor, fetchTokens]);

  useEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        setPanelSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen]);

  const clampPosition = useCallback(
    (x: number, y: number) => {
      if (typeof window === 'undefined') return { x, y };
      const padding = 12;
      const width = Math.min(panelSize.width, window.innerWidth - padding * 2);
      const height = Math.min(panelSize.height, window.innerHeight - padding * 2);
      return {
        x: Math.min(Math.max(x, padding), window.innerWidth - padding - width),
        y: Math.min(Math.max(y, padding), window.innerHeight - padding - height),
      };
    },
    [panelSize.height, panelSize.width]
  );

  const handlePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    const target = e.target as HTMLElement;
    if (target?.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: ReactPointerEvent) => {
    if (!isDragging || !dragStart) return;
    const nextX = e.clientX - dragStart.x;
    const nextY = e.clientY - dragStart.y;
    const clamped = clampPosition(nextX, nextY);
    setPosition(clamped);
  };

  const handlePointerUp = (e: ReactPointerEvent) => {
    setIsDragging(false);
    setDragStart(null);
    const target = e.target as HTMLElement;
    if (target?.releasePointerCapture) {
      target.releasePointerCapture(e.pointerId);
    }
  };

  if (!isOpen) return null;

  const visibleTokens = tokens.slice(0, displayLimit);
  const hasMore = displayLimit < tokens.length;

  const panel = (
    // Transparent overlay that doesn't block interactions
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
    className={cn(
      "absolute",
      "w-full",
      "bg-card border rounded-lg shadow-2xl",
      "overflow-hidden",
      "pointer-events-auto", // Re-enable pointer events for the panel itself
      "animate-in fade-in-0 zoom-in-95 duration-200"
    )}
        ref={panelRef}
        style={{
          top: position.y,
          left: position.x,
          transform: 'none',
          width: tokens.length > 50 ? 'min(600px, calc(100vw - 24px))' : 'min(720px, calc(100vw - 24px))',
          maxHeight: tokens.length > 50 ? '70vh' : '80vh',
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
  >
    {/* Header */}
    <div
          className="sticky top-0 bg-card border-b px-6 py-4 flex items-start justify-between z-10 cursor-move select-none"
          onPointerDown={handlePointerDown}
        >
          <div>
            <h3 className="text-lg font-semibold">Exit Timing: {bucketLabel}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tokens exited by {formatAddress(walletAddress)} in {bucketLabel} time range
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="overflow-y-auto max-h-[calc(80vh-100px)] p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-muted-foreground">Loading tokens...</div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm text-red-500">Error: {error}</p>
            </div>
          )}

          {!loading && !error && tokens.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">No tokens found in this time range</p>
            </div>
          )}

          {!loading && !error && tokens.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {tokens.length} token{tokens.length === 1 ? '' : 's'} in this cohort
                {hasMore && ` (showing ${displayLimit})`}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {visibleTokens.map((mint) => (
                  <div
                    key={mint}
                    className="p-2 rounded-md border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <TokenBadge mint={mint} size="sm" />
                  </div>
                ))}
              </div>

              {/* Load More Button */}
              {hasMore && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => setDisplayLimit(prev => Math.min(prev + LOAD_MORE_INCREMENT, tokens.length))}
                    className="px-4 py-2 text-sm font-medium rounded-md border bg-card hover:bg-muted transition-colors"
                  >
                    Load {Math.min(LOAD_MORE_INCREMENT, tokens.length - displayLimit)} More
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : null;
}
