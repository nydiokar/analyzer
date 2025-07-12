'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import debounce from 'lodash/debounce';

interface WalletInputFormProps {
  onWalletsChange: (wallets: string[]) => void;
  onAnalyze: () => void;
  isRunning: boolean;
  analysisMethod: 'quick' | 'advanced';
}

export function WalletInputForm({ onWalletsChange, onAnalyze, isRunning, analysisMethod }: WalletInputFormProps) {
  const [inputValue, setInputValue] = useState('');

  const walletList = useMemo(() => {
    return Array.from(new Set(
      inputValue.replace(/[,|\n\r]+/g, ' ').split(' ').map(w => w.trim()).filter(Boolean)
    ));
  }, [inputValue]);

  const debouncedOnWalletsChange = useCallback(
    debounce((list: string[]) => {
      onWalletsChange(list);
    }, 300),
    [onWalletsChange]
  );

  useEffect(() => {
    debouncedOnWalletsChange(walletList);
    return () => {
      debouncedOnWalletsChange.cancel();
    };
  }, [walletList, debouncedOnWalletsChange]);

  return (
    <div className="relative">
      <Textarea
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Enter wallet addresses, separated by commas, spaces, or new lines."
        className="min-h-[70px] font-mono pr-24"
      />
      <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center space-x-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex-grow">
                <Button
                  onClick={onAnalyze}
                  disabled={isRunning || walletList.length < 2}
                  className="w-full"
                >
                  {isRunning ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Analyzing...
                    </div>
                  ) : 'Analyze'}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {isRunning
                  ? "An analysis is already in progress."
                  : walletList.length < 2
                  ? "Enter at least two wallet addresses to begin."
                  : `Run a ${analysisMethod} analysis on the provided wallets.`}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
} 