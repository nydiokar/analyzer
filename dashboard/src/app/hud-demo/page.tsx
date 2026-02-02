'use client';

import { useState } from 'react';
import { WalletHudOverlay } from '@/components/shared/WalletHudOverlay';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Experimental Wallet HUD Demo Page
 *
 * A sandbox environment for testing all HUD display variants
 * without affecting existing components.
 *
 * This page demonstrates:
 * - Inline display (compact single-line)
 * - Tooltip display (hover details)
 * - Expanded display (full grid layout)
 */

// Sample wallet addresses for testing
const SAMPLE_WALLETS = [
  {
    label: 'Sample Wallet 1',
    address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
    description: 'Test wallet with complete data',
  },
  {
    label: 'Sample Wallet 2',
    address: '8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
    description: 'Test wallet with partial data',
  },
  {
    label: 'Custom Wallet',
    address: '',
    description: 'Enter your own wallet address',
  },
];

export default function HudDemoPage() {
  const [customAddress, setCustomAddress] = useState('');
  const [selectedWallet, setSelectedWallet] = useState(SAMPLE_WALLETS[0].address);

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 space-y-8 max-w-6xl">
        {/* Page Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Wallet HUD Demo</h1>
          <p className="text-muted-foreground">
            Experimental sandbox for testing Wallet HUD (Heads-Up Display) variants.
            High-signal metrics for at-a-glance wallet evaluation.
          </p>
        </div>

        {/* Wallet Selector */}
        <Card>
          <CardHeader>
            <CardTitle>Select Wallet</CardTitle>
            <CardDescription>
              Choose a sample wallet or enter a custom address to test HUD display
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {SAMPLE_WALLETS.map((wallet) => (
                <div key={wallet.label} className="flex items-start gap-3">
                  <input
                    type="radio"
                    id={wallet.label}
                    name="wallet"
                    checked={selectedWallet === wallet.address || (wallet.address === '' && customAddress !== '')}
                    onChange={() => {
                      if (wallet.address === '') {
                        // Custom wallet option - do nothing, user will type
                      } else {
                        setSelectedWallet(wallet.address);
                        setCustomAddress('');
                      }
                    }}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <Label htmlFor={wallet.label} className="cursor-pointer">
                      <div className="font-medium">{wallet.label}</div>
                      <div className="text-sm text-muted-foreground">{wallet.description}</div>
                      {wallet.address && (
                        <div className="text-xs text-muted-foreground font-mono mt-1">
                          {wallet.address}
                        </div>
                      )}
                    </Label>
                    {wallet.address === '' && (
                      <Input
                        type="text"
                        placeholder="Enter Solana wallet address..."
                        value={customAddress}
                        onChange={(e) => {
                          setCustomAddress(e.target.value);
                          if (e.target.value) {
                            setSelectedWallet(e.target.value);
                          }
                        }}
                        className="mt-2"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* HUD Display Variants */}
        {(selectedWallet || customAddress) && (
          <Tabs defaultValue="inline" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="inline">Inline</TabsTrigger>
              <TabsTrigger value="tooltip">Tooltip</TabsTrigger>
              <TabsTrigger value="expanded">Expanded</TabsTrigger>
            </TabsList>

            {/* Inline Display Tab */}
            <TabsContent value="inline" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Inline Display</CardTitle>
                  <CardDescription>
                    Compact single-line format for tables, lists, and search results.
                    Scannable in under 1 second.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Example 1: Basic inline */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Basic Inline</h3>
                    <div className="p-4 border rounded-lg bg-card">
                      <WalletHudOverlay
                        walletAddress={customAddress || selectedWallet}
                        display="inline"
                      />
                    </div>
                  </div>

                  {/* Example 2: Inline in a list context */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">In List Context</h3>
                    <div className="space-y-2">
                      <div className="p-3 border rounded-lg bg-card flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 bg-muted rounded-full flex items-center justify-center text-xs">
                            👤
                          </div>
                          <div>
                            <div className="text-sm font-medium">
                              {customAddress || selectedWallet}
                            </div>
                            <WalletHudOverlay
                              walletAddress={customAddress || selectedWallet}
                              display="inline"
                              className="mt-1"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Example 3: Inline in table row */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">In Table Row</h3>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left p-3 text-sm font-medium">Wallet</th>
                            <th className="text-left p-3 text-sm font-medium">HUD Metrics</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t">
                            <td className="p-3 text-sm font-mono">
                              {(customAddress || selectedWallet).slice(0, 8)}...
                            </td>
                            <td className="p-3">
                              <WalletHudOverlay
                                walletAddress={customAddress || selectedWallet}
                                display="inline"
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tooltip Display Tab */}
            <TabsContent value="tooltip" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Tooltip Display</CardTitle>
                  <CardDescription>
                    Detailed multi-line format that appears on hover.
                    Perfect for showing more context without cluttering the UI.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Example 1: Basic tooltip */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Hover for Details</h3>
                    <div className="p-4 border rounded-lg bg-card">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-help hover:bg-muted/50 transition-colors">
                            <span className="text-sm font-medium">
                              {(customAddress || selectedWallet).slice(0, 8)}...
                            </span>
                            <span className="text-xs text-muted-foreground">
                              (hover me)
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-sm">
                          <WalletHudOverlay
                            walletAddress={customAddress || selectedWallet}
                            display="tooltip"
                          />
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Example 2: Tooltip in card */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">In Card Context</h3>
                    <div className="p-4 border rounded-lg bg-card">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-3 cursor-help">
                            <div className="h-10 w-10 bg-muted rounded-full flex items-center justify-center">
                              👤
                            </div>
                            <div>
                              <div className="text-sm font-medium">
                                Favorite Wallet
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                {(customAddress || selectedWallet).slice(0, 12)}...
                              </div>
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-sm">
                          <WalletHudOverlay
                            walletAddress={customAddress || selectedWallet}
                            display="tooltip"
                          />
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Expanded Display Tab */}
            <TabsContent value="expanded" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Expanded Display</CardTitle>
                  <CardDescription>
                    Full grid layout with large metrics. Ideal for wallet profile hero sections.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Example 1: Basic expanded */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Profile Hero Section</h3>
                    <WalletHudOverlay
                      walletAddress={customAddress || selectedWallet}
                      display="expanded"
                    />
                  </div>

                  {/* Example 2: Expanded with context */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">With Wallet Context</h3>
                    <div className="space-y-4">
                      {/* Wallet header */}
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 bg-muted rounded-full flex items-center justify-center text-lg">
                          👤
                        </div>
                        <div>
                          <div className="text-lg font-semibold">Wallet Profile</div>
                          <div className="text-sm text-muted-foreground font-mono">
                            {customAddress || selectedWallet}
                          </div>
                        </div>
                      </div>

                      {/* HUD metrics */}
                      <WalletHudOverlay
                        walletAddress={customAddress || selectedWallet}
                        display="expanded"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Design Notes */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Design Philosophy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-1">Like a Poker HUD</h4>
              <p className="text-muted-foreground">
                Show only the most critical signals that let you evaluate a wallet at a glance.
                No clutter, maximum signal density, instant comprehension.
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-1">6 Core Metrics</h4>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Trimmed Mean PNL (outliers removed)</li>
                <li>Median P/L per Token (true center)</li>
                <li>Behavior Code (M/F/H/A/I/S/?)</li>
                <li>Avg Trades/Day (activity intensity)</li>
                <li>Win Rate (success percentage)</li>
                <li>Data Quality Tier (🥇/🥈/🥉/❓)</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-1">2 Conditional Badges</h4>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>🤖 Bot (if &gt;60 unique tokens/day)</li>
                <li>🐋 Whale (if &gt;200 SOL or &gt;$20k)</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-1">Integration Pattern</h4>
              <p className="text-muted-foreground">
                HUD is a <strong>layer overlay</strong> on WalletBadge, not a replacement.
                When activated/hovered, it "completes" the badge with additional data.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
