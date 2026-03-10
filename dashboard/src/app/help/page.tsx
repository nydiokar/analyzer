import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { changelog } from "@/lib/changelog";
import {
  Compass,
  Crosshair,
  FlaskConical,
  HelpCircle,
  History,
  Lightbulb,
  MessageSquare,
  Route,
  Search,
  Send,
  ShieldQuestion,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type HelpSection = {
  id: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  whenToUse: string;
  dataInside: string[];
  howToUse: string[];
  expect: string[];
  limits: string[];
};

const sections: HelpSection[] = [
  {
    id: "discovery",
    title: "Discovery",
    icon: Compass,
    summary: "Find wallets that already stand out in the system by behavior, PnL, and activity.",
    whenToUse: "Use this when you want ideas, not when you already know the wallet.",
    dataInside: [
      "Cached analytics snapshots for wallets that already have PnL data.",
      "Behavior labels such as speed, flow, hold bias, and token breadth.",
      "Reason text that explains why a wallet was surfaced.",
    ],
    howToUse: [
      "Start with sort plus 1-2 filters, not all filters at once.",
      "Click speed and flow charts to narrow the list quickly.",
      "Open wallets that match the style you want to study or track.",
    ],
    expect: [
      "This is a curated list, not a full chain search.",
      "Results are snapshot-driven, so very recent activity can lag.",
      "Some wallets may show stale-data warnings if analysis is old.",
    ],
    limits: [
      "24 wallets per page in the UI.",
      "Server page size is capped at 40.",
      "API responses are cached for 120 seconds and the page also keeps a short local cache.",
    ],
  },
  {
    id: "tracked-wallets",
    title: "Tracked Wallets",
    icon: Wallet,
    summary: "Your saved wallet list for monitoring, organizing, and refreshing analysis.",
    whenToUse: "Use this when you already know which wallets matter and want them in one working set.",
    dataInside: [
      "Saved wallets, nicknames, collections, and lightweight HUD metrics.",
      "Portfolio totals such as total wallets, total PnL, and total SOL balance.",
      "Collection-level summaries for the wallets you grouped together.",
    ],
    howToUse: [
      "Add one wallet manually or import a list.",
      "Use collections to separate themes, cohorts, or experiments.",
      "Batch analyze selected wallets when you need a fresh pass.",
    ],
    expect: [
      "Adding a wallet automatically queues a flash analysis.",
      "Imported wallets are analyzed in waves, not all at once.",
      "Recently analyzed wallets can be skipped by refresh flows.",
    ],
    limits: [
      "Maximum 300 tracked wallets.",
      "Import supports up to 300 wallets per request.",
      "First 50 imported wallets get immediate flash analysis; the rest queue in background.",
      "Batch analyze is limited to 20 wallets per request.",
    ],
  },
  {
    id: "similarity-lab",
    title: "Similarity Lab",
    icon: FlaskConical,
    summary: "Compare wallets by overlap and capital allocation to find hidden clusters or copy-trading patterns.",
    whenToUse: "Use this when you have a wallet set and want to know which ones behave alike.",
    dataInside: [
      "Pairwise similarity scores and shared-token overlap.",
      "Wallet-level token balance context and aggregate metrics.",
      "Cluster and common-token views for the compared wallet set.",
    ],
    howToUse: [
      "Paste at least 2 wallets, or start from a token and pick holders.",
      "Run the job and wait for the async result.",
      "Use the strongest pairs and common tokens to decide what to track next.",
    ],
    expect: [
      "This is an async job, so larger sets take longer.",
      "Known system or non-trader wallets can reduce the value of the comparison.",
      "Token metadata and prices can load after the main similarity result.",
    ],
    limits: [
      "Minimum 2 wallets, maximum 30 wallets per run.",
      "Credit cost is dynamic: 10 if wallets are already synced, 20 if sync is needed.",
      "Heavy result payloads are job-backed rather than fully inline.",
    ],
  },
  {
    id: "holder-profiles",
    title: "Holder Profiles",
    icon: Users,
    summary: "Read top-holder behavior, conviction, and quality instead of looking at holder lists as raw addresses.",
    whenToUse: "Use this when you want to understand who holds a token, not just how many holders it has.",
    dataInside: [
      "Holder rank, supply share, hold-time metrics, behavior labels, and confidence.",
      "Current holdings context, PnL fields, SOL balance, and activity window when available.",
      "Known-wallet skips for burn, LP, or other non-trader addresses.",
    ],
    howToUse: [
      "Token mode: paste a mint and choose Top 10, 25, or 50.",
      "Wallet mode: paste one or more wallet addresses to classify them directly.",
      "Read confidence and data-quality signals before over-trusting a profile.",
    ],
    expect: [
      "Token mode is async and can return partial progress while holders are being processed.",
      "The page can chain into similarity after holder profiles complete.",
      "Some holders are intentionally skipped because they are known non-trader wallets.",
    ],
    limits: [
      "Token mode supports topN from 1 to 50; the UI offers 10, 25, and 50.",
      "Token-mode analysis costs 20 credits.",
      "Wallet-mode analysis costs 5 credits per wallet job.",
    ],
  },
  {
    id: "wallet-hunt",
    title: "Wallet Hunt",
    icon: Crosshair,
    summary: "Find recurring wallets across multiple token launches by intersecting captured top-holder snapshots.",
    whenToUse: "Use this when you suspect the same wallets keep appearing around related launches.",
    dataInside: [
      "Saved hunts, token snapshots, and overlap candidates.",
      "Candidate confidence based on how many unique token snapshots a wallet appears in.",
      "Token-level appearance context so you can see where the overlap came from.",
    ],
    howToUse: [
      "Create a hunt, then capture holder snapshots for tokens you want to compare.",
      "Add at least 2 different token snapshots to get true overlap candidates.",
      "Track promising candidates directly into Tracked Wallets.",
    ],
    expect: [
      "With only one snapshot, candidates are just that token's holder list.",
      "Real overlap only appears after multiple snapshots.",
      "Inactive hunts warn first, then auto-delete later.",
    ],
    limits: [
      "Maximum 5 hunts per user.",
      "Maximum 10 snapshots per hunt.",
      "The same token/source pair cannot be added twice to one hunt.",
      "Inactive hunts warn after 14 days and auto-delete after 21 days.",
    ],
  },
];

const quickStarts = [
  "Want ideas? Start in Discovery.",
  "Already know the wallets? Save them in Tracked Wallets.",
  "Want to compare a cohort? Use Similarity Lab.",
  "Want to understand a token's holder base? Use Holder Profiles.",
  "Want recurring wallets across launches? Use Wallet Hunt.",
];

const expectations = [
  "Most heavy analysis flows are async jobs, not instant responses.",
  "Freshness matters. Some pages read cached analysis first, then refresh later.",
  "Known burn, LP, and other system wallets may be skipped on purpose.",
  "This dashboard is strongest on SPL token trading behavior, not full DeFi interpretation.",
];

export default function HelpPage() {
  return (
    <AppShell>
      <div className="container mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <div className="space-y-8">
          <header className="space-y-3">
            <div className="flex items-center gap-3">
              <HelpCircle className="h-8 w-8 text-blue-500" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Help & About
                </h1>
                <p className="text-base text-muted-foreground sm:text-lg">
                  Short docs for what each dashboard tool does, what data it shows, and what to expect.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <Button key={section.id} variant="outline" size="sm" asChild>
                  <Link href={`#${section.id}`}>{section.title}</Link>
                </Button>
              ))}
            </div>
          </header>

          <Card className="border-blue-500/30 bg-card/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Lightbulb className="h-5 w-5 text-yellow-400" />
                How To Read This Product
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
              {quickStarts.map((item) => (
                <div key={item} className="rounded-lg border bg-background/40 p-3">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <Card key={section.id} className="border-border/70">
                  <CardHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{section.title}</CardTitle>
                      </div>
                      <Badge variant="secondary">Guide</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{section.summary}</p>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`#${section.id}`}>Read</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.id} id={section.id} className="scroll-mt-24">
                <CardHeader className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-primary" />
                    <div>
                      <CardTitle className="text-2xl">{section.title}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{section.summary}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Best use:</span> {section.whenToUse}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2">
                  <InfoBlock title="What's Inside" icon={Search} items={section.dataInside} />
                  <InfoBlock title="How To Use It" icon={Route} items={section.howToUse} />
                  <InfoBlock title="What To Expect" icon={ShieldQuestion} items={section.expect} />
                  <InfoBlock title="Limits" icon={Wallet} items={section.limits} />
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ShieldQuestion className="h-5 w-5 text-blue-400" />
                Platform Expectations
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
              {expectations.map((item) => (
                <div key={item} className="rounded-lg border bg-background/40 p-3">
                  {item}
                </div>
              ))}
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
                If something is unclear or a page feels misleading, send the exact feature name and what you expected to happen.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-2 transition-all hover:border-blue-500 hover:bg-accent"
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
                  className="gap-2 transition-all hover:border-blue-500 hover:bg-accent"
                  asChild
                >
                  <Link
                    href="https://x.com/Sova_intel"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
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
              <button className="mx-auto flex items-center gap-2 transition-colors hover:text-foreground">
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
                <div className="grid max-h-[400px] gap-3 overflow-y-auto pr-2">
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
                      <div className="whitespace-nowrap text-xs text-muted-foreground">{entry.date}</div>
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

function InfoBlock({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: LucideIcon;
  items: string[];
}) {
  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2 leading-relaxed">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
