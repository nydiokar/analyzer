'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from '@/components/layout/AppShell';
import { PageTitle } from '@/components/shared/PageTitle';
import { WalletBadge } from '@/components/shared/WalletBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fetcher } from '@/lib/fetcher';
import { isValidSolanaAddress } from '@/lib/solana-utils';
import { cn } from '@/lib/utils';
import { useJobProgress } from '@/hooks/useJobProgress';
import type { JobProgressData, JobCompletionData, JobFailedData } from '@/types/websockets';
import {
  Users,
  CalendarIcon,
  Loader2,
  TrendingUp,
  TrendingDown,
  Copy,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────

interface SigBuyerResult {
  walletAddress: string;
  solSpent: number;
  solReceived: number;
  netPnl: number;
  transactionCount: number;
  firstTransactionAt: string;
  lastTransactionAt: string;
}

interface SigBuyersResponse {
  mint: string;
  startTime: number;
  endTime: number;
  minSolSpent: number;
  totalTransactionsFetched: number;
  totalWalletsFound: number;
  qualifyingWallets: number;
  buyers: SigBuyerResult[];
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────

function formatSol(val: number): string {
  return val.toFixed(3);
}

function formatTime(iso: string): string {
  return iso.slice(11, 19); // Extract HH:MM:SS directly from ISO string — always UTC
}

// All times are treated as UTC — consistent with blockchain explorers (Solscan, etc.)
function utcDateTimeToUnix(dateStr: string, timeStr: string): number | null {
  if (!dateStr || !timeStr) return null;
  const combined = `${dateStr}T${timeStr}:00Z`; // Z suffix forces UTC interpretation
  const d = new Date(combined);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function unixToUtcDateStr(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function unixToUtcTimeStr(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// ── DateTimePicker ─────────────────────────────────────────────────

interface DateTimePickerProps {
  label: string;
  dateStr: string;
  timeStr: string;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
}

function DateTimePicker({ label, dateStr, timeStr, onDateChange, onTimeChange }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);

  // dateStr is "YYYY-MM-DD". Parse parts directly — no Date object, no timezone involvement.
  const displayLabel = dateStr
    ? (() => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${d}, ${y}`;
      })()
    : 'Pick date';

  // Calendar needs a Date to highlight the selected day. Use local noon so no timezone
  // rolls the date forward or back regardless of where the browser is running.
  const selectedDate = dateStr ? new Date(`${dateStr}T12:00:00`) : undefined;

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-[130px] h-8 text-xs justify-start font-normal',
                !dateStr && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="h-3 w-3 mr-1.5 shrink-0" />
              {displayLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => {
                if (d) {
                  // Calendar gives local-midnight Date. Read local parts — that's exactly
                  // the calendar date the user clicked, no conversion needed.
                  onDateChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                }
                setOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        <Input
          type="time"
          value={timeStr}
          onChange={(e) => onTimeChange(e.target.value)}
          className="h-8 text-xs w-[100px]"
          step={60}
        />
      </div>
    </div>
  );
}

// ── Result Row ────────────────────────────────────────────────────

interface BuyerRowProps {
  buyer: SigBuyerResult;
  rank: number;
}

function BuyerRow({ buyer, rank }: BuyerRowProps) {
  const pnlPositive = buyer.netPnl > 0;
  const pnlNeutral = Math.abs(buyer.netPnl) < 0.001;

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-accent/40 group border-b border-border/20 last:border-0">
      {/* Time */}
      <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-[48px]">
        {formatTime(buyer.firstTransactionAt)}
      </span>

      {/* Wallet */}
      <div className="w-[220px] shrink-0 min-w-0">
        <WalletBadge
          address={buyer.walletAddress}
          size="s"
          variant="minimal"
          showHud={true}
          hudDisplay="tooltip"
          showActions={true}
          visibleActions={{ copy: true, solscan: true, profile: true }}
        />
      </div>

      {/* SOL Spent */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm font-semibold tabular-nums text-foreground shrink-0 w-[80px] text-right cursor-default">
              {formatSol(buyer.solSpent)}{' '}
              <span className="text-xs text-muted-foreground font-normal">SOL</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">Received back: {formatSol(buyer.solReceived)} SOL</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Net PnL */}
      <div className={cn(
        'flex items-center gap-1 shrink-0 w-[72px] justify-end',
        pnlNeutral ? 'text-muted-foreground' : pnlPositive ? 'text-emerald-400' : 'text-rose-400'
      )}>
        {!pnlNeutral && (pnlPositive
          ? <TrendingUp className="h-3 w-3 shrink-0" />
          : <TrendingDown className="h-3 w-3 shrink-0" />
        )}
        <span className="text-xs font-medium tabular-nums">
          {pnlNeutral ? '—' : `${pnlPositive ? '+' : ''}${formatSol(buyer.netPnl)}`}
        </span>
      </div>

      {/* TX count */}
      <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-[28px] text-right">
        {buyer.transactionCount}
      </span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function SigBuyersPage() {
  const router = useRouter();
  const { user, isAuthenticated, isInitialized } = useAuth();

  // ── Analyst gate ──
  const isAuthorized = isInitialized && isAuthenticated && (!!user?.isAnalyst || !!user?.isAdmin);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthorized) router.replace('/');
  }, [isInitialized, isAuthorized, router]);

  // Form state
  const [mint, setMint] = useState('');
  const [startDateStr, setStartDateStr] = useState('');
  const [startTimeStr, setStartTimeStr] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('5');
  const [minSolSpent, setMinSolSpent] = useState('0.5');

  // Job state
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SigBuyersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const unsubscribeFromJobRef = useRef<((jobId: string) => void) | null>(null);

  const mintValid = mint.length > 0 && isValidSolanaAddress(mint);
  const mintTouched = mint.length > 0;

  // Derive end time from start + duration (all UTC)
  const startTs = utcDateTimeToUnix(startDateStr, startTimeStr);
  const durationSec = Math.max(1, parseInt(durationMinutes, 10) || 5) * 60;
  const endTs = startTs ? startTs + durationSec : null;

  const canSubmit = mintValid && startTs !== null && !isLoading;

  const { subscribeToJob, unsubscribeFromJob } = useJobProgress({
    onJobProgress: useCallback((data: JobProgressData) => {
      if (jobIdRef.current && data.jobId === jobIdRef.current) {
        if (typeof data.progress === 'number') {
          setProgress(data.progress);
        }
      }
    }, []),

    onJobCompleted: useCallback(async (data: JobCompletionData) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;

      unsubscribeFromJobRef.current?.(jobIdRef.current);

      // Hydrate via result pointer if present
      const resultKey = (data.result as any)?.data?.resultKey as string | undefined;
      let resolved: SigBuyersResponse | null = null;

      if (resultKey) {
        try {
          resolved = await fetcher(`/jobs/result/by-key?key=${encodeURIComponent(resultKey)}`) as SigBuyersResponse;
        } catch {
          // fall through to inline result
        }
      }

      if (!resolved) {
        resolved = ((data.result as any)?.data ?? data.result) as SigBuyersResponse | null;
      }

      setProgress(100);
      setIsLoading(false);
      jobIdRef.current = null;

      if (resolved) {
        setResult(resolved);
        if (resolved.buyers.length === 0) {
          toast.info('No qualifying wallets found in this window.');
        } else {
          toast.success(`Found ${resolved.qualifyingWallets} wallets spending ≥ ${resolved.minSolSpent} SOL`);
        }
      }
    }, []),

    onJobFailed: useCallback((data: JobFailedData) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;
      unsubscribeFromJobRef.current?.(jobIdRef.current);
      jobIdRef.current = null;
      setIsLoading(false);
      setProgress(0);
      const msg = data.failedReason || 'Job failed';
      setError(msg);
      toast.error(msg);
    }, []),

    onEnrichmentComplete: useCallback(() => {}, []),
  });

  // Keep ref in sync so callbacks always have the latest unsubscribe function
  unsubscribeFromJobRef.current = unsubscribeFromJob;

  // ── Flash analysis ─────────────────────────────────────────────
  const [isQueueingAnalysis, setIsQueueingAnalysis] = useState(false);

  const handleRunFlashAnalysis = useCallback(async () => {
    if (!result?.buyers.length) return;
    const addresses = result.buyers.map((b) => b.walletAddress);
    setIsQueueingAnalysis(true);
    // Send in batches of 4 with a 1s gap to stay within the 5/min throttle
    const BATCH_SIZE = 4;
    try {
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const chunk = addresses.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map((walletAddress) =>
            fetcher('/analyses/wallets/dashboard-analysis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ walletAddress, analysisScope: 'flash', triggerSource: 'manual', queueWorkingAfter: false }),
            }),
          ),
        );
        if (i + BATCH_SIZE < addresses.length) {
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      }
      toast.success(`Queued flash analysis for ${addresses.length} wallets`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to queue flash analysis');
    } finally {
      setIsQueueingAnalysis(false);
    }
  }, [result]);

  const handleSearch = useCallback(async () => {
    if (!canSubmit || !startTs || !endTs) return;

    setIsLoading(true);
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      const data = await fetcher('/sig-buyers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint,
          startTime: startTs,
          endTime: endTs,
          minSolSpent: parseFloat(minSolSpent) || 0.5,
        }),
      }) as { jobId: string };

      jobIdRef.current = data.jobId;
      subscribeToJob(data.jobId);
    } catch (err: any) {
      const msg = err?.message || 'Failed to queue significant buyers job';
      setError(msg);
      toast.error(msg);
      setIsLoading(false);
    }
  }, [canSubmit, startTs, endTs, mint, minSolSpent, subscribeToJob]);

  const handleCopyAll = useCallback(() => {
    if (!result?.buyers.length) return;
    const text = result.buyers.map((b) => b.walletAddress).join('\n');
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${result.buyers.length} addresses`);
  }, [result]);

  // Fill now shortcut — fills current UTC time
  const handleFillNow = useCallback(() => {
    const nowTs = Math.floor(Date.now() / 1000);
    setStartDateStr(unixToUtcDateStr(nowTs));
    setStartTimeStr(unixToUtcTimeStr(nowTs));
  }, []);

  if (!isAuthorized) return null;

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-6 pb-3 shrink-0">
          <PageTitle
            title="Significant Buyers"
            icon={Users}
            subtitle="Find wallets that bought a token during a time window, ranked by SOL spent"
          />
        </div>

        <div className="flex flex-1 overflow-hidden gap-4 px-6 pb-6">
          {/* ── Left: Form ── */}
          <Card className="w-[320px] shrink-0 flex flex-col">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Search Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-4 pb-4 pt-0">
              {/* Mint */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Token Mint</Label>
                <Input
                  placeholder="Paste token mint address..."
                  value={mint}
                  onChange={(e) => setMint(e.target.value)}
                  className={cn(
                    'h-8 text-xs font-mono',
                    mintTouched && !mintValid && 'border-destructive focus-visible:ring-destructive'
                  )}
                />
                {mintTouched && !mintValid && (
                  <p className="text-[10px] text-destructive">Invalid Solana address</p>
                )}
              </div>

              {/* Start date/time */}
              <DateTimePicker
                label="Start Time (UTC)"
                dateStr={startDateStr}
                timeStr={startTimeStr}
                onDateChange={setStartDateStr}
                onTimeChange={setStartTimeStr}
              />
              <button
                type="button"
                onClick={handleFillNow}
                className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors -mt-2 text-left"
              >
                Use current time
              </button>

              {/* Duration */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Duration (minutes)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    className="h-8 text-xs w-20"
                  />
                  <div className="flex gap-1">
                    {[1, 5, 10, 30].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDurationMinutes(String(m))}
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                          durationMinutes === String(m)
                            ? 'border-primary text-primary bg-primary/10'
                            : 'border-border text-muted-foreground hover:border-foreground/40'
                        )}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
                {startTs && endTs && (
                  <p className="text-[10px] text-muted-foreground/60">
                    {new Date(startTs * 1000).toISOString().slice(11, 16)} → {new Date(endTs * 1000).toISOString().slice(11, 16)} UTC
                  </p>
                )}
              </div>

              {/* Min SOL */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Min SOL Spent</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={minSolSpent}
                    onChange={(e) => setMinSolSpent(e.target.value)}
                    className="h-8 text-xs w-20"
                  />
                  <div className="flex gap-1">
                    {['0.1', '0.5', '1', '5'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setMinSolSpent(v)}
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                          minSolSpent === v
                            ? 'border-primary text-primary bg-primary/10'
                            : 'border-border text-muted-foreground hover:border-foreground/40'
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Submit */}
              <Button
                onClick={handleSearch}
                disabled={!canSubmit}
                className="w-full mt-1"
                size="sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Searching...
                  </>
                ) : (
                  'Find Buyers'
                )}
              </Button>

              {isLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full -mt-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    const jobId = jobIdRef.current;
                    if (!jobId) return;
                    unsubscribeFromJobRef.current?.(jobId);
                    jobIdRef.current = null;
                    setIsLoading(false);
                    setProgress(0);
                    try {
                      await fetcher(`/jobs/${jobId}`, { method: 'DELETE' });
                    } catch {
                      // best-effort — UI is already reset
                    }
                    toast.info('Job cancelled');
                  }}
                >
                  Cancel
                </Button>
              )}

              {isLoading && (
                <div className="flex flex-col gap-1.5 -mt-1">
                  <div className={progress > 0 && progress < 90 ? 'animate-pulse' : ''}>
                    <Progress value={progress} className="h-1" />
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 text-center">
                    {progress === 0 ? 'Queued…' : progress < 90 ? 'Fetching transactions…' : 'Finalising…'} — may take a few minutes
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Right: Results ── */}
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Results
                  </CardTitle>
                  {result && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 tabular-nums">
                      {result.qualifyingWallets} wallets
                    </Badge>
                  )}
                </div>
                {result && result.buyers.length > 0 && (
                  <div className="flex items-center gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] gap-1 text-amber-400 hover:text-amber-300 hover:bg-amber-400/10"
                            onClick={handleRunFlashAnalysis}
                            disabled={isQueueingAnalysis}
                          >
                            {isQueueingAnalysis
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Zap className="h-3 w-3" />
                            }
                            Run Flash Analysis
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Queue a flash analysis for all {result.buyers.length} wallets</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={handleCopyAll}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy all addresses</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>

              {/* Stats bar */}
              {result && (
                <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                  <span>{result.totalTransactionsFetched.toLocaleString()} tx fetched</span>
                  <span>{result.totalWalletsFound.toLocaleString()} wallets found</span>
                  <span>{(result.durationMs / 1000).toFixed(1)}s</span>
                  <span className="ml-auto opacity-60">
                    {new Date(result.startTime * 1000).toISOString().slice(11, 16)} →{' '}
                    {new Date(result.endTime * 1000).toISOString().slice(11, 16)} UTC
                  </span>
                </div>
              )}
            </CardHeader>

            <CardContent className="flex-1 overflow-auto px-4 pb-4 pt-0">
              {/* Loading state */}
              {isLoading && (
                <div className="space-y-3 pt-2">
                  <div className={progress > 0 && progress < 90 ? 'animate-pulse' : ''}>
                    <Progress value={progress} className="h-1.5" />
                  </div>
                  <div className="space-y-2">
                    {[...Array(8)].map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded-md" />
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {!isLoading && error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 mt-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              {/* Empty / no results */}
              {!isLoading && !error && result && result.buyers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="h-8 w-8 text-muted-foreground/20 mb-3" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">No wallets met the criteria</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Try lowering the min SOL threshold or widening the time window
                  </p>
                </div>
              )}

              {/* No search yet */}
              {!isLoading && !error && !result && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="h-8 w-8 text-muted-foreground/20 mb-3" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">Configure a search on the left</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    Enter a mint, pick a time window, and hit Find Buyers
                  </p>
                </div>
              )}

              {/* Column headers + rows — constrained to left ~60% to reserve space for future detail panel */}
              {!isLoading && result && result.buyers.length > 0 && (
                <div className="max-w-[560px]">
                  <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-0.5">
                    <span className="w-[48px] shrink-0">Time</span>
                    <span className="w-[220px] shrink-0">Wallet</span>
                    <span className="w-[80px] text-right shrink-0">Spent</span>
                    <span className="w-[72px] text-right shrink-0">Net PnL</span>
                    <span className="w-[28px] text-right shrink-0">Tx</span>
                  </div>
                  <div className="divide-y divide-border/20">
                    {[...result.buyers]
                      .sort((a, b) => new Date(a.firstTransactionAt).getTime() - new Date(b.firstTransactionAt).getTime())
                      .slice(0, 200)
                      .map((buyer, i) => (
                        <BuyerRow key={buyer.walletAddress} buyer={buyer} rank={i + 1} />
                      ))}
                  </div>
                  {result.buyers.length > 200 && (
                    <p className="text-[10px] text-muted-foreground/50 text-center py-3">
                      Showing first 200 of {result.buyers.length} — use Copy All to get the full list
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
