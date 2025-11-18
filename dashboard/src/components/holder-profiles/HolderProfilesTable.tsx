import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Info, ExternalLink } from 'lucide-react';
import Link from 'next/link';

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

interface HolderProfilesTableProps {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  tokenMint?: string;
  targetWallet?: string;
}

const formatHoldTime = (hours: number | null): string => {
  if (hours === null) return '—';

  // Ultra-precise for very short holds (< 1 hour)
  if (hours < 1) {
    const minutes = hours * 60;
    if (minutes < 1) {
      const seconds = Math.round(minutes * 60);
      return `${seconds}s`;
    }
    return `${Math.round(minutes)}m`;
  }

  // Precise for intraday holds (1-24 hours)
  if (hours < 24) {
    // Show both hours and minutes for better granularity
    const wholeHours = Math.floor(hours);
    const remainingMinutes = Math.round((hours - wholeHours) * 60);

    if (remainingMinutes === 0) {
      return `${wholeHours}h`;
    }
    return `${wholeHours}h ${remainingMinutes}m`;
  }

  // Days for longer holds
  const days = hours / 24;
  if (days < 7) {
    return `${days.toFixed(1)}d`;
  }

  // Weeks for very long holds
  const weeks = days / 7;
  return `${weeks.toFixed(1)}w`;
};

const formatAddress = (address: string): string => {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

const getDataQualityColor = (
  tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT'
): string => {
  switch (tier) {
    case 'HIGH':
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
    case 'MEDIUM':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
    case 'LOW':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20';
    case 'INSUFFICIENT':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
  }
};

const getBehaviorColor = (behaviorType: string | null): string => {
  if (!behaviorType) return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';

  switch (behaviorType) {
    case 'SNIPER':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
    case 'SCALPER':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20';
    case 'MOMENTUM':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20';
    case 'INTRADAY':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    case 'DAY_TRADER':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
    case 'SWING':
      return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20';
    case 'POSITION':
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
    case 'HOLDER':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
    default:
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
  }
};

const getBehaviorDescription = (behaviorType: string | null): string => {
  if (!behaviorType) return 'No classification available';

  const descriptions: Record<string, string> = {
    'SNIPER': '< 1 minute — Bot/MEV behavior',
    'SCALPER': '1-5 minutes — Ultra-fast scalping',
    'MOMENTUM': '5-30 minutes — Momentum trading',
    'INTRADAY': '30 minutes - 4 hours — Short-term intraday',
    'DAY_TRADER': '4-24 hours — Day trading',
    'SWING': '1-7 days — Swing trading',
    'POSITION': '7-30 days — Position trading',
    'HOLDER': '30+ days — Long-term holding'
  };

  return descriptions[behaviorType] || behaviorType;
};

const formatBehaviorType = (behaviorType: string | null): string => {
  if (!behaviorType) return '—';
  return behaviorType.replace('_', ' ');
};

const formatContext = (mode: 'token' | 'wallet', tokenMint?: string, targetWallet?: string) => {
  if (mode === 'token') {
    return tokenMint ? `Token ${formatAddress(tokenMint)}` : 'Token holders';
  }
  return targetWallet ? `Wallet ${formatAddress(targetWallet)}` : 'Wallet profile';
};

export function HolderProfilesTable({ profiles, mode, tokenMint, targetWallet }: HolderProfilesTableProps) {
  return (
    <Card className="p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">
          {mode === 'token' ? 'Holder Profiles' : 'Wallet Holder Profile'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'token'
            ? `${profiles.length} holder${profiles.length === 1 ? '' : 's'} analyzed — ${formatContext(mode, tokenMint, targetWallet)}`
            : formatContext(mode, tokenMint, targetWallet)}
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Rank</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead className="text-right">Supply %</TableHead>
              <TableHead className="text-right">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="flex items-center gap-1 ml-auto">
                      Median Hold <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Median holding time across all completed positions</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="text-right">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="flex items-center gap-1 ml-auto">
                      Avg Hold <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Weighted average holding time (accounts for position size)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="text-right">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="flex items-center gap-1 ml-auto">
                      Flip Ratio <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>% of completed positions held &lt;5min (higher = more flipping)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead>Behavior Type</TableHead>
              <TableHead>Exit Pattern</TableHead>
              <TableHead>Data Quality</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((profile) => (
              <TableRow key={profile.walletAddress}>
                <TableCell className="font-medium">
                  {mode === 'token' ? `#${profile.rank}` : '—'}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/wallets/${profile.walletAddress}`}
                    className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {formatAddress(profile.walletAddress)}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  {mode === 'token' ? `${profile.supplyPercent.toFixed(2)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {formatHoldTime(profile.medianHoldTimeHours)}
                </TableCell>
                <TableCell className="text-right">
                  {formatHoldTime(profile.avgHoldTimeHours)}
                </TableCell>
                <TableCell className="text-right">
                  {profile.dailyFlipRatio !== null
                    ? `${profile.dailyFlipRatio.toFixed(1)}%`
                    : '—'}
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className={getBehaviorColor(profile.behaviorType)}>
                          {formatBehaviorType(profile.behaviorType)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{getBehaviorDescription(profile.behaviorType)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {profile.exitPattern || '—'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge
                          variant="outline"
                          className={getDataQualityColor(profile.dataQualityTier)}
                        >
                          {profile.dataQualityTier}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p className="font-semibold">
                            {profile.completedCycleCount} completed cycles
                          </p>
                          <p>Confidence: {(profile.confidence * 100).toFixed(0)}%</p>
                          {profile.insufficientDataReason && (
                            <p className="text-yellow-500">{profile.insufficientDataReason}</p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}