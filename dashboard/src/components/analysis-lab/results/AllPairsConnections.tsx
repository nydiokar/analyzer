import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComprehensiveSimilarityResult } from "./types";
import { getConnectionStrength, Connection, ConnectionStrength } from '@/lib/similarity-report-parser';
import { shortenAddress } from '@/lib/solana-utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AllPairsConnectionsProps {
  results: ComprehensiveSimilarityResult;
}

const getStrengthBadgeVariant = (strength: ConnectionStrength) => {
    switch (strength) {
        case ConnectionStrength.Strongly: return "destructive";
        case ConnectionStrength.Mildly: return "secondary";
        case ConnectionStrength.Barely: return "outline";
        default: return "default";
    }
}

const ConnectionList = ({ connections }: { connections: Connection[] }) => {
    if (connections.length === 0) {
        return <p className="text-sm text-muted-foreground p-4 text-center">No connections in this category.</p>;
    }

    return (
        <ul className="space-y-3">
            {connections.map((conn, index) => (
                <li key={index} className="text-sm border-b pb-2">
                    <div className="flex justify-between items-center">
                        <div className="font-semibold space-x-2">
                            <Badge variant="outline">{conn.wallets[0]}</Badge>
                            <span>↔️</span>
                            <Badge variant="outline">{conn.wallets[1]}</Badge>
                        </div>
                         <Badge variant={getStrengthBadgeVariant(conn.strength)}>{conn.strength.replace(' Connected', '')}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center space-x-1"><span>🤝</span> <span>Shared tokens: <strong>{conn.details_data.shared_tokens}</strong></span></div>
                                </TooltipTrigger>
                                <TooltipContent>Total shared tokens</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center space-x-1"><span>🎯</span> <span>Sim Score: <strong>{conn.details_data.primary_sim.toFixed(3)}</strong></span></div>
                                </TooltipTrigger>
                                <TooltipContent>Primary Similarity ({conn.details_data.primary_sim >= 0.5 ? 'Good' : 'Low'})</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                     <div className="flex items-center space-x-1"><span>📈</span> <span>A overlap: <strong>{conn.details_data.wallet_a_pct.toFixed(1)}%</strong></span></div>
                                </TooltipTrigger>
                                <TooltipContent>Percentage of Wallet A's tokens that are shared</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center space-x-1"><span>📉</span> <span>B overlap: <strong>{conn.details_data.wallet_b_pct.toFixed(1)}%</strong></span></div>
                                </TooltipTrigger>
                                <TooltipContent>Percentage of Wallet B's tokens that are shared</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </li>
            ))}
        </ul>
    );
};


export function AllPairsConnections({ results }: AllPairsConnectionsProps) {
    const connections = useMemo(() => {
        const walletLabels = Object.keys(results.walletVectorsUsed).reduce((acc, address) => {
            acc[address] = shortenAddress(address, 6);
            return acc;
        }, {} as Record<string, string>);

        return getConnectionStrength(results, walletLabels);
    }, [results]);

    const strongly = connections.filter(c => c.strength === ConnectionStrength.Strongly);
    const mildly = connections.filter(c => c.strength === ConnectionStrength.Mildly);
    const barely = connections.filter(c => c.strength === ConnectionStrength.Barely);

    return (
        <Card className="border">
            <CardHeader>
                <CardTitle>All Pairs Connection Strength</CardTitle>
                <CardDescription>
                    Categorized view of all wallet pairs based on connection strength.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="strongly">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="strongly">Strong ({strongly.length})</TabsTrigger>
                        <TabsTrigger value="mildly">Mild ({mildly.length})</TabsTrigger>
                        <TabsTrigger value="barely">Barely ({barely.length})</TabsTrigger>
                    </TabsList>
                    <ScrollArea className="h-[350px] mt-4">
                        <TabsContent value="strongly">
                            <ConnectionList connections={strongly} />
                        </TabsContent>
                        <TabsContent value="mildly">
                             <ConnectionList connections={mildly} />
                        </TabsContent>
                        <TabsContent value="barely">
                             <ConnectionList connections={barely} />
                        </TabsContent>
                    </ScrollArea>
                </Tabs>
            </CardContent>
        </Card>
    );
} 