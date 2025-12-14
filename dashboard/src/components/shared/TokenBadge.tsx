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
import { Copy, ExternalLink, Globe, Send, TrendingUp, Twitter } from "lucide-react";
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
    avatar: "h-8 w-8",
    padding: "px-2.5 py-1.5",
    gap: "gap-2",
    text: "text-[11px]",
    subtext: "text-[10px]",
    metric: "text-[11px]",
    icon: "h-3 w-3",
    actionsGap: "gap-1.5",
  },
  m: {
    avatar: "h-9 w-9",
    padding: "px-3 py-2",
    gap: "gap-3",
    text: "text-sm",
    subtext: "text-xs",
    metric: "text-xs",
    icon: "h-3.5 w-3.5",
    actionsGap: "gap-2",
  },
  l: {
    avatar: "h-10 w-10",
    padding: "px-3.5 py-2.5",
    gap: "gap-3",
    text: "text-base",
    subtext: "text-sm",
    metric: "text-sm",
    icon: "h-4 w-4",
    actionsGap: "gap-2.5",
  },
  xl: {
    avatar: "h-12 w-12",
    padding: "px-4 py-3",
    gap: "gap-4",
    text: "text-lg",
    subtext: "text-sm",
    metric: "text-sm",
    icon: "h-4 w-4",
    actionsGap: "gap-3",
  },
} satisfies Record<"s" | "m" | "l" | "xl", Record<string, string>>;

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
  const tokenSymbol = metadata?.onchainSymbol || metadata?.symbol || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  const tokenImage = metadata?.imageUrl || metadata?.onchainImageUrl;
  const tokenWebsite = metadata?.websiteUrl || metadata?.onchainWebsiteUrl;
  const tokenTwitter = metadata?.twitterUrl || metadata?.onchainTwitterUrl;
  const tokenTelegram = metadata?.telegramUrl || metadata?.onchainTelegramUrl;
  const marketCap = metadata?.marketCapUsd ?? null;
  const truncatedMint = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  const normalizedSize =
    size === "sm" ? "s" : size === "md" ? "m" : size === "lg" ? "l" : size;
  const resolvedSize = sizeConfig[normalizedSize as keyof typeof sizeConfig] ?? sizeConfig.m;

  const handleCopy = async (e: MouseEvent) => {
    e.stopPropagation();

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
          "flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30",
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
          "flex flex-wrap items-center justify-between gap-3 sm:gap-4 rounded-lg border border-border/50 bg-muted/30 shadow-base transition-shadow duration-200 hover:shadow-hover",
          resolvedSize.padding,
          className
        )}
      >
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
            <div className="flex items-center gap-1 min-w-0">
              <a
                href={`https://solscan.io/token/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1 font-semibold text-foreground hover:underline",
                  resolvedSize.text
                )}
              >
                {tokenName}
                <ExternalLink className={cn("text-muted-foreground", resolvedSize.icon)} />
              </a>
              {tokenName === "Unknown Token" && (
                <span className="text-[11px] font-medium text-orange-500">(unverified)</span>
              )}
            </div>
            <div
              className={cn(
                "flex flex-wrap items-center text-muted-foreground",
                resolvedSize.gap,
                resolvedSize.subtext
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded-md bg-transparent px-1 py-0.5 text-muted-foreground transition hover:bg-accent/60 hover:text-foreground"
                  >
                    <span className="font-mono">{tokenSymbol}</span>
                    <Copy className={cn(resolvedSize.icon)} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Copy contract address</p>
                </TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground/70">{truncatedMint}</span>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "flex flex-wrap items-center justify-end",
            resolvedSize.actionsGap,
            "mt-2 sm:mt-0"
          )}
        >
          <div className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-1 text-muted-foreground border border-border/60">
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
