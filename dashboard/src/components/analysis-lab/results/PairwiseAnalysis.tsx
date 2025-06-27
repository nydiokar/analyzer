'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CombinedSimilarityResult, CombinedPairwiseSimilarity } from "./types";
import { shortenAddress } from '@/lib/solana-utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PairwiseAnalysisProps {
  results: CombinedSimilarityResult;
}

type SortKey = 'binaryScore' | 'capitalScore';

const ScoreBar = ({ score, label, colorClass }: { score: number, label: string, colorClass: string }) => (
    <div>
        <div className="flex justify-between items-center mb-1">
            <span className={`text-xs font-medium ${colorClass}`}>{label}</span>
            <span className={`text-xs font-semibold ${colorClass}`}>{score.toFixed(3)}</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2.5">
            <div className={`${colorClass.replace('text', 'bg')} h-2.5 rounded-full`} style={{ width: `${score * 100}%` }}></div>
        </div>
    </div>
);

const PairCard = ({ pair, walletLabels, results, sortKey }: { pair: CombinedPairwiseSimilarity, walletLabels: Record<string, string>, results: CombinedSimilarityResult, sortKey: SortKey }) => {
    const { walletA, walletB, binaryScore, capitalScore, sharedTokens, capitalAllocation } = pair;
    const { uniqueTokensPerWallet } = results;

    const uniqueTokensA = uniqueTokensPerWallet[walletA]?.binary || 0;
    const uniqueTokensB = uniqueTokensPerWallet[walletB]?.binary || 0;
    const uniqueCapitalTokensA = uniqueTokensPerWallet[walletA]?.capital || 0;
    const uniqueCapitalTokensB = uniqueTokensPerWallet[walletB]?.capital || 0;

    const sharedBehavioralPctA = uniqueTokensA > 0 ? (sharedTokens.length / uniqueTokensA) * 100 : 0;
    const sharedCapitalPctA = uniqueCapitalTokensA > 0 ? (sharedTokens.length / uniqueCapitalTokensA) * 100 : 0;
    
    const isCapitalSort = sortKey === 'capitalScore';

    const topSharedTokens = useMemo(() => {
        const sorted = [...sharedTokens];
        if (isCapitalSort) {
            sorted.sort((a, b) => (capitalAllocation[b.mint].weightA + capitalAllocation[b.mint].weightB) - (capitalAllocation[a.mint].weightA + capitalAllocation[a.mint].weightB));
        }
        return sorted.slice(0, 5);
    }, [sharedTokens, sortKey, capitalAllocation]);


    return (
        <AccordionItem value={`item-${walletA}-${walletB}`} className="border rounded-lg px-3">
            <AccordionTrigger>
                <div className="w-full">
                    <div className="flex justify-between items-center mb-3">
                        <div className="font-semibold space-x-2">
                            <Badge variant="outline">{walletLabels[walletA] || shortenAddress(walletA)}</Badge>
                            <span>↔️</span>
                            <Badge variant="outline">{walletLabels[walletB] || shortenAddress(walletB)}</Badge>
                        </div>
                    </div>
                    <div className="w-full space-y-2">
                       <ScoreBar score={binaryScore} label="Behavioral" colorClass="text-blue-500" />
                       <ScoreBar score={capitalScore} label="Capital" colorClass="text-emerald-500" />
                    </div>
                </div>
            </AccordionTrigger>
            <AccordionContent>
                <div className="space-y-3 pt-2">
                    <p className="text-sm text-muted-foreground">
                        Sharing <span className="font-bold">{sharedTokens.length}</span> tokens. 
                        This represents <span className="font-bold">
                            {isCapitalSort ? sharedCapitalPctA.toFixed(1) : sharedBehavioralPctA.toFixed(1)}%
                        </span> of {walletLabels[walletA]}'s {isCapitalSort ? 'capital deployment' : 'behavioral activity'}.
                    </p>
                    {topSharedTokens.length > 0 && (
                        <div>
                             <h4 className="text-sm font-semibold mb-2">
                                Top 5 Shared Tokens {isCapitalSort ? '(by Capital)' : '(by Interaction)'}
                             </h4>
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Token</TableHead>
                                        {isCapitalSort ? (
                                            <>
                                                <TableHead className="text-right">{walletLabels[walletA]} Allocation</TableHead>
                                                <TableHead className="text-right">{walletLabels[walletB]} Allocation</TableHead>
                                            </>
                                        ) : (
                                            <>
                                                <TableHead className="text-right">{walletLabels[walletA]}</TableHead>
                                                <TableHead className="text-right">{walletLabels[walletB]}</TableHead>
                                            </>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topSharedTokens.map(token => (
                                        <TableRow key={token.mint}>
                                            <TableCell className="font-mono text-xs truncate" title={token.mint}>{shortenAddress(token.mint, 10)}</TableCell>
                                            {isCapitalSort ? (
                                                <>
                                                    <TableCell className="text-right">{(capitalAllocation[token.mint].weightA * 100).toFixed(2)}%</TableCell>
                                                    <TableCell className="text-right">{(capitalAllocation[token.mint].weightB * 100).toFixed(2)}%</TableCell>
                                                </>
                                            ) : (
                                                <>
                                                    <TableCell className="text-right text-emerald-500">Traded</TableCell>
                                                    <TableCell className="text-right text-emerald-500">Traded</TableCell>
                                                </>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </AccordionContent>
        </AccordionItem>
    );
};

export function PairwiseAnalysis({ results }: PairwiseAnalysisProps) {
    const [sortKey, setSortKey] = useState<SortKey>('binaryScore');
    
    const walletLabels = Object.keys(results.walletVectorsUsed).reduce((acc, address) => {
        acc[address] = shortenAddress(address, 6);
        return acc;
    }, {} as Record<string, string>);

    const sortedPairs = [...results.pairwiseSimilarities]
        .sort((a, b) => b[sortKey] - a[sortKey]);

    return (
        <Card className="border">
            <CardHeader>
                <CardTitle>Pairwise Deep Dive</CardTitle>
                <CardDescription>
                    Expand each pair for a detailed breakdown of shared tokens and capital allocation.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="binaryScore">Sort by Behavioral</TabsTrigger>
                        <TabsTrigger value="capitalScore">Sort by Capital</TabsTrigger>
                    </TabsList>
                </Tabs>
                <ScrollArea className="h-[400px] mt-4">
                     <Accordion type="single" collapsible className="w-full space-y-3">
                        {sortedPairs.map((pair) => (
                           <PairCard key={`${pair.walletA}-${pair.walletB}`} pair={pair} walletLabels={walletLabels} results={results} sortKey={sortKey} />
                        ))}
                    </Accordion>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
