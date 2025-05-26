"use client";

import React from 'react';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import TimeRangeSelector from '@/components/shared/TimeRangeSelector';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CopyIcon, WalletIcon } from 'lucide-react'
import { useToast } from "@/hooks/use-toast"

// Import the new tab component
import BehavioralPatternsTab from '@/components/dashboard/BehavioralPatternsTab';
import TokenPerformanceTab from '@/components/dashboard/TokenPerformanceTab';
import AccountStatsPnlTab from '@/components/dashboard/AccountStatsPnlTab';
import { ThemeToggleButton } from "@/components/theme-toggle-button";

interface WalletProfileLayoutProps {
  children: React.ReactNode;
  walletAddress: string;
}

const truncateWalletAddress = (address: string, startChars = 6, endChars = 4): string => {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
};

export default function WalletProfileLayout({
  children,
  walletAddress,
}: WalletProfileLayoutProps) {
  const { toast } = useToast();

  const copyToClipboard = () => {
    navigator.clipboard.writeText(walletAddress)
      .then(() => {
        toast({
          title: "Copied!",
          description: "Wallet address copied to clipboard.",
          duration: 2000,
        });
      })
      .catch(err => {
        toast({
          title: "Failed to copy",
          description: "Could not copy address to clipboard.",
          variant: "destructive",
          duration: 2000,
        });
        console.error('Failed to copy: ', err);
      });
  };

  return (
    <Tabs defaultValue="overview" className="flex flex-col w-full h-full bg-muted/40">
      <header className="sticky top-0 z-30 bg-background border-b shadow-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-2 py-3 px-1">
          <div className='flex-shrink-0 min-w-0 flex items-center gap-2'> 
            {walletAddress && (
              <>
                <WalletIcon className="h-6 w-6 text-muted-foreground flex-shrink-0" />
                <Badge variant="outline" className="px-2 py-1 text-sm font-mono">
                  {truncateWalletAddress(walletAddress, 8, 6)} 
                </Badge>
                <Button variant="ghost" size="icon" onClick={copyToClipboard} className="h-8 w-8 flex-shrink-0">
                  <CopyIcon className="h-4 w-4" />
                  <span className="sr-only">Copy wallet address</span>
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <AccountSummaryCard walletAddress={walletAddress || ""} />
            <TimeRangeSelector />
            <ThemeToggleButton />
          </div>
        </div>
        <TabsList className="flex items-center justify-start gap-1 p-1 px-1 border-t w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="token-performance">Token Performance</TabsTrigger>
          <TabsTrigger value="account-stats">Account Stats & PNL</TabsTrigger>
          <TabsTrigger value="behavioral-patterns">Behavioral Patterns</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
      </header>

      <main className="flex-1 overflow-y-auto p-0">
        <div className="w-full h-full">
          <TabsContent value="overview">
            {children}
            <div className="p-2 bg-card border rounded-lg shadow-sm mt-2">
              <h3 className="text-lg font-semibold mb-2">Overview Section Placeholder</h3>
              <p className="text-sm text-muted-foreground">This is where the main page content (passed as children) is displayed.</p>
              <div className="h-64 bg-muted rounded-md mt-4 flex items-center justify-center"> (Overview Content Area) </div>
            </div>
          </TabsContent>

          <TabsContent value="token-performance">
            <TokenPerformanceTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="account-stats">
            <AccountStatsPnlTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="behavioral-patterns">
            <BehavioralPatternsTab walletAddress={walletAddress} />
          </TabsContent>

          <TabsContent value="notes">
            <div className="p-2 bg-card border rounded-lg shadow-sm mt-2">
              <h3 className="text-lg font-semibold mb-2">Reviewer Log / Notes</h3>
              <p className="text-sm text-muted-foreground">Placeholder for an editable area...</p>
              <div className="h-64 bg-muted rounded-md mt-4 flex items-center justify-center"> (Scrollable Content Area for Notes) </div>
            </div>
          </TabsContent>
        </div>
      </main>
    </Tabs>
  );
} 