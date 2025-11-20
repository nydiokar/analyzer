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
  const [filter, setFilter] = useState('');
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

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
        const defaultWidth = Math.min(tokens.length > 50 ? 640 : 720, window.innerWidth - padding * 2);
        const defaultHeight = Math.min(540, window.innerHeight - padding * 2);
        setPanelSize({ width: defaultWidth, height: defaultHeight });
        const clampedX = Math.min(Math.max(targetX - defaultWidth / 2, padding), window.innerWidth - padding - defaultWidth);
        const clampedY = Math.min(Math.max(targetY - 80, padding), window.innerHeight - padding - defaultHeight);
        setPosition({ x: clampedX, y: clampedY });
      }
    } else {
      // Reset state when panel closes
      setTokens([]);
      setDisplayLimit(INITIAL_DISPLAY_LIMIT);
      setError(null);
      setIsDragging(false);
      setDragStart(null);
      setFilter('');
      setIsResizing(false);
      setResizeStart(null);
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
    if (isResizing && resizeStart) {
      const padding = 12;
      const minWidth = 360;
      const minHeight = 320;
      const maxWidth = typeof window !== 'undefined' ? window.innerWidth - padding * 2 : resizeStart.width;
      const maxHeight = typeof window !== 'undefined' ? window.innerHeight - padding * 2 : resizeStart.height;
      const nextWidth = Math.min(Math.max(resizeStart.width + (e.clientX - resizeStart.x), minWidth), maxWidth);
      const nextHeight = Math.min(Math.max(resizeStart.height + (e.clientY - resizeStart.y), minHeight), maxHeight);
      setPanelSize({ width: nextWidth, height: nextHeight });
      const clamped = clampPosition(position.x, position.y);
      setPosition(clamped);
      return;
    }
    if (!isDragging || !dragStart) return;
    const nextX = e.clientX - dragStart.x;
    const nextY = e.clientY - dragStart.y;
    const clamped = clampPosition(nextX, nextY);
    setPosition(clamped);
  };

  const handlePointerUp = (e: ReactPointerEvent) => {
    setIsDragging(false);
    setIsResizing(false);
    setDragStart(null);
    const target = e.target as HTMLElement;
    if (target?.releasePointerCapture) {
      target.releasePointerCapture(e.pointerId);
    }
  };

  const handleResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({ x: e.clientX, y: e.clientY, width: panelSize.width, height: panelSize.height });
    const target = e.target as HTMLElement;
    if (target?.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }
  };

  if (!isOpen) return null;

  const visibleTokens = tokens.slice(0, displayLimit);
  const filteredTokens = filter
    ? tokens.filter((mint) => mint.toLowerCase().includes(filter.toLowerCase()))
    : tokens;
  const visibleFilteredTokens = filteredTokens.slice(0, displayLimit);
  const hasMore = displayLimit < filteredTokens.length;

  const panel = (
    // Transparent overlay that doesn't block interactions
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        className={cn(
          "absolute",
          "w-full",
          "rounded-lg shadow-2xl border border-primary/30 bg-slate-950/90 backdrop-blur-xl",
          "before:content-[''] before:absolute before:inset-0 before:-z-10 before:rounded-lg before:bg-primary/15 before:blur-3xl before:opacity-60 before:pointer-events-none",
          "after:content-[''] after:absolute after:inset-px after:rounded-lg after:border after:border-white/5 after:pointer-events-none",
          "overflow-hidden",
          "pointer-events-auto", // Re-enable pointer events for the panel itself
          "animate-in fade-in-0 zoom-in-95 duration-200"
        )}
        ref={panelRef}
        style={{
          top: position.y,
          left: position.x,
          transform: 'none',
          width: `${panelSize.width}px`,
          height: `${panelSize.height}px`,
          maxHeight: '90vh',
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
            <p className="text-xs text-muted-foreground mt-1">
              {filteredTokens.length} tokens in this cohort{filteredTokens.length !== tokens.length ? ` (filtered from ${tokens.length})` : ''}{hasMore ? ` – showing ${visibleFilteredTokens.length}` : ''}
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
        <div className="overflow-y-auto max-h-[calc(80vh-100px)] p-4 md:p-6 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setDisplayLimit(INITIAL_DISPLAY_LIMIT);
              }}
              placeholder="Filter by mint"
              className="h-9 w-full md:w-72 rounded-md border bg-input px-3 text-sm"
            />
          </div>

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

          {!loading && !error && filteredTokens.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                {filter ? 'No tokens match this filter' : 'No tokens found in this time range'}
              </p>
            </div>
          )}

          {!loading && !error && filteredTokens.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {visibleFilteredTokens.map((mint) => (
                  <div
                    key={mint}
                    className="p-2 rounded-md border border-white/5 bg-slate-900/85 hover:bg-muted/60 transition-colors flex items-center gap-2"
                  >
                    <TokenBadge mint={mint} size="sm" />
                  </div>
                ))}
              </div>

              {/* Load More Button */}
              {hasMore && (
                <div className="sticky bottom-0 flex justify-center pt-2 pb-1 bg-card/80 backdrop-blur-sm">
                  <button
                    onClick={() => setDisplayLimit(prev => Math.min(prev + LOAD_MORE_INCREMENT, filteredTokens.length))}
                    className="px-4 py-2 text-sm font-medium rounded-md border bg-card hover:bg-muted transition-colors"
                  >
                    Load {Math.min(LOAD_MORE_INCREMENT, filteredTokens.length - displayLimit)} More
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="absolute bottom-2 right-2 h-4 w-4 rounded-sm border border-primary/60 bg-primary/30 cursor-nwse-resize"
          onPointerDown={handleResizePointerDown}
          title="Drag to resize"
        />
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : null;
}
