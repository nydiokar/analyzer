'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface WalletSelectorProps {
  stagedWallets: string[];
  setStagedWallets: (wallets: string[]) => void;
}

export function WalletSelector({ stagedWallets, setStagedWallets }: WalletSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const { toast } = useToast();

  const handleAddWallet = () => {
    const trimmedValue = inputValue.trim();
    if (trimmedValue && !stagedWallets.includes(trimmedValue)) {
      // Basic address validation could be added here
      if (trimmedValue.length < 32 || trimmedValue.length > 44) {
          toast({
            variant: "destructive",
            title: "Invalid Address",
            description: "Please enter a valid Solana wallet address.",
          });
          return;
      }
      setStagedWallets([...stagedWallets, trimmedValue]);
      setInputValue('');
    } else if (stagedWallets.includes(trimmedValue)) {
         toast({
            variant: "default",
            title: "Duplicate Wallet",
            description: "This wallet is already in the list.",
          });
    }
  };

  const handleRemoveWallet = (walletToRemove: string) => {
    setStagedWallets(stagedWallets.filter(wallet => wallet !== walletToRemove));
  };
  
  const handlePaste = async () => {
    try {
        const text = await navigator.clipboard.readText();
        const addresses = text.split(/[\s,]+/).filter(Boolean); // Split by space or comma
        const newWallets = addresses.filter(addr => !stagedWallets.includes(addr.trim()) && addr.trim().length > 30);
        const uniqueNewWallets = [...new Set(newWallets)];
        
        if(uniqueNewWallets.length > 0) {
            setStagedWallets([...stagedWallets, ...uniqueNewWallets]);
            toast({
                title: "Wallets Pasted",
                description: `${uniqueNewWallets.length} new wallets added from clipboard.`,
            });
        } else {
             toast({
                title: "No new wallets",
                description: `Clipboard content did not contain any new valid wallets.`,
            });
        }
    } catch (err) {
        toast({
            variant: "destructive",
            title: "Paste Failed",
            description: "Could not read from clipboard. Please check browser permissions.",
        });
    }
  };


  return (
    <div className="space-y-4">
       <div className="flex space-x-2">
            <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Paste wallet address"
                onKeyDown={(e) => e.key === 'Enter' && handleAddWallet()}
            />
            <Button onClick={handleAddWallet} variant="secondary">Add</Button>
       </div>
        <Button onClick={handlePaste} variant="outline" size="sm" className="w-full">Paste from Clipboard</Button>

      {stagedWallets.length > 0 && (
        <ScrollArea className="h-48 w-full rounded-md border p-2">
          <div className="space-y-2">
            {stagedWallets.map(wallet => (
              <div key={wallet} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <p className="text-sm font-mono truncate" title={wallet}>{wallet}</p>
                <Button variant="ghost" size="icon" onClick={() => handleRemoveWallet(wallet)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
} 