import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ComprehensiveSimilarityResult, WalletSimilarity } from "./types";
import { shortenAddress } from "@/lib/solana-utils";

interface TopSimilarPairsProps {
  results: ComprehensiveSimilarityResult;
}

export function TopSimilarPairs({ results }: TopSimilarPairsProps) {
  const topPairs = results.globalMetrics.mostSimilarPairs;

  return (
    <Card className="border">
      <CardHeader>
        <CardTitle>Top 10 Most Similar Pairs</CardTitle>
        <CardDescription>
          Highest scoring pairs by {results.vectorTypeUsed} similarity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          {topPairs.map((pair: WalletSimilarity, index: number) => (
            <AccordionItem value={`item-${index}`} key={`${pair.walletA}-${pair.walletB}`}>
              <AccordionTrigger>
                <div className="flex justify-between items-center w-full pr-4 text-sm">
                  <span className="font-semibold text-muted-foreground"># {index + 1}</span>
                  <div className="flex flex-col md:flex-row md:items-center gap-x-2 font-mono">
                    <span>{shortenAddress(pair.walletA)}</span>
                    <span className="text-muted-foreground">&</span>
                    <span>{shortenAddress(pair.walletB)}</span>
                  </div>
                  <span className="font-semibold">Score: {pair.similarityScore.toFixed(4)}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="p-4 bg-muted/50 rounded-md">
                  <h4 className="font-semibold mb-2 text-sm">Top 5 Shared Tokens</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Token</TableHead>
                        {results.vectorTypeUsed === 'capital' && (
                            <>
                                <TableHead className="text-right">% of Wallet A's Capital</TableHead>
                                <TableHead className="text-right">% of Wallet B's Capital</TableHead>
                            </>
                        )}
                         {results.vectorTypeUsed === 'binary' && (
                            <>
                                <TableHead className="text-right">Wallet A</TableHead>
                                <TableHead className="text-right">Wallet B</TableHead>
                            </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pair.sharedTokens.slice(0, 5).map((token: { mint: string; weightA: number; weightB: number; }) => (
                        <TableRow key={token.mint}>
                          <TableCell className="font-mono">{shortenAddress(token.mint)}</TableCell>
                           {results.vectorTypeUsed === 'capital' ? (
                            <>
                                <TableCell className="text-right">{(token.weightA * 100).toFixed(2)}%</TableCell>
                                <TableCell className="text-right">{(token.weightB * 100).toFixed(2)}%</TableCell>
                            </>
                           ) : (
                            <>
                                <TableCell className="text-right">{token.weightA > 0 ? 'Traded' : '-'}</TableCell>
                                <TableCell className="text-right">{token.weightB > 0 ? 'Traded' : '-'}</TableCell>
                            </>
                           )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
} 