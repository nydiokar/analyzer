import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CombinedSimilarityResult } from './types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, Users, TrendingUp } from 'lucide-react';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { Badge } from '@/components/ui/badge';

interface OverlapHeatmapProps {
  results: CombinedSimilarityResult;
}

export function OverlapHeatmap({ results }: OverlapHeatmapProps) {
  const meaningfulConnections = useMemo(() => {
    if (!results.sharedTokenCountsMatrix) {
      return null;
    }

    const matrix = results.sharedTokenCountsMatrix;
    const connections: { 
      walletA: string; 
      walletB: string; 
      sharedCount: number; 
      totalTokensA: number; 
      totalTokensB: number; 
      connectionStrength: 'Strong' | 'Moderate' | 'Weak';
      overlapPercentage: number;
    }[] = [];

    Object.keys(matrix).forEach(walletA => {
      Object.keys(matrix[walletA]).forEach(walletB => {
        if (walletA < walletB) { // Avoid duplicates
          const sharedCount = matrix[walletA][walletB];
          
          // Only include pairs with actual overlap
          if (sharedCount > 0) {
            const totalTokensA = results.uniqueTokensPerWallet[walletA]?.binary || 0;
            const totalTokensB = results.uniqueTokensPerWallet[walletB]?.binary || 0;
            
            // Calculate overlap as percentage of smaller portfolio
            const smallerPortfolio = Math.min(totalTokensA, totalTokensB);
            const overlapPercentage = smallerPortfolio > 0 ? (sharedCount / smallerPortfolio) * 100 : 0;
            
            // Categorize connection strength based on practical thresholds
            let connectionStrength: 'Strong' | 'Moderate' | 'Weak';
            if (overlapPercentage >= 50) connectionStrength = 'Strong';
            else if (overlapPercentage >= 20) connectionStrength = 'Moderate';
            else connectionStrength = 'Weak';
            
            connections.push({
              walletA,
              walletB,
              sharedCount,
              totalTokensA,
              totalTokensB,
              connectionStrength,
              overlapPercentage
            });
          }
        }
      });
    });

    return connections.sort((a, b) => b.overlapPercentage - a.overlapPercentage);
  }, [results.sharedTokenCountsMatrix, results.uniqueTokensPerWallet]);

  if (!results.sharedTokenCountsMatrix || !meaningfulConnections || meaningfulConnections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Wallet Connections
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Shows meaningful token overlap relationships between wallets</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <CardDescription>
            Discover which wallets share similar token holdings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <div className="text-center">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No significant token overlap found between wallets</p>
              <p className="text-xs mt-1">Each wallet has a unique portfolio composition</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStrengthVariant = (strength: string) => {
    switch (strength) {
      case 'Strong': return 'default';
      case 'Moderate': return 'secondary';
      case 'Weak': return 'outline';
      default: return 'outline';
    }
  };

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'Strong': return 'text-green-600';
      case 'Moderate': return 'text-yellow-600';
      case 'Weak': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Wallet Connections
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Ranked by how much of the smaller portfolio is shared</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        <CardDescription>
          {meaningfulConnections.length} meaningful connections found • Showing wallets with shared tokens
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {meaningfulConnections.slice(0, 6).map((connection, index) => (
          <div key={`${connection.walletA}-${connection.walletB}`} className="p-4 rounded-lg border bg-card/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-mono w-6">#{index + 1}</span>
                <div className="flex items-center gap-2">
                  <WalletBadge address={connection.walletA} />
                  <span className="text-muted-foreground text-sm">shares with</span>
                  <WalletBadge address={connection.walletB} />
                </div>
              </div>
              <Badge 
                variant={getStrengthVariant(connection.connectionStrength)}
                className="text-xs"
              >
                {connection.connectionStrength}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Portfolio overlap:</span>
                <span className={`font-semibold ${getStrengthColor(connection.connectionStrength)}`}>
                  {connection.overlapPercentage.toFixed(0)}%
                </span>
              </div>
              <span className="text-muted-foreground">
                {connection.sharedCount} shared tokens
              </span>
            </div>
          </div>
        ))}
        
        {meaningfulConnections.length > 6 && (
          <div className="pt-2 border-t text-center">
            <p className="text-xs text-muted-foreground">
              +{meaningfulConnections.length - 6} more connections with lower overlap
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 