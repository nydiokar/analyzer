import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ComprehensiveSimilarityResult } from "./types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { shortenAddress } from "@/lib/solana-utils";

interface MostCommonTokensProps {
  results: ComprehensiveSimilarityResult;
}

export function MostCommonTokens({ results }: MostCommonTokensProps) {
  const commonTokens = results.fullSharedTokenList
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
                <span className="font-mono text-muted-foreground">{shortenAddress(token.mint, 8)}</span>
                <span className="font-semibold">{token.count} wallets</span>
              </li>
            ))}
            {commonTokens.length === 0 && (
                <p className="text-muted-foreground text-center">No commonly held tokens found.</p>
            )}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
} 