import type { HolderProfilesResult } from '../types';
import { getSpeedPrimitive, getConsistencyPrimitive } from './utils/cognitive-primitives';
import { getMeanBehaviorSimilarity } from './utils/behavior-similarity';
import { TraderDistributionBar } from './TraderDistributionBar';
import { ApproachingHoldTimePanel } from './ApproachingHoldTimePanel';
import { MinimalHoldersTable } from './MinimalHoldersTable';
import { getTokenOutcome } from './utils/outcome-logic';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { WalletBaseballCard } from './WalletBaseballCard';
import { createPortal } from 'react-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { SimilaritySidebar, type SimilarityGraphAnalysis, type SimilarityStatus } from './SimilaritySidebar';
import { OutcomeStrip } from './OutcomeStrip';
import { CognitiveMetricCard } from './CognitiveMetricCard';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Props {
  result: HolderProfilesResult;
  similarityResult?: CombinedSimilarityResult | null;
  similarityStatus?: SimilarityStatus;
  isFinalAnalysis?: boolean;
  notice?: {
    title: string;
    description?: string;
    variant?: 'default' | 'destructive';
  } | null;
  onRetrySimilarity?: () => void;
}

export function TokenPulse({
  result,
  similarityResult = null,
  similarityStatus = 'idle',
  isFinalAnalysis = false,
  notice = null,
  onRetrySimilarity,
}: Props) {
  const outcome = getTokenOutcome(result.profiles);
  const speed = getSpeedPrimitive(result.profiles);
  const consistency = getConsistencyPrimitive(result.profiles);
  const meanBehaviorSimilarity = getMeanBehaviorSimilarity(result.profiles);
  const qualityCount = result.profiles.filter((profile) => profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER').length;
  const totalHolders = result.metadata.totalHoldersRequested || result.profiles.length;
  const qualityValue = `${qualityCount}/${totalHolders || result.profiles.length}`;
  const similarityValue = meanBehaviorSimilarity === null ? '—' : `${Math.round(meanBehaviorSimilarity)}%`;
  const [selectedProfile, setSelectedProfile] = useState<HolderProfilesResult['profiles'][number] | null>(null);

  // Track which wallets are highlighted from similarity pair or cluster selection
  const [selectedPair, setSelectedPair] = useState<[string, string] | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [clusterWallets, setClusterWallets] = useState<string[]>([]);
  const [graphAnalysis, setGraphAnalysis] = useState<SimilarityGraphAnalysis | null>(null);

  // Highlighted wallets - from pair selection OR cluster selection
  const highlightedWallets = useMemo(() => {
    if (clusterWallets.length > 0) return new Set(clusterWallets);
    if (selectedPair) return new Set(selectedPair);
    return new Set<string>();
  }, [selectedPair, clusterWallets]);

  // Build wallet address to rank map for the sidebar
  const walletRanks = useMemo(() => {
    const map = new Map<string, number>();
    result.profiles.forEach((profile, index) => {
      map.set(profile.walletAddress, index + 1);
    });
    return map;
  }, [result.profiles]);

  // Handle pair selection - persistently highlight wallets in table until clicked again
  const handlePairSelect = useCallback((wallets: [string, string] | null) => {
    setSelectedPair(wallets);
    // Clear cluster selection when selecting a pair
    if (wallets) {
      setSelectedClusterId(null);
      setClusterWallets([]);
    }
  }, []);

  // Handle cluster selection - highlight all wallets in the cluster
  const handleClusterSelect = useCallback((clusterId: number | null, wallets: string[]) => {
    setSelectedClusterId(clusterId);
    setClusterWallets(wallets);
    // Clear pair selection when selecting a cluster
    if (clusterId !== null) {
      setSelectedPair(null);
    }
  }, []);

  // Handle graph analysis updates from sidebar
  const handleGraphAnalysisChange = useCallback((analysis: SimilarityGraphAnalysis | null) => {
    setGraphAnalysis(analysis);
  }, []);

  // Track token mint to reset similarity when analyzing a new token
  const lastTokenMintRef = useRef<string | undefined>(result.tokenMint);

  // Reset similarity and selection when token changes
  useEffect(() => {
    if (result.tokenMint !== lastTokenMintRef.current) {
      lastTokenMintRef.current = result.tokenMint;
      setSelectedPair(null);
      setSelectedClusterId(null);
      setClusterWallets([]);
      setGraphAnalysis(null);
    }
  }, [result.tokenMint]);

  // Escape key handler for modal
  useEffect(() => {
    if (!selectedProfile) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProfile(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProfile]);

  if (!result?.profiles?.length) return null;

  return (
    <section className="space-y-4 max-w-7xl mx-auto">
      {notice && (
        <Alert
          variant={notice.variant}
          className={notice.variant === 'destructive' ? undefined : 'border-amber-400/40 bg-amber-50/20'}
        >
          <AlertTitle>{notice.title}</AlertTitle>
          {notice.description && (
            <AlertDescription>{notice.description}</AlertDescription>
          )}
        </Alert>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-[auto_2fr_repeat(3,minmax(0,1fr))] gap-3 items-start">
        {result.tokenMint && (
          <div className="flex items-start">
            <TokenBadge mint={result.tokenMint} size="lg" />
          </div>
        )}
        <OutcomeStrip {...outcome} holdersCount={result.metadata.totalHoldersAnalyzed} />
        <CognitiveMetricCard primitive={speed} />
        <CognitiveMetricCard
          primitive={{
            id: 'quality',
            label: 'Quality',
            value: qualityValue,
            category: consistency.category,
            description: consistency.description,
            color: consistency.color,
          }}
        />
        <CognitiveMetricCard
          primitive={{
            id: 'similarity',
            label: 'Mean Similarity',
            value: similarityValue,
            category: 'Behavior',
            description: 'Behavior similarity across holders',
            color: 'text-sky-500',
          }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
            <TraderDistributionBar profiles={result.profiles} />
            <ApproachingHoldTimePanel profiles={result.profiles} tokenMint={result.tokenMint} />
          </div>
          <div>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-sm font-medium mb-3 cursor-help w-fit">Supporting evidence</p>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm text-xs">
                  <p className="text-muted-foreground">
                    Individual holder profiles that make up this analysis. Click any row to see detailed trading patterns for that wallet.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <MinimalHoldersTable
              profiles={result.profiles}
              mode="token"
              tokenMint={result.tokenMint}
              onSelect={(profile) => setSelectedProfile(profile)}
              highlightedWallets={highlightedWallets}
              connectionCounts={graphAnalysis?.connectionCounts}
            />
          </div>
        </div>
        <SimilaritySidebar
          similarityResult={similarityResult}
          status={similarityStatus}
          profileCount={result.profiles.length}
          minProfilesForAnalysis={5}
          isFinalAnalysis={isFinalAnalysis}
          selectedPair={selectedPair}
          onPairSelect={handlePairSelect}
          selectedClusterId={selectedClusterId}
          onClusterSelect={handleClusterSelect}
          walletRanks={walletRanks}
          onGraphAnalysisChange={handleGraphAnalysisChange}
          onRetry={onRetrySimilarity}
        />
      </div>

      {selectedProfile && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 bg-background/20 backdrop-blur-sm overflow-y-auto">
          <div className="flex min-h-full items-start justify-center py-10 px-4">
            <div className="relative w-full max-w-4xl">
              <button
                className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-card border shadow hover:bg-muted transition-colors"
                onClick={() => setSelectedProfile(null)}
                aria-label="Close"
              >
                ×
              </button>
              <WalletBaseballCard
                profile={selectedProfile}
                walletAddress={selectedProfile.walletAddress}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
