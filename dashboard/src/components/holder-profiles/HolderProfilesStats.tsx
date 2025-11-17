import { Card } from '@/components/ui/card';
import { Clock, TrendingUp, Users, Zap } from 'lucide-react';

interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;
  behaviorType: string | null;
  exitPattern: string | null;
  dataQualityTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  completedCycleCount: number;
  confidence: number;
  insufficientDataReason?: string;
  processingTimeMs: number;
}

interface HolderProfilesResult {
  mode: 'token' | 'wallet';
  tokenMint?: string;
  targetWallet?: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
  };
}

interface HolderProfilesStatsProps {
  result: HolderProfilesResult;
}

const formatHoldTime = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

const formatAddress = (address?: string): string => {
  if (!address) return '—';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

export function HolderProfilesStats({ result }: HolderProfilesStatsProps) {
  const validProfiles = result.profiles.filter((p) => p.dataQualityTier !== 'INSUFFICIENT');

  const avgMedianHoldTime =
    validProfiles.length > 0
      ? validProfiles.reduce((sum, p) => sum + (p.medianHoldTimeHours || 0), 0) /
        validProfiles.length
      : 0;

  const avgFlipRatio =
    validProfiles.length > 0
      ? validProfiles.reduce((sum, p) => sum + (p.dailyFlipRatio || 0), 0) / validProfiles.length
      : 0;

  const behaviorTypeCounts = validProfiles.reduce(
    (acc, p) => {
      if (p.behaviorType) {
        acc[p.behaviorType] = (acc[p.behaviorType] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  const dominantBehavior = Object.entries(behaviorTypeCounts).sort((a, b) => b[1] - a[1])[0];

  const highQualityCount = result.profiles.filter((p) => p.dataQualityTier === 'HIGH').length;

  const contextLabel =
    result.mode === 'token'
      ? `Token: ${formatAddress(result.tokenMint)}`
      : `Wallet: ${formatAddress(result.targetWallet)}`;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">{contextLabel}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Avg Median Hold Time</p>
            <p className="text-2xl font-bold">{formatHoldTime(avgMedianHoldTime)}</p>
          </div>
          <Clock className="h-8 w-8 text-blue-500 opacity-20" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Across {validProfiles.length} holders with data
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Avg Flip Ratio</p>
            <p className="text-2xl font-bold">{avgFlipRatio.toFixed(1)}%</p>
          </div>
          <Zap className="h-8 w-8 text-orange-500 opacity-20" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {avgFlipRatio > 50 ? 'High flipping activity' : 'Lower flipping activity'}
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Dominant Behavior</p>
            <p className="text-2xl font-bold">
              {dominantBehavior ? dominantBehavior[0].replace('_', ' ') : '—'}
            </p>
          </div>
          <TrendingUp className="h-8 w-8 text-green-500 opacity-20" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {dominantBehavior ? `${dominantBehavior[1]} holders` : 'No data'}
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">High Quality Data</p>
            <p className="text-2xl font-bold">
              {highQualityCount}/{result.profiles.length}
            </p>
          </div>
          <Users className="h-8 w-8 text-purple-500 opacity-20" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {((highQualityCount / result.profiles.length) * 100).toFixed(0)}% confidence
        </p>
      </Card>
      </div>
    </div>
  );
}
