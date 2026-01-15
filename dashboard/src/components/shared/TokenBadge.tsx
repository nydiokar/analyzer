/**
 * TokenBadge - Universal token profile badge with smart metadata fetching
 *
 * - Layout variants: "card" (vertical 2-row) or "inline" (horizontal 1-row)
 * - All actions visible in both variants - no popovers needed
 * - Batches metadata requests automatically via useTokenMetadata
 * - Prioritizes onchain fields for name/symbol, DexScreener for imagery/market data
 * - Size variants (s, m, l, xl) for fine-grained control
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { Copy, Globe, Send, TrendingUp, Twitter } from "lucide-react";
import { memo, MouseEvent, useMemo } from "react";

interface TokenMetadata {
  // DexScreener fields (fresher, updated by community)
  name?: string;
  symbol?: string;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  marketCapUsd?: number | null;
  priceUsd?: string | number | null;

  // Onchain fields (immutable, authoritative - fallback)
  onchainName?: string;
  onchainSymbol?: string;
  onchainImageUrl?: string;
  onchainWebsiteUrl?: string;
  onchainTwitterUrl?: string;
  onchainTelegramUrl?: string;
}

type TokenBadgeSize = "s" | "m" | "l" | "xl" | "sm" | "md" | "lg";
type TokenBadgeVariant = "card" | "inline";

interface TokenBadgeProps {
  mint: string;
  metadata?: TokenMetadata;
  className?: string;
  size?: TokenBadgeSize;
  variant?: TokenBadgeVariant;
}

const sizeConfig = {
  s: {
    avatar: "h-7 w-7",
    padding: "px-2.5 py-1.25",
    gap: "gap-2",
    name: "text-sm",
    ticker: "text-xs",
    metric: "text-xs",
    icon: "h-3 w-3",
    chipPadding: "px-2 py-0.5",
    actionsGap: "gap-1.5",
  },
  m: {
    avatar: "h-8 w-8",
    padding: "px-3 py-1.75",
    gap: "gap-2.5",
    name: "text-base",
    ticker: "text-sm",
    metric: "text-sm",
    icon: "h-3.5 w-3.5",
    chipPadding: "px-2.5 py-0.5",
    actionsGap: "gap-2",
  },
  l: {
    avatar: "h-9 w-9",
    padding: "px-3.5 py-2",
    gap: "gap-3",
    name: "text-lg",
    ticker: "text-base",
    metric: "text-base",
    icon: "h-4 w-4",
    chipPadding: "px-3 py-1",
    actionsGap: "gap-2.5",
  },
  xl: {
    avatar: "h-12 w-12",
    padding: "px-4 py-2.5",
    gap: "gap-4",
    name: "text-xl",
    ticker: "text-lg",
    metric: "text-lg",
    icon: "h-4 w-4",
    chipPadding: "px-3.5 py-1",
    actionsGap: "gap-3",
  },
} satisfies Record<
  "s" | "m" | "l" | "xl",
  {
    avatar: string;
    padding: string;
    gap: string;
    name: string;
    ticker: string;
    metric: string;
    icon: string;
    chipPadding: string;
    actionsGap: string;
  }
>;

const formatMarketCap = (value: number | null | undefined) => {
  if (typeof value === "number" && !isNaN(value) && value > 0) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  return "–";
};

const TokenBadge = memo(({
  mint,
  metadata: providedMetadata,
  className,
  size = "m",
  variant = "card"
}: TokenBadgeProps) => {
  // ===== SMART METADATA FETCHING WITH BATCHING =====
  const { metadata: fetchedMetadata, isLoading } = useTokenMetadata(mint, providedMetadata);

  // Merge provided + fetched so upstream partial metadata still benefits from enrichment
  const metadata = useMemo(() => {
    if (!providedMetadata && !fetchedMetadata) return null;
    return { ...(fetchedMetadata || {}), ...(providedMetadata || {}) };
  }, [providedMetadata, fetchedMetadata]);

  // ===== CENTRALIZED METADATA PRIORITY LOGIC =====
  const tokenName = metadata?.onchainName || metadata?.name || "Unknown Token";
  const tokenSymbol = metadata?.onchainSymbol || metadata?.symbol || "";
  const tokenImage = metadata?.imageUrl || metadata?.onchainImageUrl;
  const tokenWebsite = metadata?.websiteUrl || metadata?.onchainWebsiteUrl;
  const tokenTwitter = metadata?.twitterUrl || metadata?.onchainTwitterUrl;
  const tokenTelegram = metadata?.telegramUrl || metadata?.onchainTelegramUrl;
  const marketCap = metadata?.marketCapUsd ?? null;
  const normalizedSize =
    size === "sm" ? "s" : size === "md" ? "m" : size === "lg" ? "l" : size;
  const resolvedSize = sizeConfig[normalizedSize as keyof typeof sizeConfig] ?? sizeConfig.m;
  const displaySymbol = tokenSymbol ? tokenSymbol.toUpperCase() : "—";

  const handleCopyTicker = async (e: MouseEvent) => {
    e.stopPropagation();

    if (!tokenSymbol) {
      toast.error("No ticker available", {
        description: "This token has no ticker to copy yet.",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(mint);
      toast.success("Copied!", {
        description: "Token address copied to clipboard.",
        duration: 2000,
      });
    } catch (error) {
      toast.error("Copy failed", {
        description: "Could not copy to clipboard. Please copy manually.",
      });
    }
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center rounded-xl border border-border/50 bg-accent/20 shadow-base",
          variant === "inline" ? "gap-2" : "gap-3",
          resolvedSize.padding,
          className
        )}
      >
        <Skeleton className={cn("rounded-lg flex-shrink-0", resolvedSize.avatar)} />
        <div className={cn("flex gap-2 flex-1 min-w-0", variant === "inline" ? "flex-row items-center" : "flex-col")}>
          <Skeleton className={variant === "inline" ? "h-3 w-24" : "h-4 w-32"} />
          <Skeleton className={variant === "inline" ? "h-3 w-16" : "h-3 w-48"} />
        </div>
      </div>
    );
  }

  // ===== RENDER INLINE VARIANT (horizontal 2-row compact) =====
  if (variant === "inline") {
    return (
      <TooltipProvider>
        <div
          className={cn(
            "flex flex-col gap-1",
            resolvedSize.padding,
            className
          )}
        >
          {/* Row 1: Avatar + Name + Symbol (grouped together, compact) */}
          <div className={cn("flex items-center gap-1.5 min-w-0", resolvedSize.gap)}>
            {/* Avatar */}
            <Avatar className={cn(resolvedSize.avatar, "flex-shrink-0")}>
              <AvatarImage
                src={tokenImage ?? undefined}
                alt={tokenName}
                className={resolvedSize.avatar}
              />
              <AvatarFallback className="text-xs">{tokenName.charAt(0)}</AvatarFallback>
            </Avatar>

            {/* Name (clickable to Solscan) */}
            <a
              href={`https://solscan.io/token/${mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "truncate font-semibold text-foreground transition-colors hover:text-primary min-w-0",
                resolvedSize.name
              )}
              title={tokenName}
            >
              {tokenName}
            </a>

            {/* Symbol pill with copy - shoulder to shoulder with name */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopyTicker}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-md bg-background/70 px-1.5 py-0.5 uppercase text-foreground transition hover:bg-accent/70 flex-shrink-0",
                    resolvedSize.ticker
                  )}
                >
                  <span className="font-semibold tracking-wide">{displaySymbol}</span>
                  <Copy className={cn(resolvedSize.icon)} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Copy CA</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Row 2: Mcap (left) + Action buttons (right) */}
          <div className="flex items-center justify-between -mt-0.5">
            {/* Market cap - left aligned under token name */}
            <div className="inline-flex items-center gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">MC:</span>
              <span className={cn("font-semibold text-foreground", resolvedSize.metric)}>
                {formatMarketCap(marketCap)}
              </span>
            </div>

            {/* Action buttons - right aligned */}
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                    <a href={`https://gmgn.ai/sol/token/${mint}`} target="_blank" rel="noopener noreferrer">
                      <TrendingUp className={cn("text-muted-foreground", resolvedSize.icon)} />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Open chart (gmgn.ai)</p>
                </TooltipContent>
              </Tooltip>

              {tokenWebsite && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                      <a href={tokenWebsite} target="_blank" rel="noopener noreferrer">
                        <Globe className={cn("text-muted-foreground", resolvedSize.icon)} />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Website</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {tokenTwitter && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                      <a href={tokenTwitter} target="_blank" rel="noopener noreferrer">
                        <Twitter className={cn("text-muted-foreground", resolvedSize.icon)} />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Twitter / X</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {tokenTelegram && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                      <a href={tokenTelegram} target="_blank" rel="noopener noreferrer">
                        <Send className={cn("text-muted-foreground", resolvedSize.icon)} />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Telegram</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {tokenName === "Unknown Token" && (
                <span className="text-[9px] font-medium text-orange-500 flex-shrink-0 ml-2">Unverified</span>
              )}
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  // ===== RENDER CARD VARIANT (vertical two-row, default) =====
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
            <Avatar className={resolvedSize.avatar}>
              <AvatarImage
                src={tokenImage ?? undefined}
                alt={tokenName}
                className={resolvedSize.avatar}
              />
              <AvatarFallback className="text-xs">{tokenName.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <a
                  href={`https://solscan.io/token/${mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex min-w-0 items-center truncate font-semibold text-foreground transition-colors hover:text-primary",
                    resolvedSize.name
                  )}
                  title={tokenName}
                >
                  <span className="truncate">{tokenName}</span>
                </a>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleCopyTicker}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md bg-background/70 px-2 py-1 uppercase text-foreground transition hover:bg-accent/70",
                        resolvedSize.ticker
                      )}
                    >
                      <span className="font-semibold tracking-wide">{displaySymbol}</span>
                      <Copy className={cn(resolvedSize.icon)} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copy CA</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {tokenName === "Unknown Token" && (
                <span className="text-[11px] font-medium text-orange-500">Unverified metadata</span>
              )}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center justify-start sm:justify-end",
            resolvedSize.actionsGap,
            "pt-1 border-t border-border/40"
          )}
          style={{ marginTop: "-4px" }} // tighten vertical spacing between title row and actions
        >
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 text-muted-foreground",
              resolvedSize.chipPadding
            )}
          >
            <span className="uppercase text-[10px] tracking-wide">Mcap</span>
            <span className={cn("font-semibold text-foreground", resolvedSize.metric)}>
              {formatMarketCap(marketCap)}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                <a href={`https://gmgn.ai/sol/token/${mint}`} target="_blank" rel="noopener noreferrer">
                  <TrendingUp className={cn("text-muted-foreground", resolvedSize.icon)} />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Open chart (gmgn.ai)</p>
            </TooltipContent>
          </Tooltip>

          {tokenWebsite && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={tokenWebsite} target="_blank" rel="noopener noreferrer">
                    <Globe className={cn("text-muted-foreground", resolvedSize.icon)} />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Website</p>
              </TooltipContent>
            </Tooltip>
          )}
          {tokenTwitter && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={tokenTwitter} target="_blank" rel="noopener noreferrer">
                    <Twitter className={cn("text-muted-foreground", resolvedSize.icon)} />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Twitter / X</p>
              </TooltipContent>
            </Tooltip>
          )}
          {tokenTelegram && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={tokenTelegram} target="_blank" rel="noopener noreferrer">
                    <Send className={cn("text-muted-foreground", resolvedSize.icon)} />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Telegram</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});

TokenBadge.displayName = "TokenBadge";

export { TokenBadge };
export type { TokenBadgeProps, TokenMetadata, TokenBadgeVariant, TokenBadgeSize };
