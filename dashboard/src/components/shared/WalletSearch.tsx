'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Loader2, Search, DownloadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { fetcher } from '@/lib/fetcher';
import { useAuth } from '@/hooks/useAuth';
import { DashboardAnalysisResponse } from '@/types/api';
import { debounce } from 'lodash';

const DEBOUNCE_DELAY = 300;
const MIN_QUERY_LENGTH = 3;

interface WalletSearchResultItem {
  address: string;
}

export function WalletSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WalletSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (searchQuery.length < MIN_QUERY_LENGTH) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const responseData = await fetcher(`/wallets/search?query=${encodeURIComponent(searchQuery)}`) as { wallets: WalletSearchResultItem[] };
        if (responseData && Array.isArray(responseData.wallets)) {
          setSearchResults(responseData.wallets);
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_DELAY),
    []
  );

  useEffect(() => {
    debouncedSearch(query);
    return () => {
      debouncedSearch.cancel();
    };
  }, [query, debouncedSearch]);

  // Keyboard shortcut: Cmd+K or Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const isValidSolanaAddress = (address: string): boolean => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  };

  const handleSelectWallet = (walletAddress: string) => {
    setOpen(false);
    setQuery('');
    router.push(`/wallets/${walletAddress}`);
  };

  const handleTriggerAnalysis = async (walletAddress: string) => {
    setIsAnalyzing(true);
    try {
      const requestData = {
        walletAddress,
        forceRefresh: true,
        enrichMetadata: true,
      };

      const result: DashboardAnalysisResponse = await fetcher('/analyses/wallets/dashboard-analysis', {
        method: 'POST',
        body: JSON.stringify(requestData),
      });

      toast.success(`Analysis queued for ${walletAddress.substring(0, 6)}...`);

      // Navigate FIRST, then clean up modal state
      router.push(`/wallets/${walletAddress}?jobId=${result.jobId}`);

      // Small delay to ensure navigation starts before closing modal
      setTimeout(() => {
        setOpen(false);
        setQuery('');
        setIsAnalyzing(false);
      }, 100);
    } catch (err: any) {
      toast.error(`Analysis error: ${err.message || 'Failed to queue analysis'}`);
      setIsAnalyzing(false);
    }
  };

  const canTriggerAnalysis =
    query.trim() &&
    isValidSolanaAddress(query.trim()) &&
    !isSearching &&
    searchResults.length === 0;

  if (!isAuthenticated) {
    return null; // Don't show search if not authenticated
  }

  return (
    <>
      {/* Search trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="h-9 w-full px-3 py-2 text-sm text-muted-foreground bg-background border rounded-md hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2"
      >
        <Search className="h-4 w-4" />
        <span>Search wallets...</span>
        <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Command Dialog */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Type wallet address to search..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {isSearching ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : query.length < MIN_QUERY_LENGTH ? (
              <p className="text-sm text-muted-foreground">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
            ) : (
              <p className="text-sm text-muted-foreground">No wallets found.</p>
            )}
          </CommandEmpty>

          {searchResults.length > 0 && (
            <CommandGroup heading="Wallets">
              {searchResults.map((wallet) => (
                <CommandItem
                  key={wallet.address}
                  value={wallet.address}
                  onSelect={() => handleSelectWallet(wallet.address)}
                  className="cursor-pointer"
                >
                  <Search className="mr-2 h-4 w-4" />
                  <span className="font-mono text-xs">{wallet.address}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {canTriggerAnalysis && (
            <CommandGroup heading="Actions">
              <CommandItem
                value={`analyze-${query}`}
                onSelect={() => handleTriggerAnalysis(query.trim())}
                disabled={isAnalyzing}
                className="cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud className="mr-2 h-4 w-4" />
                    <span>Import & Analyze: {query.substring(0, 6)}...{query.substring(query.length - 4)}</span>
                  </>
                )}
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
