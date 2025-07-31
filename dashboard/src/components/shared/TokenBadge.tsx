import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, TrendingUp, Globe, Twitter, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { memo } from "react";

interface TokenMetadata {
  name?: string;
  symbol?: string;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
}

interface TokenBadgeProps {
  mint: string;
  metadata?: TokenMetadata;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const TokenBadge = memo(({ mint, metadata, className, size = "md" }: TokenBadgeProps) => {
  const tokenName = metadata?.name || 'Unknown Token';
  const tokenSymbol = metadata?.symbol || `${mint.slice(0, 4)}...${mint.slice(-4)}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(mint);
    toast({
      title: "Copied!",
      description: "Token address copied to clipboard.",
    });
  };

  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5", 
    lg: "h-8 w-8"
  };

  const textSizeClasses = {
    sm: "text-xs",
    md: "text-xs",
    lg: "text-sm"
  };

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <div className={cn("flex items-center space-x-2 cursor-pointer group", className)}>
                <Avatar className={sizeClasses[size]}>
                  <AvatarImage 
                    src={metadata?.imageUrl ?? undefined} 
                    alt={tokenName}
                    className={sizeClasses[size]} // Ensure image respects size constraints
                  />
                  <AvatarFallback className={cn("text-xs", sizeClasses[size])}>{tokenName.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className={cn("font-mono group-hover:underline", textSizeClasses[size])}>
                  {tokenName} ({tokenSymbol})
                </span>
              </div>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click for external links and copy</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col space-y-2">
          <div className="flex items-center gap-2">
            <div className="font-bold text-sm text-blue-400">{tokenName}</div>
            {tokenName === 'Unknown Token' && (
              <span className="text-xs text-orange-500 font-medium">(probably spam/rug)</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleCopy} className="h-auto px-2 py-1 text-xs" tabIndex={-1}>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Copy token address</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" asChild>
                    <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Solscan
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View on Solscan</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-auto px-2 py-1 text-xs" asChild>
                    <a href={`https://gmgn.ai/sol/token/${mint}`} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                      <TrendingUp className="h-3 w-3 mr-1" />
                      gmgn.ai
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View chart on gmgn.ai</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {/* Social links row */}
          {(metadata?.websiteUrl || metadata?.twitterUrl || metadata?.telegramUrl) && (
            <div className="flex items-center gap-1 pt-1">
              {metadata?.websiteUrl && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={metadata.websiteUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                          <Globe className="h-4 w-4" />
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Visit website</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {metadata?.twitterUrl && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={metadata.twitterUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                          <Twitter className="h-4 w-4" />
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Follow on Twitter</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {metadata?.telegramUrl && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={metadata.telegramUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                          <Send className="h-4 w-4" />
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Join Telegram</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

TokenBadge.displayName = "TokenBadge";

export { TokenBadge };
export type { TokenBadgeProps, TokenMetadata }; 