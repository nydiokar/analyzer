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
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Info, Wallet, User, Bookmark, Edit2 } from "lucide-react";
import { memo, MouseEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import type { FavoriteWallet, WalletHudDto, KnownWalletType } from "@/types/api";
import { useFavorites } from "@/hooks/useFavorites";
import { WalletHudOverlay } from "@/components/shared/WalletHudOverlay";
import { WalletHudBadge } from "@/components/shared/WalletHudBadge";
import { stripHudEncoding, getWalletDisplayIcon } from "@/lib/wallet-name-encoding";

export interface WalletMetrics {
  totalBuys?: number | null;
  totalSells?: number | null;
  winRatePercent?: number | null;
  lastActiveAt?: string | null;
}

type WalletBadgeSize = "s" | "m" | "l" | "xl" | "sm" | "md" | "lg";
type WalletBadgeVariant = "card" | "inline" | "minimal" | "compact" | "micro" | "stacked";

interface WalletBadgeProps {
  address: string;
  metrics?: WalletMetrics;
  className?: string;
  size?: WalletBadgeSize;
  variant?: WalletBadgeVariant;
  showMetrics?: boolean;
  showActions?: boolean;
  showHud?: boolean;
  hudDisplay?: 'inline' | 'tooltip' | 'expanded' | 'none';
  hudData?: WalletHudDto | null;
  hudDelayMs?: number;
  /** Fine-grained control over which action icons to show. Only applies when showActions is true or undefined. */
  visibleActions?: {
    copy?: boolean;
    solscan?: boolean;
    profile?: boolean;
  };
  addressClickAction?: "copy-address" | "copy-profile-link";
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

// Solscan logo SVG component - simplified with better visibility
const SolscanIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Rounded rectangle background with brand color */}
    <rect x="2" y="2" width="16" height="16" rx="3" className="fill-[#009978] opacity-20" />

    {/* Three horizontal bars - Solscan's signature pattern */}
    <rect x="5" y="6" width="10" height="1.5" rx="0.75" fill="currentColor" />
    <rect x="5" y="9.25" width="10" height="1.5" rx="0.75" fill="currentColor" />
    <rect x="5" y="12.5" width="10" height="1.5" rx="0.75" fill="currentColor" />
  </svg>
);

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

// ===== SHARED ACTION BUTTONS - SINGLE SOURCE OF TRUTH =====
interface ActionButtonsProps {
  address: string;
  iconSize: string;
  visibleActions: { copy?: boolean; solscan?: boolean; profile?: boolean };
  onCopyAddress: (e: MouseEvent) => void;
  buttonSize?: "sm" | "md" | "lg";
}

const ActionButtons = memo(({ address, iconSize, visibleActions, onCopyAddress, buttonSize = "md" }: ActionButtonsProps) => {
  const sizeClass = buttonSize === "sm" ? "h-5 w-5" : buttonSize === "lg" ? "h-7 w-7" : "h-6 w-6";
  const iconSizeClass = buttonSize === "sm" ? "h-2.5 w-2.5" : buttonSize === "lg" ? "h-4 w-4" : iconSize;

  return (
    <>
      {visibleActions.copy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCopyAddress}
              className={cn(
                "inline-flex items-center justify-center rounded-md bg-muted/30 hover:bg-blue-500/10 border border-border/40 hover:border-blue-500/20 text-muted-foreground hover:text-blue-500 transition-all flex-shrink-0",
                sizeClass
              )}
            >
              <Copy className={iconSizeClass} />
            </button>
          </TooltipTrigger>
          <TooltipContent><p>Copy address</p></TooltipContent>
        </Tooltip>
      )}

      {visibleActions.solscan && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center justify-center rounded-md bg-muted/30 hover:bg-[#009978]/10 border border-border/40 hover:border-[#009978]/20 text-muted-foreground hover:text-[#009978] transition-all flex-shrink-0",
                sizeClass
              )}
            >
              <SolscanIcon className={iconSizeClass} />
            </a>
          </TooltipTrigger>
          <TooltipContent><p>View on Solscan</p></TooltipContent>
        </Tooltip>
      )}

      {visibleActions.profile && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={`/wallets/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center justify-center rounded-md bg-muted/30 hover:bg-indigo-500/10 border border-border/40 hover:border-indigo-500/20 text-muted-foreground hover:text-indigo-500 transition-all flex-shrink-0",
                sizeClass
              )}
            >
              <User className={iconSizeClass} />
            </a>
          </TooltipTrigger>
          <TooltipContent><p>Wallet Profile</p></TooltipContent>
        </Tooltip>
      )}
    </>
  );
});
ActionButtons.displayName = "ActionButtons";

const WalletBadge = memo(({
  address,
  metrics,
  className,
  size = "m",
  variant = "inline",
  showMetrics = true,
  showActions = true,
  showHud = false,
  hudDisplay = "tooltip",
  hudData = null,
  hudDelayMs = 800,
  visibleActions = { copy: true, solscan: true, profile: true },
  addressClickAction = "copy-profile-link",
  isFavorite = false,
  onFavoriteToggle,
  onEdit,
  favoriteData: externalFavoriteData,
  knownType,
  knownLabel,
}: WalletBadgeProps) => {
  // Fetch favorites internally only when parent doesn't provide favorite data.
  const { favorites } = useFavorites({ enabled: !externalFavoriteData });
  const internalFavoriteData = favorites.find(fav => fav.walletAddress === address);
  const favoriteData = externalFavoriteData ?? internalFavoriteData;

  // Normalize knownType - accept string for flexibility, validate internally
  const normalizedKnownType: KnownWalletType | undefined = knownType &&
    (['BURN', 'LP', 'PROTOCOL', 'EXCHANGE', 'SYSTEM', 'KOL'] as const).includes(knownType as KnownWalletType)
      ? (knownType as KnownWalletType)
      : undefined;

  // KOL wallets are real traders — show their metrics. Only dim for system/protocol types.
  const isKnownWallet = Boolean(normalizedKnownType || knownLabel);
  const shouldDimMetrics = isKnownWallet && normalizedKnownType !== 'KOL';
  const displayNickname = favoriteData?.nickname
    ? stripHudEncoding(favoriteData.nickname) || undefined
    : undefined;
  const displayLabel = displayNickname ?? knownLabel ?? truncateAddress(address);
  const showSecondaryLabel = Boolean(displayNickname || knownLabel);
  const secondaryLabel = showSecondaryLabel ? truncateAddress(address) : null;
  const isKnownLabelOnly = Boolean(knownLabel) && !displayNickname;

  // Get display icon: bot/whale takes priority, then user emoji, then default
  const walletIcon = getWalletDisplayIcon(
    favoriteData?.nickname,
    favoriteData?.metadata?.emoji
  );

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

  const handleCopyProfileLink = async (e: MouseEvent) => {
    e.stopPropagation();

    try {
      const profileUrl = `${window.location.origin}/wallets/${address}`;
      await navigator.clipboard.writeText(profileUrl);
      toast.success("Copied!", {
        description: "Profile link copied to clipboard.",
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

  const handleAddressClick =
    addressClickAction === "copy-address" ? handleCopyAddress : handleCopyProfileLink;
  const addressClickHint =
    addressClickAction === "copy-address"
      ? "Click to copy address"
      : "Click to copy profile link";

  const [isHudOpen, setIsHudOpen] = useState(false);
  const [isHudPinned, setIsHudPinned] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const HUD_CLOSE_DELAY_MS = 120;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarsePointer(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    return () => {
      clearHoverTimeout();
      clearCloseTimeout();
    };
  }, []);

  useEffect(() => {
    if (!showHud || hudDisplay !== "tooltip") {
      setIsHudOpen(false);
      setIsHudPinned(false);
    }
  }, [showHud, hudDisplay]);

  const clearHoverTimeout = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const openHudPreview = () => {
    if (!showHud || hudDisplay !== "tooltip") return;
    clearHoverTimeout();
    clearCloseTimeout();
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHudOpen(true);
    }, hudDelayMs);
  };

  const closeHudPreview = () => {
    if (!showHud || hudDisplay !== "tooltip" || isHudPinned) return;
    clearHoverTimeout();
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setIsHudOpen(false);
    }, HUD_CLOSE_DELAY_MS);
  };

  const handleHudClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!showHud || hudDisplay !== "tooltip") return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("[data-interactive]")) {
      return;
    }
    e.stopPropagation();
    clearHoverTimeout();
    clearCloseTimeout();
    setIsHudPinned((prevPinned) => {
      const nextPinned = !prevPinned;
      setIsHudOpen(nextPinned ? true : false);
      return nextPinned;
    });
  };

  const handleHudOpenChange = (open: boolean) => {
    setIsHudOpen(open);
    if (!open) {
      setIsHudPinned(false);
      clearHoverTimeout();
      clearCloseTimeout();
    }
  };

  const renderWithHud = (badge: React.ReactNode) => {
    if (!showHud || hudDisplay === "none" || hudDisplay === "inline") {
      return badge;
    }

    if (hudDisplay === "expanded") {
      return (
        <div className="space-y-2">
          {badge}
          <WalletHudOverlay walletAddress={address} display="expanded" data={hudData} />
        </div>
      );
    }

    return (
      <Popover open={isHudOpen} onOpenChange={handleHudOpenChange}>
        <PopoverAnchor asChild>
          <div
            className="inline-block"
            onMouseEnter={openHudPreview}
            onMouseLeave={closeHudPreview}
            onFocus={openHudPreview}
            onBlur={closeHudPreview}
            onClick={handleHudClick}
          >
            {badge}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="right"
          align="start"
          className="w-auto p-3"
          onMouseEnter={() => {
            clearCloseTimeout();
            if (!isHudOpen) {
              setIsHudOpen(true);
            }
          }}
          onMouseLeave={closeHudPreview}
        >
          <WalletHudOverlay walletAddress={address} display="tooltip" data={hudData} />
          <div className="mt-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
            {isCoarsePointer ? "Tap to pin/unpin HUD details." : "Click badge to pin/unpin."}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // ===== RENDER MINIMAL VARIANT (ultra-compact for tables) =====
  if (variant === "minimal") {
    return renderWithHud(
      <TooltipProvider>
        <div className={cn("flex flex-col gap-0.5", className)}>
          {/* Row 1: Wallet info + actions */}
          <div className="flex items-center gap-1.5">
            {/* Small wallet icon for visual boundary */}
            <div className="flex-shrink-0 h-5 w-5 rounded bg-muted/50 flex items-center justify-center">
              <Wallet className="h-3 w-3 text-muted-foreground" />
            </div>

            {/* Name/Address - clickable to copy configured target */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleAddressClick}
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
                <p className="text-muted-foreground text-xs mt-1">{addressClickHint}</p>
              </TooltipContent>
            </Tooltip>

            {/* Compact icon row */}
            <div className="flex items-center gap-0.5 ml-auto">
              {/* Favorite toggle button */}
              {onFavoriteToggle && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleFavoriteToggle}
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        isFavorite
                          ? "text-purple-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/20"
                          : "text-muted-foreground hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20"
                      )}
                    >
                      {isFavorite ? (
                        <Bookmark className="h-3 w-3 fill-purple-500" />
                      ) : (
                        <Bookmark className="h-3 w-3" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p>{isFavorite ? "Remove from tracked" : "Add to tracked"}</p></TooltipContent>
                </Tooltip>
              )}

              {showActions && (
                <ActionButtons
                  address={address}
                  iconSize="h-3 w-3"
                  visibleActions={visibleActions}
                  onCopyAddress={handleCopyAddress}
                  buttonSize="sm"
                />
              )}
            </div>
          </div>

          {/* Row 2: HUD Badges (if available) - poker-style always-visible */}
          {showHud && hudData && (
            <div className="flex items-center gap-1.5 pl-6">
              <WalletHudBadge data={hudData} size="sm" />
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  }

  // ===== RENDER COMPACT VARIANT (dense list, icons below) =====
  if (variant === "compact") {
    return renderWithHud(
      <TooltipProvider>
        <div className={cn("inline-flex flex-col items-center gap-0.5 p-1 rounded border border-border/40 hover:border-border transition-colors", className)}>
          {/* Address on top - clickable to copy configured target */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleAddressClick}
                className={cn(
                  "text-xs font-mono cursor-pointer transition-colors hover:text-primary",
                  isKnownWallet && "text-muted-foreground"
                )}
              >
                {displayLabel}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono text-xs">{address}</p>
              {secondaryLabel && <p className="text-muted-foreground text-xs">{secondaryLabel}</p>}
              <p className="text-muted-foreground text-xs mt-1">{addressClickHint}</p>
            </TooltipContent>
          </Tooltip>

          {/* Icons below horizontally */}
          {showActions && (
            <div className="flex items-center gap-0.5">
              <ActionButtons
                address={address}
                iconSize="h-2.5 w-2.5"
                visibleActions={visibleActions}
                onCopyAddress={handleCopyAddress}
                buttonSize="sm"
              />
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  }

  // ===== RENDER MICRO VARIANT (ultra compact, click to expand) =====
  if (variant === "micro") {
    return renderWithHud(
      <TooltipProvider>
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono",
                    "border border-border/40 hover:border-border transition-colors cursor-pointer",
                    isKnownWallet && "text-muted-foreground",
                    className
                  )}
                >
                  {displayLabel.length > 8 ? `${displayLabel.slice(0, 4)}...` : displayLabel}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent><p>Click for actions</p></TooltipContent>
          </Tooltip>

          <PopoverContent className="w-64 p-3" align="start">
            <div className="space-y-2">
              <div className="font-mono text-xs break-all">{address}</div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAddress}
                  className="flex-1 h-7"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="flex-1 h-7 bg-muted/30 hover:bg-[#009978]/10 text-muted-foreground hover:text-[#009978] border-border/40 hover:border-[#009978]/20 transition-all"
                >
                  <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer">
                    <SolscanIcon className="h-3 w-3 mr-1" />
                    Solscan
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="flex-1 h-7"
                >
                  <Link href={`/wallets/${address}`}>
                    <User className="h-3 w-3 mr-1" />
                    Profile
                  </Link>
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    );
  }

  // ===== RENDER STACKED VARIANT (quadratic with icons stacked below) =====
  if (variant === "stacked") {
    return renderWithHud(
      <TooltipProvider>
        <div className={cn("inline-flex flex-col rounded border border-border/40 hover:border-border transition-colors overflow-hidden", className)}>
          {/* Address section - clickable to copy configured target */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleAddressClick}
                className={cn(
                  "px-2 py-1.5 bg-card text-xs font-mono cursor-pointer text-center transition-colors hover:bg-muted/20",
                  isKnownWallet && "text-muted-foreground"
                )}
              >
                {displayLabel}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono text-xs">{address}</p>
              {secondaryLabel && <p className="text-muted-foreground text-xs">{secondaryLabel}</p>}
              <p className="text-muted-foreground text-xs mt-1">{addressClickHint}</p>
            </TooltipContent>
          </Tooltip>

          {/* Icons section stacked below */}
          {showActions && (
            <div className="flex items-center justify-center gap-1 px-2 py-1 bg-muted/20 border-t border-border/40">
              <ActionButtons
                address={address}
                iconSize="h-3 w-3"
                visibleActions={visibleActions}
                onCopyAddress={handleCopyAddress}
                buttonSize="sm"
              />
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  }

  // ===== RENDER INLINE VARIANT (horizontal 2-row compact) =====
  if (variant === "inline") {
    return renderWithHud(
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
              <Avatar className={cn(resolvedSize.avatar, "flex-shrink-0 bg-transparent")}>
                <AvatarFallback className="text-xs bg-muted/30 border border-border/50">
                  <span className="text-base">{walletIcon}</span>
                </AvatarFallback>
              </Avatar>

              {/* Name + Address (clickable to copy configured target) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleAddressClick}
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
                  <p>{addressClickHint}</p>
                </TooltipContent>
              </Tooltip>

              {/* Favorite toggle button */}
              {onFavoriteToggle && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleFavoriteToggle}
                      className={cn(
                        "inline-flex items-center rounded-md px-1 py-0.5 transition-colors flex-shrink-0",
                        isFavorite
                          ? "text-purple-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/20"
                          : "text-muted-foreground hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20"
                      )}
                    >
                      {isFavorite ? (
                        <Bookmark className={cn("fill-purple-500 flex-shrink-0", resolvedSize.icon)} />
                      ) : (
                        <Bookmark className={cn("flex-shrink-0", resolvedSize.icon)} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isFavorite ? "Remove from tracked" : "Add to tracked"}</p>
                  </TooltipContent>
                </Tooltip>
              )}

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
                        "inline-flex items-center rounded-md px-1 py-0.5 transition-colors flex-shrink-0",
                        "text-muted-foreground hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20"
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

              {/* Action buttons - shared component */}
              {showActions && (
                <ActionButtons
                  address={address}
                  iconSize={resolvedSize.icon}
                  visibleActions={visibleActions}
                  onCopyAddress={handleCopyAddress}
                  buttonSize="md"
                />
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
  return renderWithHud(
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
            <Avatar className={cn(resolvedSize.avatar, "bg-transparent")}>
              <AvatarFallback className="text-xs bg-muted/30 border border-border/50">
                <span className="text-base">{walletIcon}</span>
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
            <ActionButtons
              address={address}
              iconSize={resolvedSize.icon}
              visibleActions={visibleActions}
              onCopyAddress={handleCopyAddress}
              buttonSize="lg"
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});

WalletBadge.displayName = "WalletBadge";

export { WalletBadge };
export type { WalletBadgeProps, WalletBadgeVariant, WalletBadgeSize };
