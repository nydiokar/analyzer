/**
 * TokenBadge - Inline token profile badge with smart metadata fetching
 *
 * - Always-visible (no popover) so users see key details at a glance
 * - Batches metadata requests automatically via useTokenMetadata
 * - Prioritizes onchain fields for name/symbol, DexScreener for imagery/market data
 * - Size variants (s, m, l, xl) for embedding in tables or cards
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
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

  // Onchain fields (immutable, authoritative - fallback)
  onchainName?: string;
  onchainSymbol?: string;
  onchainImageUrl?: string;
  onchainWebsiteUrl?: string;
  onchainTwitterUrl?: string;
  onchainTelegramUrl?: string;
}

type TokenBadgeSize = "s" | "m" | "l" | "xl" | "sm" | "md" | "lg";

interface TokenBadgeProps {
  mint: string;
  metadata?: TokenMetadata;
  className?: string;
  size?: TokenBadgeSize;
}

const sizeConfig = {
  s: {
    avatar: "h-7 w-7",
    padding: "px-2.5 py-1.25",
    gap: "gap-2",
    name: "text-[11px]",
    ticker: "text-[12px]",
    metric: "text-[11px]",
    icon: "h-3 w-3",
    chipPadding: "px-2 py-0.5",
    actionsGap: "gap-1.5",
  },
  m: {
    avatar: "h-8 w-8",
    padding: "px-3 py-1.75",
    gap: "gap-2.5",
    name: "text-[13px]",
    ticker: "text-sm",
    metric: "text-xs",
    icon: "h-3.5 w-3.5",
    chipPadding: "px-2.5 py-0.5",
    actionsGap: "gap-2",
  },
  l: {
    avatar: "h-9 w-9",
    padding: "px-3.5 py-2",
    gap: "gap-3",
    name: "text-[15px]",
    ticker: "text-base",
    metric: "text-sm",
    icon: "h-4 w-4",
    chipPadding: "px-3 py-1",
    actionsGap: "gap-2.5",
  },
  xl: {
    avatar: "h-12 w-12",
    padding: "px-4 py-2.5",
    gap: "gap-4",
    name: "text-[17px]",
    ticker: "text-lg",
    metric: "text-sm",
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

const TokenBadge = memo(({ mint, metadata: providedMetadata, className, size = "m" }: TokenBadgeProps) => {
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
      toast({
        title: "No ticker available",
        description: "This token has no ticker to copy yet.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(mint);
        toast({
          title: "Copied!",
          description: "Token address copied to clipboard.",
        });
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = mint;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);

        toast({
          title: "Copied!",
          description: "Token address copied to clipboard.",
        });
      }
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard. Please copy manually.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border border-border/50 bg-accent/20 shadow-base",
          resolvedSize.padding,
          className
        )}
      >
        <Skeleton className={cn("rounded-lg", resolvedSize.avatar)} />
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
    );
  }

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
export type { TokenBadgeProps, TokenMetadata };
