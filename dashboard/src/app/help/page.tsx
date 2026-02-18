import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb, Rocket, Milestone, HelpCircle, ShieldQuestion, Construction, AlertOctagon, MessageSquare, History, Send } from "lucide-react";
import Link from "next/link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { changelog } from "@/lib/changelog";
import { AppShell } from "@/components/layout/AppShell";

export default function HelpPage() {
  return (
    <AppShell>
      <div className="container mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl flex items-center gap-3">
            <HelpCircle className="h-8 w-8 text-blue-500" />
            Help & About
          </h1>
          <p className="text-lg text-muted-foreground">
            Your guide to understanding our wallet analysis platform.
          </p>
        </header>

        <Card className="bg-card/50 border-blue-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Lightbulb className="h-5 w-5 text-yellow-400" />
              Welcome to the Public Beta
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-invert max-w-none text-muted-foreground">
            <p>
              Our mission is to demystify on-chain activity by providing powerful, institutional-grade wallet analysis. This platform is currently in a public beta. The core analysis engine is stable, but we are self-hosting on initial hardware, so performance for wallets with very extensive histories might be slow. We appreciate your patience as we build and scale.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Rocket className="h-5 w-5 text-green-500" />
              Quick Start
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-invert max-w-none text-muted-foreground">
            <ul>
              <li><strong>Explore Demo Wallets:</strong> Click any wallet in the &quot;Favorites&quot; list to see the full dashboard in action. No API key needed.</li>
              <li><strong>Analyze Any Wallet:</strong> Paste any Solana wallet address into the top search bar and click &quot;Analyze&quot;.</li>
              <li><strong>Understand the Metrics:</strong> For details on any specific metric, simply hover over its title in the dashboard to see a brief explanation.</li>
            </ul>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <AlertOctagon className="h-5 w-5 text-orange-400" />
              Troubleshooting
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-invert max-w-none text-muted-foreground space-y-2">
            <p><strong>Analysis seems slow or stuck:</strong> For wallets with thousands of transactions, the initial analysis can take several minutes due to our current beta hardware. Please be patient. If it fails, please try again later.</p>
            <p><strong>Key issues:</strong> If you&apos;ve stumbled on bug, please use the contact method below to report it.</p>
          </CardContent>
        </Card>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ShieldQuestion className="h-5 w-5 text-blue-400" />
                Privacy & Data
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none text-muted-foreground">
              <p>We take privacy seriously. All wallet analysis is performed on-demand. We temporarily cache analysis results and permanently store wallet history to speed up repeat lookups, but never sell or share the wallet addresses you analyze with any third party.</p>
              <p className="text-sm pt-2">
                For full details, see our{" "}
                <Link href="/terms" className="text-blue-400 hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Construction className="h-5 w-5 text-amber-400" />
                Known Limitations
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none text-muted-foreground">
               <ul>
                <li>Only SPL token transfers and swaps are analyzed.</li>
                <li>NFT mints, transfers, and sales are not yet supported.</li>
                <li>Complex DeFi interactions (e.g., lending, staking) are not interpreted.</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Milestone className="h-5 w-5 text-purple-400" />
              Our Focus
            </CardTitle>
          </CardHeader>
          <CardContent className="prose prose-invert max-w-none text-muted-foreground">
             <ul>
              <li><strong>Current Focus:</strong> Refining the dashboard experience and ensuring a stable deployment.</li>
              <li><strong>What&apos;s Next:</strong> Expanding our core analysis capabilities and integrating AI-driven insights to uncover deeper patterns.</li>
            </ul>
          </CardContent>
        </Card>
        
        <Card className="text-center">
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2 text-xl">
                <MessageSquare className="h-5 w-5 text-teal-400" />
                Contact & Support
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                For key requests, support, or to share your feedback, reach out to us:
              </p>
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2 hover:bg-accent hover:border-blue-500 transition-all"
                  asChild
                >
                  <Link
                    href="https://t.me/sovaintel"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Send className="h-5 w-5 text-blue-400" />
                    <span>Telegram</span>
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2 hover:bg-accent hover:border-blue-500 transition-all"
                  asChild
                >
                  <Link
                    href="https://x.com/Sova_intel"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    <span>X / Twitter</span>
                  </Link>
                </Button>
              </div>
            </CardContent>
        </Card>

      </div>

      <div className="mt-12 text-center text-sm text-muted-foreground">
        <Popover>
          <PopoverTrigger asChild>
             <button className="flex items-center gap-2 mx-auto hover:text-foreground transition-colors">
                <History className="h-4 w-4" />
                <span>Last updated: {changelog[0].date} (View Changelog)</span>
             </button>
          </PopoverTrigger>
          <PopoverContent className="w-[500px]" side="top" align="center">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Changelog</h4>
                <p className="text-sm text-muted-foreground">
                  Recent updates to the platform.
                </p>
              </div>
              <div className="grid gap-3 max-h-[400px] overflow-y-auto pr-2">
                {changelog.map((entry) => (
                  <div key={entry.version} className="grid grid-cols-[1fr_auto] items-start gap-4 rounded-md p-3 hover:bg-muted/50">
                    <div className="grid gap-2">
                      <p className="font-semibold text-sm">{entry.version}</p>
                      <ul className="list-none space-y-1 text-xs text-muted-foreground">
                        {entry.changes.map((change, index) => (
                          <li key={index} className="leading-relaxed">{change}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">{entry.date}</div>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      </div>
    </AppShell>
  );
} 
