import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ComprehensiveSimilarityResult } from "./types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface MostCommonTokensProps {
  results: ComprehensiveSimilarityResult;
}

function CopyButton({ textToCopy }: { textToCopy: string }) {
  const [isCopied, setIsCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      toast({ description: "Copied to clipboard!" });
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast({ variant: "destructive", description: "Failed to copy." });
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} className="h-7 w-7">
      {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

export function MostCommonTokens({ results }: MostCommonTokensProps) {
  const commonTokens = (results.fullSharedTokenList || [])
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return (
    <Card className="h-full border">
      <CardHeader>
        <CardTitle>Most Common Tokens</CardTitle>
        <CardDescription>Top tokens shared across the wallet set.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          <ul className="space-y-3">
            {commonTokens.map((token) => (
              <li key={token.mint} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                   <Avatar className="h-6 w-6">
                    <AvatarFallback>{token.mint.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-mono">{token.mint}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                    <span className="font-semibold">{token.count} wallets</span>
                    <CopyButton textToCopy={token.mint} />
                </div>
              </li>
            ))}
            {commonTokens.length === 0 && (
                <p className="text-muted-foreground text-center">No common historical tokens found.</p>
            )}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
} 