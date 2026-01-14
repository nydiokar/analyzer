import { cn } from '@/lib/utils';
import { formatPercentage, formatAddress } from './utils/formatters';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface SimilarityPairData {
  walletA: string;
  walletB: string;
  overallScore: number; // 0-1
  behavioralScore: number; // 0-1
  capitalScore: number; // 0-1
  sharedTokensCount: number;
  uniqueTokensA: number;
  uniqueTokensB: number;
}

interface Props {
  pair: SimilarityPairData;
  rank?: number;
  /** Map of wallet address to rank in the holders table */
  walletRanks?: Map<string, number>;
  /** Whether this pair is currently selected */
  isSelected?: boolean;
  /** Callback when the pair is clicked */
  onClick?: () => void;
}

function getScoreColor(score: number): string {
  if (score >= 0.7) return 'text-emerald-400';
  if (score >= 0.5) return 'text-blue-400';
  if (score >= 0.3) return 'text-amber-400';
  return 'text-zinc-400';
}

function getScoreGradient(score: number): string {
  if (score >= 0.7) return 'from-emerald-500/15 via-emerald-500/5 to-transparent';
  if (score >= 0.5) return 'from-blue-500/15 via-blue-500/5 to-transparent';
  if (score >= 0.3) return 'from-amber-500/15 via-amber-500/5 to-transparent';
  return 'from-zinc-500/15 via-zinc-500/5 to-transparent';
}

function getScoreBarColor(score: number): string {
  if (score >= 0.7) return 'bg-emerald-500';
  if (score >= 0.5) return 'bg-blue-500';
  if (score >= 0.3) return 'bg-amber-500';
  return 'bg-zinc-500';
}

export function SimilarityPairRibbon({ pair, rank, walletRanks, isSelected, onClick }: Props) {
  const overallPercent = pair.overallScore * 100;
  const behavioralPercent = pair.behavioralScore * 100;
  const capitalPercent = pair.capitalScore * 100;

  // Get table ranks for each wallet
  const rankA = walletRanks?.get(pair.walletA);
  const rankB = walletRanks?.get(pair.walletB);

  return (
    <TooltipProvider delayDuration={150}>
      <div
        onClick={onClick}
        className={cn(
          'group relative rounded-lg border overflow-hidden',
          'bg-gradient-to-r',
          getScoreGradient(pair.overallScore),
          'transition-all duration-200',
          onClick && 'cursor-pointer',
          isSelected
            ? 'border-primary/60 ring-1 ring-inset ring-primary/40 shadow-sm'
            : 'border-border/40 hover:border-border/70 hover:shadow-sm'
        )}
      >
        {/* Main content */}
        <div className="px-3 py-2.5 space-y-2.5">
          {/* Header: Wallets + Overall Score */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs min-w-0">
              {rank && (
                <span className="text-[10px] text-foreground/40 font-mono shrink-0">#{rank}</span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-foreground/70 truncate cursor-help hover:text-foreground transition-colors">
                    {rankA ? `#${rankA} ` : ''}{formatAddress(pair.walletA)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-mono text-xs">{pair.walletA}</p>
                </TooltipContent>
              </Tooltip>
              <span className="text-foreground/30 shrink-0">↔</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-foreground/70 truncate cursor-help hover:text-foreground transition-colors">
                    {rankB ? `#${rankB} ` : ''}{formatAddress(pair.walletB)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-mono text-xs">{pair.walletB}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('text-lg font-semibold tabular-nums cursor-help shrink-0', getScoreColor(pair.overallScore))}>
                  {formatPercentage(overallPercent, 0)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs max-w-xs">
                <p className="text-muted-foreground">Overall similarity = 0.6 behavior + 0.4 capital.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Score bars */}
          <div className="flex gap-3">
            {/* Behavioral */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-foreground/50 uppercase tracking-wide font-medium">Behavior</span>
                <span className="tabular-nums text-foreground/70 font-medium">{formatPercentage(behavioralPercent, 0)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', getScoreBarColor(pair.behavioralScore))}
                  style={{ width: `${behavioralPercent}%` }}
                />
              </div>
            </div>

            {/* Capital */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-foreground/50 uppercase tracking-wide font-medium">Capital</span>
                <span className="tabular-nums text-foreground/70 font-medium">{formatPercentage(capitalPercent, 0)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', getScoreBarColor(pair.capitalScore))}
                  style={{ width: `${capitalPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Shared tokens footer */}
          <div className="flex items-center justify-between text-[10px] pt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-foreground/50 cursor-help">
                  <span className="font-semibold text-foreground/70">{pair.sharedTokensCount}</span> shared tokens
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-xs">
                <p className="text-muted-foreground">Tokens traded by both wallets.</p>
              </TooltipContent>
            </Tooltip>
            <span className="text-foreground/40">
              {pair.uniqueTokensA} + {pair.uniqueTokensB} unique
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
