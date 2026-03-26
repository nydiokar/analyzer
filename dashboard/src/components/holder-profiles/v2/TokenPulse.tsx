import type { HolderProfilesResult } from '../types';
import { getSpeedPrimitive, getConsistencyPrimitive } from './utils/cognitive-primitives';
import { getMeanBehaviorSimilarity } from './utils/behavior-similarity';
import { TraderDistributionBar } from './TraderDistributionBar';
import { MinimalHoldersTable } from './MinimalHoldersTable';
import { getTokenOutcome as getTokenStats } from './utils/outcome-logic';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { WalletBaseballCard } from './WalletBaseballCard';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { SimilaritySidebar, type SimilarityGraphAnalysis, type SimilarityStatus } from './SimilaritySidebar';
import { CognitiveMetricCard } from './CognitiveMetricCard';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Props {
  result: HolderProfilesResult;
  similarityResult?: CombinedSimilarityResult | null;
  similarityStatus?: SimilarityStatus;
  isFinalAnalysis?: boolean;
  isSnapshot?: boolean;
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
  isSnapshot = false,
  notice = null,
  onRetrySimilarity,
}: Props) {
  const outcome = getTokenStats(result.profiles);
  const speed = getSpeedPrimitive(result.profiles);
  const consistency = getConsistencyPrimitive(result.profiles);
  const meanBehaviorSimilarity = getMeanBehaviorSimilarity(result.profiles);
  const qualityCount = result.profiles.filter((profile) => profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER').length;
  const totalHolders = result.metadata.totalHoldersRequested || result.profiles.length;
  const qualityValue = `${qualityCount}/${totalHolders || result.profiles.length}`;
  const similarityValue = meanBehaviorSimilarity === null ? '—' : `${Math.round(meanBehaviorSimilarity)}%`;
  const similarityCategory = meanBehaviorSimilarity === null
    ? 'Unknown'
    : meanBehaviorSimilarity >= 60
      ? 'Strong cluster'
      : meanBehaviorSimilarity >= 35
        ? 'Notable cluster'
        : meanBehaviorSimilarity >= 15
          ? 'Weak cluster'
          : 'Dispersed';
  const similarityDescription = 'Largest behavior cluster';
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
    <section className="relative space-y-4 max-w-7xl mx-auto">
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
      <div className="grid grid-cols-1 xl:grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-3 items-start">
        {result.tokenMint && (
          <div className="flex items-start">
            <TokenBadge
              mint={result.tokenMint}
              size="lg"
              metadata={isSnapshot && result.tokenSnapshot ? {
                name: result.tokenSnapshot.name ?? undefined,
                symbol: result.tokenSnapshot.symbol ?? undefined,
                marketCapUsd: result.tokenSnapshot.marketCapUsd ?? undefined,
                priceUsd: result.tokenSnapshot.priceUsd ?? undefined,
              } : undefined}
            />
          </div>
        )}
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
            label: 'Behavior Cluster',
            value: similarityValue,
            category: similarityCategory,
            description: similarityDescription,
            color: 'text-sky-500',
          }}
        />
        <CognitiveMetricCard
          primitive={{
            id: 'fresh',
            label: 'Fresh Supply',
            value: outcome.freshSupplyPercent != null ? `${Math.round(outcome.freshSupplyPercent)}%` : '—',
            category: outcome.freshSupplyPercent != null && outcome.freshSupplyPercent >= 15
              ? 'High'
              : outcome.freshSupplyPercent != null && outcome.freshSupplyPercent >= 5
                ? 'Moderate'
                : 'Low',
            description: 'Supply held by wallets with no exits yet',
            color: outcome.freshSupplyPercent != null && outcome.freshSupplyPercent >= 15
              ? 'text-amber-500'
              : outcome.freshSupplyPercent != null && outcome.freshSupplyPercent >= 5
                ? 'text-amber-400/80'
                : 'text-muted-foreground',
          }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1">
            <div className="w-full max-w-2xl">
              <TraderDistributionBar profiles={result.profiles} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-3">Supporting evidence</p>
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

      {selectedProfile && (
        <div
          className="absolute inset-0 z-10 bg-background/20 backdrop-blur-sm overflow-y-auto"
          onClick={() => setSelectedProfile(null)}
        >
          <div className="flex min-h-full items-start justify-center py-10 px-4">
            <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}
    </section>
  );
}
