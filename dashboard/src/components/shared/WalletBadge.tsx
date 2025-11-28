import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast"; // Import the standalone toast function
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Wallet, Info } from "lucide-react";
import Link from "next/link";
import { memo } from "react"; // Import memo

interface WalletBadgeProps {
  address: string;
  className?: string;
}

const truncateAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

export const WalletBadge = memo(({ address, className }: WalletBadgeProps) => {
  // No longer need the useToast() hook here

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent the popover from closing
    navigator.clipboard.writeText(address);
    toast({
      title: "Copied!",
      description: "Wallet address copied to clipboard.",
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className={cn("inline-flex items-center cursor-pointer font-mono text-blue-500 hover:underline", className)}>
          <Wallet className="h-4 w-4 mr-1.5" />
          {truncateAddress(address)}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto space-y-3 bg-slate-900 border-slate-700 text-white p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col space-y-3">
          <div className="text-xs font-mono p-2 rounded border border-slate-700 bg-slate-950 text-slate-100">
            {address}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopy}
                          className="flex-1 w-full bg-blue-600 text-white hover:bg-blue-500 border-blue-500"
                          tabIndex={-1}
                        >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Copy full wallet address</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Link 
                            href={`https://solscan.io/account/${address}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-md border border-transparent bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Solscan
                        </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>View on Solscan block explorer</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Link 
                            href={`/wallets/${address}`}
                            className="flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-md border border-transparent bg-amber-600 text-white hover:bg-amber-500"
                        >
                            <Info className="h-3 w-3 mr-1" />
                            Details
                        </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Open wallet profile page</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});

WalletBadge.displayName = "WalletBadge"; 