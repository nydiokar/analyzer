import { useState, useCallback, useEffect } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Search, PlusCircle, Info, DownloadCloud } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from 'sonner';
import { debounce } from 'lodash';
import { fetcher } from '@/lib/fetcher'; // Use the global fetcher
import { useApiKeyStore } from '@/store/api-key-store'; // Import the key store

const API_BASE_URL = '/api/v1';
const DEBOUNCE_DELAY = 300;

// --- Types ---
interface WalletSearchResultItem {
  address: string;
  // name?: string; // Optional: if backend provides a name/alias
}

interface TriggerAnalysisResponse {
  message: string;
}

// --- API Fetcher ---
// const fetcher = async (url: string, apiKey?: string) => { ... };

// --- SWR Hooks ---
function useWalletSearch(query: string) {
  const { apiKey, isInitialized } = useApiKeyStore();
  const searchQuery = query.trim();
  const shouldFetch = isInitialized && apiKey && searchQuery;

  const swrKey = shouldFetch ? [`${API_BASE_URL}/wallets/search?query=${encodeURIComponent(searchQuery)}`, apiKey] : null;

  return useSWR<WalletSearchResultItem[]>(
    swrKey,
    async (key: string[] | string) => {
      const url = Array.isArray(key) ? key[0] : key;
      const responseData = await fetcher(url) as { wallets: WalletSearchResultItem[] };
      if (responseData && Array.isArray(responseData.wallets)) {
        return responseData.wallets;
      }
      return [];
    },
    { revalidateOnFocus: false, errorRetryCount: 2 }
  );
}

// --- Component ---
export function WalletSearch() {
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisTarget, setAnalysisTarget] = useState<string | null>(null);

  const { apiKey, isInitialized } = useApiKeyStore();

  const {
    data: searchResults,
    error: searchError,
    isLoading: isSearchLoading,
    mutate: mutateSearch
  } = useWalletSearch(query);

  const debouncedSetQuery = useCallback(debounce((newQuery: string) => {
    setQuery(newQuery);
  }, DEBOUNCE_DELAY), []);

  useEffect(() => {
    return () => {
      debouncedSetQuery.cancel();
    };
  }, [debouncedSetQuery]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = event.target.value;
    if (newQuery.trim() === '') {
      setQuery('');
      setShowResults(false);
    } else {
      debouncedSetQuery(newQuery);
      setShowResults(true);
    }
  };

  const handleTriggerAnalysis = async (walletAddress: string) => {
    setIsAnalyzing(true);
    setAnalysisTarget(walletAddress);
    try {
      const result = await fetcher(`${API_BASE_URL}/analyses/wallets/${walletAddress}/trigger-analysis`, {
        method: 'POST',
      });
      
      toast.success(result.message || `Analysis started for ${walletAddress.substring(0,6)}...`);
      
      globalMutate((key: any) => Array.isArray(key) && key[0].includes('/users/me/favorites'));
      mutateSearch();

    } catch (err: any) {
      toast.error(`Analysis error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
      setAnalysisTarget(null);
    }
  };

  const isValidSolanaAddress = (address: string): boolean => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  };

  const canTriggerAnalysisForQuery = 
    query.trim() && 
    isValidSolanaAddress(query.trim()) && 
    !isSearchLoading && 
    (!searchResults || searchResults.length === 0);

  if (!isInitialized || !apiKey) {
    return (
      <div className="p-2 text-xs text-muted-foreground text-center border rounded-md bg-muted/30">
         <Info size={14} className="inline mr-1" />
         {isInitialized ? 'Search requires an API key.' : <Loader2 size={14} className="inline animate-spin"/>}
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          type="search" 
          placeholder="Search or paste address..." 
          className="h-9 pl-8 w-full text-sm"
          value={query} // Controlled input directly without local temp state
          onChange={handleInputChange}
          onFocus={() => setShowResults(true)}
          // onBlur={() => setTimeout(() => setShowResults(false), 150)} // Delayed blur to allow click on results
        />
        {isSearchLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {showResults && query.trim() !== '' && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 shadow-lg text-popover-foreground max-h-60 overflow-y-auto">
          {searchError && (
            <div className="p-2 text-center text-xs text-red-500">
              <AlertTriangle className="h-4 w-4 inline mr-1" /> Error: {searchError.message}
            </div>
          )}
          {!searchError && !isSearchLoading && searchResults && searchResults.length === 0 && (
            <p className="p-2 text-center text-xs text-muted-foreground">
              No wallets found matching "{query.length > 15 ? query.substring(0,15)+"..." : query}".
            </p>
          )}
          {!searchError && !isSearchLoading && searchResults && searchResults.length > 0 && (
            <ul className="space-y-0.5">
              {searchResults.map((wallet) => (
                <li key={wallet.address}>
                  <Link 
                    href={`/wallets/${wallet.address}`} 
                    className="block px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors truncate"
                    onClick={() => { setQuery(''); setShowResults(false); }}
                    title={wallet.address}
                  >
                    {wallet.address}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          
          {/* Analysis Trigger Button */} 
          {canTriggerAnalysisForQuery && (
            <div className="p-1 mt-1 border-t">
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="w-full text-xs justify-start h-auto py-1.5 px-2"
                      onClick={() => handleTriggerAnalysis(query.trim())}
                      disabled={isAnalyzing && analysisTarget === query.trim()}
                    >
                      {isAnalyzing && analysisTarget === query.trim() ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Analyzing...</>
                      ) : (
                        <><DownloadCloud className="h-3.5 w-3.5 mr-1.5" /> Import & Analyze: {query.substring(0,6)}...{query.substring(query.length-4)}</>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-[250px] text-xs">
                    <p>This wallet isn't in our database. Click to fetch its transaction history, perform an initial analysis, and then view its details.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 