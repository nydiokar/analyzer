'use client';

import { useState, Fragment } from 'react';
import { WalletHudOverlay } from '@/components/shared/WalletHudOverlay';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
    address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm',
    description: 'Test wallet with complete data',
  },
  {
    label: 'Sample Wallet 2',
    address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm',
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
  const [showTableHud, setShowTableHud] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="inline">Inline</TabsTrigger>
              <TabsTrigger value="table">Table Rows</TabsTrigger>
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

            {/* Table Expandable Rows Tab */}
            <TabsContent value="table" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Table Expandable Rows (Layer Overlay Pattern)</CardTitle>
                  <CardDescription>
                    HUD appears as expandable sub-rows below wallet rows.
                    Table-level toggle controls visibility. Individual expand/collapse per row.
                    This demonstrates the &quot;layer overlay&quot; pattern - HUD completes the badge on-demand.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Example 1: Table with toggle */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-sm font-medium">Holder Profiles Table (Simulated)</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowTableHud(!showTableHud);
                          if (!showTableHud) {
                            // Expand all rows when enabling
                            setExpandedRows(new Set(SAMPLE_WALLETS.map(w => w.address).filter(Boolean)));
                          } else {
                            // Collapse all when disabling
                            setExpandedRows(new Set());
                          }
                        }}
                      >
                        {showTableHud ? (
                          <>
                            <ChevronUp className="h-4 w-4 mr-1" />
                            Hide HUD
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-1" />
                            Show HUD
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left p-3 text-sm font-medium">Address</th>
                            <th className="text-left p-3 text-sm font-medium">Holdings</th>
                            <th className="text-left p-3 text-sm font-medium">Win Rate</th>
                            {showTableHud && (
                              <th className="text-center p-3 text-sm font-medium w-12"></th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {SAMPLE_WALLETS.filter(w => w.address).map((wallet) => {
                            const isExpanded = expandedRows.has(wallet.address);
                            return (
                              <Fragment key={wallet.address}>
                                {/* Main Row */}
                                <tr className="border-t hover:bg-muted/50">
                                  <td className="p-3 text-sm font-mono">
                                    {wallet.address.slice(0, 8)}...{wallet.address.slice(-4)}
                                  </td>
                                  <td className="p-3 text-sm">1.2M BONK</td>
                                  <td className="p-3 text-sm">68%</td>
                                  {showTableHud && (
                                    <td className="p-3 text-center">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          const next = new Set(expandedRows);
                                          if (next.has(wallet.address)) {
                                            next.delete(wallet.address);
                                          } else {
                                            next.add(wallet.address);
                                          }
                                          setExpandedRows(next);
                                        }}
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="h-4 w-4" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </td>
                                  )}
                                </tr>

                                {/* HUD Row (expandable) */}
                                {showTableHud && isExpanded && (
                                  <tr className="border-t bg-muted/30">
                                    <td colSpan={4} className="py-3 px-4">
                                      <div className="pl-2 border-l-2 border-primary/30">
                                        <WalletHudOverlay
                                          walletAddress={wallet.address}
                                          display="inline"
                                        />
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground space-y-1">
                      <p>• <strong>Layer Overlay:</strong> Badge remains unchanged, HUD appears as sub-row when expanded</p>
                      <p>• <strong>Table Toggle:</strong> Enable/disable HUD section for entire table</p>
                      <p>• <strong>Per-Row Control:</strong> Individual expand/collapse icons (▼/▲)</p>
                      <p>• <strong>Auto-expand:</strong> All rows expand when toggle enabled</p>
                      <p>• <strong>Batch Fetch:</strong> In production, single API call fetches HUD for all rows</p>
                    </div>
                  </div>

                  {/* Example 2: Comparison - Before/After Toggle */}
                  <div>
                    <h3 className="text-sm font-medium mb-3">Before/After Comparison</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Before: Clean table */}
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Default State (HUD Hidden)
                        </div>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted">
                              <tr>
                                <th className="text-left p-2 text-xs">Address</th>
                                <th className="text-left p-2 text-xs">Holdings</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-t">
                                <td className="p-2 font-mono">DNfu...BHm</td>
                                <td className="p-2">1.2M</td>
                              </tr>
                              <tr className="border-t">
                                <td className="p-2 font-mono">8xQe...VFin</td>
                                <td className="p-2">980K</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          ✅ Clean, scannable, no clutter
                        </p>
                      </div>

                      {/* After: HUD visible */}
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          With HUD Enabled (Expanded)
                        </div>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted">
                              <tr>
                                <th className="text-left p-2 text-xs">Address</th>
                                <th className="text-left p-2 text-xs">Holdings</th>
                                <th className="text-center p-2 text-xs w-8"></th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-t">
                                <td className="p-2 font-mono">DNfu...BHm</td>
                                <td className="p-2">1.2M</td>
                                <td className="p-2 text-center">▲</td>
                              </tr>
                              <tr className="border-t bg-muted/30">
                                <td colSpan={3} className="p-2 text-xs">
                                  <span className="text-yellow-600">🥇</span>{' '}
                                  <span className="text-yellow-600">M</span>7.2h{' '}
                                  <span className="text-green-600">+2.1</span> / -0{' '}
                                  <span className="text-muted-foreground">33% WR</span>{' '}
                                  <span className="text-muted-foreground">40.1 T/D</span>{' '}
                                  🐋
                                </td>
                              </tr>
                              <tr className="border-t">
                                <td className="p-2 font-mono">8xQe...VFin</td>
                                <td className="p-2">980K</td>
                                <td className="p-2 text-center">▼</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          ✅ Rich metrics, user-controlled, scannable
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tooltip Display Tab */}
            <TabsContent value="tooltip" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Tooltip Display (Delayed Hover)</CardTitle>
                  <CardDescription>
                    Detailed multi-line format that appears after intentional hover (800ms delay).
                    Prevents &quot;tooltip spam&quot; from accidental mouse movement.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Example 1: Delayed hover tooltip */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Delayed Hover (800ms - Intentional Only)</h3>
                    <div className="p-4 border rounded-lg bg-card">
                      <Tooltip delayDuration={800}>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-help hover:bg-muted/50 transition-colors">
                            <span className="text-sm font-medium">
                              {(customAddress || selectedWallet).slice(0, 8)}...
                            </span>
                            <span className="text-xs text-muted-foreground">
                              (hover 800ms)
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
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>• <strong>Intentional hover detection:</strong> Tooltip only shows after 800ms</p>
                      <p>• <strong>Prevents spam:</strong> Mouse passing through (&lt;800ms) = no tooltip</p>
                      <p>• <strong>Immediate dismiss:</strong> Mouse leave = instant hide (no delay)</p>
                      <p>• <strong>Mobile:</strong> Tap to show (no delay on touch devices)</p>
                    </div>
                  </div>

                  {/* Example 2: Instant vs Delayed comparison */}
                  <div>
                    <h3 className="text-sm font-medium mb-3">Comparison: Instant vs Delayed</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Instant tooltip */}
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Instant Tooltip (0ms delay) ❌
                        </div>
                        <div className="p-4 border rounded-lg bg-card space-y-2">
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-help hover:bg-muted/50 transition-colors text-sm">
                                Wallet 1
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              <div className="p-2">Instant popup!</div>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-help hover:bg-muted/50 transition-colors text-sm">
                                Wallet 2
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              <div className="p-2">Instant popup!</div>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-help hover:bg-muted/50 transition-colors text-sm">
                                Wallet 3
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              <div className="p-2">Instant popup!</div>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          ❌ Tooltip spam - popups appear as you move mouse
                        </p>
                      </div>

                      {/* Delayed tooltip */}
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Delayed Tooltip (800ms) ✅
                        </div>
                        <div className="p-4 border rounded-lg bg-card space-y-2">
                          <Tooltip delayDuration={800}>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-help hover:bg-muted/50 transition-colors text-sm">
                                Wallet 1
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              <div className="p-2">Intentional hover!</div>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip delayDuration={800}>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-help hover:bg-muted/50 transition-colors text-sm">
                                Wallet 2
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              <div className="p-2">Intentional hover!</div>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip delayDuration={800}>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-help hover:bg-muted/50 transition-colors text-sm">
                                Wallet 3
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              <div className="p-2">Intentional hover!</div>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          ✅ No spam - only shows when hovering intentionally
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Example 3: Hover for Details (original) */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Full HUD Tooltip (Detailed)</h3>
                    <div className="p-4 border rounded-lg bg-card">
                      <Tooltip delayDuration={800}>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-help hover:bg-muted/50 transition-colors">
                            <span className="text-sm font-medium">
                              {(customAddress || selectedWallet).slice(0, 8)}...
                            </span>
                            <span className="text-xs text-muted-foreground">
                              (hover 800ms for full HUD)
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
            <CardTitle>Design Philosophy & Patterns</CardTitle>
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
                <li>Behavior Code (M/F/H/D/I/S/?)</li>
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

            <div className="pt-2 border-t">
              <h4 className="font-medium mb-1">🎯 Layer Overlay Pattern (Core Principle)</h4>
              <p className="text-muted-foreground mb-2">
                HUD is a <strong>layer overlay</strong> on WalletBadge, not a replacement.
                When activated/hovered, it &quot;completes&quot; the badge with additional data.
              </p>
              <div className="pl-4 space-y-1 text-muted-foreground">
                <p>• <strong>Badge UI remains unchanged</strong> when HUD is disabled</p>
                <p>• <strong>HUD is additive only</strong> - wraps or extends badge, never modifies it</p>
                <p>• <strong>Zero clutter by default</strong> - information appears on-demand</p>
                <p>• <strong>Backward compatible</strong> - all existing usages continue to work</p>
              </div>
            </div>

            <div className="pt-2 border-t">
              <h4 className="font-medium mb-1">🎨 Four Display Modes</h4>
              <div className="space-y-2">
                <div>
                  <strong className="text-foreground">1. Inline Compact</strong>
                  <p className="text-muted-foreground">Single-line format for quick scanning (basic metric display)</p>
                </div>
                <div>
                  <strong className="text-foreground">2. Table Expandable Rows</strong>
                  <p className="text-muted-foreground">Sub-rows below wallet rows with table-level toggle + per-row expand/collapse</p>
                </div>
                <div>
                  <strong className="text-foreground">3. Delayed Hover Tooltip</strong>
                  <p className="text-muted-foreground">800ms delay prevents &quot;tooltip spam&quot; - only intentional hovers trigger display</p>
                </div>
                <div>
                  <strong className="text-foreground">4. Expanded Grid</strong>
                  <p className="text-muted-foreground">Full 2-3 column grid for wallet profile pages (always visible)</p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t">
              <h4 className="font-medium mb-1">⚡ Performance Strategy</h4>
              <div className="pl-4 space-y-1 text-muted-foreground">
                <p>• <strong>Batch fetching:</strong> Single API call for 50+ wallets (not per-wallet)</p>
                <p>• <strong>Conditional loading:</strong> HUD data only fetched when HUD enabled</p>
                <p>• <strong>SWR caching:</strong> 60s deduplication, no auto-refresh</p>
                <p>• <strong>Smart positioning:</strong> Tooltips adapt to viewport boundaries</p>
              </div>
            </div>

            <div className="pt-2 border-t">
              <h4 className="font-medium mb-1">📱 Mobile/Touch Behavior</h4>
              <div className="pl-4 space-y-1 text-muted-foreground">
                <p>• <strong>Desktop:</strong> 800ms hover delay (intentional hover detection)</p>
                <p>• <strong>Mobile:</strong> Tap to show (no delay on touch devices)</p>
                <p>• <strong>Keyboard:</strong> Esc key closes tooltips (accessibility)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
