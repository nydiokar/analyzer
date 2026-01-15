/**
 * WalletBadge - Universal wallet profile badge mirroring TokenBadge pattern
 *
 * - Layout variants: "card" (vertical 2-row) or "inline" (horizontal 2-row compact)
 * - All actions visible in both variants - no popovers needed
 * - Shows: address (clickable/copyable), trades (buy↑/sell↓), PnL (labeled), WR, last active
 * - Action icons inline: copy address, solscan link, profile link
 * - Size variants (s, m, l, xl) for fine-grained control
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Info, Wallet, User, Star, StarOff, Edit2 } from "lucide-react";
import { memo, MouseEvent } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { FavoriteWallet, type KnownWalletType } from "@/types/api";

export interface WalletMetrics {
  totalBuys?: number | null;
  totalSells?: number | null;
  winRatePercent?: number | null;
  lastActiveAt?: string | null;
}

type WalletBadgeSize = "s" | "m" | "l" | "xl" | "sm" | "md" | "lg";
type WalletBadgeVariant = "card" | "inline" | "minimal";

interface WalletBadgeProps {
  address: string;
  metrics?: WalletMetrics;
  className?: string;
  size?: WalletBadgeSize;
  variant?: WalletBadgeVariant;
  showMetrics?: boolean;
  showActions?: boolean;
  isFavorite?: boolean;
  onFavoriteToggle?: () => void;
  onEdit?: () => void;
  favoriteData?: FavoriteWallet;
  /** Known wallet type from registry (e.g., BURN, LP, JUPITER). Accepts string for flexibility. */
  knownType?: string | KnownWalletType;
  /** Display label for known wallets (e.g., "🔥 Burn Address") */
  knownLabel?: string;
}

const sizeConfig = {
  s: {
    avatar: "h-7 w-7",
    padding: "px-2.5 py-1.25",
    gap: "gap-2",
    address: "text-sm",
    metric: "text-xs",
    icon: "h-3 w-3",
    actionsGap: "gap-1.5",
  },
  m: {
    avatar: "h-8 w-8",
    padding: "px-3 py-1.75",
    gap: "gap-2.5",
    address: "text-base",
    metric: "text-sm",
    icon: "h-3.5 w-3.5",
    actionsGap: "gap-2",
  },
  l: {
    avatar: "h-9 w-9",
    padding: "px-3.5 py-2",
    gap: "gap-3",
    address: "text-lg",
    metric: "text-base",
    icon: "h-4 w-4",
    actionsGap: "gap-2.5",
  },
  xl: {
    avatar: "h-12 w-12",
    padding: "px-4 py-2.5",
    gap: "gap-4",
    address: "text-xl",
    metric: "text-lg",
    icon: "h-4 w-4",
    actionsGap: "gap-3",
  },
} satisfies Record<
  "s" | "m" | "l" | "xl",
  {
    avatar: string;
    padding: string;
    gap: string;
    address: string;
    metric: string;
    icon: string;
    actionsGap: string;
  }
>;

const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const formatLastActive = (isoString?: string | null) => {
  if (!isoString) return { text: "No activity", tooltip: null };
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return { text: "No activity", tooltip: null };

  const distance = formatDistanceToNow(date, { addSuffix: false });
  // Shorten distance for compact display
  const shortDistance = distance
    .replace(" seconds", "s")
    .replace(" second", "s")
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" days", "d")
    .replace(" day", "d")
    .replace(" months", "mo")
    .replace(" month", "mo")
    .replace("about ", "~");

  return {
    text: shortDistance,
    tooltip: format(date, "PPpp"),
  };
};

const WalletBadge = memo(({
  address,
  metrics,
  className,
  size = "m",
  variant = "inline",
  showMetrics = true,
  showActions = true,
  isFavorite = false,
  onFavoriteToggle,
  onEdit,
  favoriteData,
  knownType,
  knownLabel,
}: WalletBadgeProps) => {
  // Normalize knownType - accept string for flexibility, validate internally
  const normalizedKnownType: KnownWalletType | undefined = knownType && 
    (['BURN', 'LP', 'RAYDIUM', 'ORCA', 'JUPITER', 'PROTOCOL', 'EXCHANGE', 'SYSTEM'] as const).includes(knownType as KnownWalletType)
      ? (knownType as KnownWalletType)
      : undefined;
  
  // Check if this is a known/system wallet that shouldn't show trading metrics
  const isKnownWallet = Boolean(normalizedKnownType || knownLabel);
  const shouldDimMetrics = isKnownWallet;
  const displayLabel = favoriteData?.nickname ?? knownLabel ?? truncateAddress(address);
  const showSecondaryLabel = Boolean(favoriteData?.nickname || knownLabel);
  const secondaryLabel = showSecondaryLabel ? truncateAddress(address) : null;
  const isKnownLabelOnly = Boolean(knownLabel) && !favoriteData?.nickname;

  const normalizedSize =
    size === "sm" ? "s" : size === "md" ? "m" : size === "lg" ? "l" : size;
  const resolvedSize = sizeConfig[normalizedSize as keyof typeof sizeConfig] ?? sizeConfig.m;

  // Extract metrics
  const buys = metrics?.totalBuys ?? null;
  const sells = metrics?.totalSells ?? null;
  const hasBuySellData = buys !== null && sells !== null;

  const winRateDisplay =
    metrics?.winRatePercent !== null && metrics?.winRatePercent !== undefined
      ? `${Math.round(metrics.winRatePercent)}%`
      : "—";

  const lastActive = formatLastActive(metrics?.lastActiveAt);

  const handleCopyAddress = async (e: MouseEvent) => {
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(address);
      toast.success("Copied!", {
        description: "Wallet address copied to clipboard.",
        duration: 2000,
      });
    } catch (error) {
      toast.error("Copy failed", {
        description: "Could not copy to clipboard. Please copy manually.",
      });
    }
  };

  const handleFavoriteToggle = (e: MouseEvent) => {
    e.stopPropagation();
    if (onFavoriteToggle) {
      onFavoriteToggle();
    }
  };

  // ===== RENDER MINIMAL VARIANT (ultra-compact for tables) =====
  if (variant === "minimal") {
    return (
      <TooltipProvider>
        <div className={cn("flex items-center gap-1.5", className)}>
          {/* Small wallet icon for visual boundary */}
          <div className="flex-shrink-0 h-5 w-5 rounded bg-muted/50 flex items-center justify-center">
            <Wallet className="h-3 w-3 text-muted-foreground" />
          </div>

          {/* Name/Address - clickable to copy */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopyAddress}
                className={cn(
                  "flex flex-col items-start text-sm transition-colors",
                  isKnownWallet ? "text-muted-foreground" : "text-foreground hover:text-primary"
                )}
              >
                <span
                  className={cn(
                    "font-semibold",
                    showSecondaryLabel ? "text-foreground" : "font-mono",
                    isKnownLabelOnly ? "text-xs font-medium" : "text-sm"
                  )}
                >
                  {displayLabel}
                </span>
                {secondaryLabel && (
                  <span className="font-mono text-[0.7em] text-muted-foreground">
                    {secondaryLabel}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono text-xs">{address}</p>
              <p className="text-muted-foreground text-xs mt-1">Click to copy</p>
            </TooltipContent>
          </Tooltip>

          {/* Compact icon row */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>Copy address</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`https://solscan.io/account/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TooltipTrigger>
              <TooltipContent><p>Solscan</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`/wallets/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <User className="h-3 w-3" />
                </a>
              </TooltipTrigger>
              <TooltipContent><p>Wallet Profile</p></TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  // ===== RENDER INLINE VARIANT (horizontal 2-row compact) =====
  if (variant === "inline") {
    return (
      <TooltipProvider>
        <div
          className={cn(
            "flex flex-col gap-1",
            className
          )}
        >
          {/* Row 1: Avatar + Address + Actions (left) ···· WR + Last Active (right) */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            {/* Left side: Avatar + Address + Copy + Solscan + Details */}
            <div className="flex items-center gap-1 min-w-0 flex-shrink">
              <Avatar className={cn(resolvedSize.avatar, "flex-shrink-0")}>
                <AvatarFallback className="text-xs">
                  <Wallet className={cn(resolvedSize.icon, "text-muted-foreground")} />
                </AvatarFallback>
              </Avatar>

              {/* Name + Address (clickable to copy) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className={cn(
                      "flex flex-col items-start min-w-0 transition-colors",
                      isKnownWallet ? "" : "hover:text-primary",
                      resolvedSize.address
                    )}
                    title={address}
                  >
                    <span
                      className={cn(
                        "truncate max-w-full",
                        isKnownWallet ? "text-muted-foreground" : "text-foreground",
                        isKnownLabelOnly ? resolvedSize.metric : "font-semibold"
                      )}
                    >
                      {displayLabel}
                    </span>
                    {secondaryLabel && (
                      <span className="font-mono text-[0.7em] text-muted-foreground truncate max-w-full">
                        {secondaryLabel}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Click to copy address</p>
                </TooltipContent>
              </Tooltip>

              {/* Favorite toggle button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleFavoriteToggle}
                    className={cn(
                      "inline-flex items-center rounded-md px-1 py-0.5 transition-colors flex-shrink-0",
                      isFavorite
                        ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                        : "text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                    )}
                  >
                    {isFavorite ? (
                      <Star className={cn("fill-amber-500 flex-shrink-0", resolvedSize.icon)} />
                    ) : (
                      <Star className={cn("flex-shrink-0", resolvedSize.icon)} />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isFavorite ? "Remove from tracked" : "Add to tracked"}</p>
                </TooltipContent>
              </Tooltip>

              {/* Edit button (only shown when favorite and onEdit provided) */}
              {isFavorite && onEdit && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                      }}
                      className={cn(
                        "inline-flex items-center rounded-md px-1 py-0.5 transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <Edit2 className={cn("flex-shrink-0", resolvedSize.icon)} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Edit wallet details</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Copy icon */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-md bg-background/70 px-1.5 py-0.5 text-foreground transition hover:bg-accent/70 flex-shrink-0",
                      resolvedSize.metric
                    )}
                  >
                    <Copy className={cn(resolvedSize.icon)} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Copy address</p>
                </TooltipContent>
              </Tooltip>

              {/* Solscan link */}
              {showActions && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                      <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className={cn("text-muted-foreground", resolvedSize.icon)} />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View on Solscan</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Profile link */}
              {showActions && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                      <a href={`/wallets/${address}`} target="_blank" rel="noopener noreferrer">
                        <User className={cn("text-muted-foreground", resolvedSize.icon)} />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Wallet Profile</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Row 2: Trades + WR + Last Active (tight on the left) */}
          {/* Hide trading metrics for known system wallets - they're not traders */}
          {showMetrics && !isKnownWallet && (
            <div className="flex items-center gap-1.5 text-xs -mt-0.5 text-muted-foreground">
              {/* Trades */}
              {hasBuySellData && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-shrink-0 cursor-help">
                        <span className="text-green-600 font-semibold">{buys}↑</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-red-600 font-semibold">{sells}↓</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{buys} buys / {sells} sells</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-muted-foreground">•</span>
                </>
              )}

              {/* Win Rate */}
              {metrics?.winRatePercent !== null && metrics?.winRatePercent !== undefined && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-shrink-0 cursor-help">
                        <span className="font-semibold text-foreground">{winRateDisplay}</span> WR
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Win Rate: {winRateDisplay} of trades were profitable</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-muted-foreground">•</span>
                </>
              )}

              {/* Last Active */}
              {lastActive.text !== "No activity" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex-shrink-0 cursor-help">
                      <span className="font-medium text-foreground">{lastActive.text}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Last active {lastActive.text} ago</p>
                    {lastActive.tooltip && <p className="text-xs text-muted-foreground mt-1">{lastActive.tooltip}</p>}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  }

  // ===== RENDER CARD VARIANT (vertical, for profile pages) =====
  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border border-border/50 bg-accent/15 shadow-base transition-all duration-200 hover:shadow-hover hover:bg-accent/25",
          resolvedSize.padding,
          className
        )}
      >
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className={cn("flex min-w-0 items-center", resolvedSize.gap, "flex-1")}>
            <Avatar className={cn(resolvedSize.avatar, "bg-accent/50")}>
              <AvatarFallback className="text-xs">
                <Wallet className={cn(resolvedSize.icon, "text-muted-foreground")} />
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              {showSecondaryLabel ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "truncate",
                        isKnownWallet ? "text-muted-foreground" : "text-foreground",
                        isKnownLabelOnly ? resolvedSize.metric : `font-bold ${resolvedSize.address}`
                      )}
                    >
                      {displayLabel}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleCopyAddress}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md bg-background/70 px-2 py-1 text-foreground transition hover:bg-accent/70",
                            resolvedSize.metric
                          )}
                        >
                          <Copy className={cn(resolvedSize.icon)} />
                          <span className="font-medium">Copy</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Copy full address</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <code className="text-xs text-muted-foreground truncate font-mono">
                    {address}
                  </code>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <a
                    href={`https://solscan.io/account/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex min-w-0 items-center font-mono text-foreground transition-colors hover:text-primary",
                      resolvedSize.address
                    )}
                    title={address}
                  >
                    <span className="truncate">{truncateAddress(address)}</span>
                  </a>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleCopyAddress}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md bg-background/70 px-2 py-1 text-foreground transition hover:bg-accent/70",
                          resolvedSize.metric
                        )}
                      >
                        <Copy className={cn(resolvedSize.icon)} />
                        <span className="font-medium">Copy</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Copy full address</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Hide trading metrics for known system wallets */}
        {showMetrics && !isKnownWallet && (
          <div className="flex flex-col gap-2 pt-1 border-t border-border/40" style={{ marginTop: "-4px" }}>
            {/* Metrics row */}
            <div className="flex items-center gap-3 flex-wrap text-sm">
              {/* Trades */}
              {hasBuySellData && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="inline-flex items-center gap-1 cursor-help">
                      <span className="text-muted-foreground text-xs uppercase">Trades:</span>
                      <span className="text-green-600 font-medium">{buys}↑</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-red-600 font-medium">{sells}↓</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{buys} buys / {sells} sells</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Win rate */}
              {metrics?.winRatePercent !== null && metrics?.winRatePercent !== undefined && (
                <div className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground text-xs uppercase">Win:</span>
                  <span className="font-medium">{winRateDisplay}</span>
                </div>
              )}

              {/* Last active */}
              {lastActive.text !== "No activity" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="inline-flex items-center gap-1 cursor-help">
                      <span className="text-muted-foreground text-xs uppercase">Last:</span>
                      <span className="font-medium">{lastActive.text}</span>
                    </div>
                  </TooltipTrigger>
                  {lastActive.tooltip && (
                    <TooltipContent>
                      <p>{lastActive.tooltip}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {showActions && (
          <div
            className={cn(
              "flex flex-wrap items-center justify-start sm:justify-end",
              resolvedSize.actionsGap,
              "pt-1 border-t border-border/40"
            )}
            style={{ marginTop: "-4px" }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className={cn("text-muted-foreground", resolvedSize.icon)} />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View on Solscan</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={`/wallets/${address}`} target="_blank" rel="noopener noreferrer">
                    <Info className={cn("text-muted-foreground", resolvedSize.icon)} />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>View profile page</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});

WalletBadge.displayName = "WalletBadge";

export { WalletBadge };
export type { WalletBadgeProps, WalletBadgeVariant, WalletBadgeSize };
