import Link from "next/link";
import { ArrowRight, HelpCircle, MessageSquare, Send, Sparkles } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { HelpChangelog } from "@/components/help/HelpChangelog";
import { HelpDocsSidebar } from "@/components/help/HelpDocsSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { helpDocs } from "@/lib/help-docs";

const comparisonRows = [
  {
    situation: "I need ideas",
    tool: "Discovery",
    slug: "discovery",
    why: "Starts from the system's best existing candidates.",
  },
  {
    situation: "I already know the wallets",
    tool: "Tracked Wallets",
    slug: "tracked-wallets",
    why: "Gives you an operating list with grouping and refresh flows.",
  },
  {
    situation: "I need overlap or clustering",
    tool: "Similarity Lab",
    slug: "similarity-lab",
    why: "Compares a wallet set instead of viewing each wallet alone.",
  },
  {
    situation: "I need to understand a token's holder base",
    tool: "Holder Profiles",
    slug: "holder-profiles",
    why: "Turns raw holders into behavior and quality signals.",
  },
  {
    situation: "I suspect recurring launch wallets",
    tool: "Wallet Hunt",
    slug: "wallet-hunt",
    why: "Finds addresses that keep appearing across token snapshots.",
  },
];

export default function HelpPage() {
  return (
    <AppShell>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_22%)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <HelpDocsSidebar />
          </aside>

          <div className="space-y-8">
            <section className="overflow-hidden rounded-3xl border border-border/70 bg-card/70 shadow-[0_20px_80px_rgba(0,0,0,0.22)] backdrop-blur">
              <div className="grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_280px] md:p-8">
                <div className="space-y-5">
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                    Public Help Center
                  </Badge>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <HelpCircle className="h-8 w-8 text-sky-400" />
                      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                        Short docs for the actual jobs users come here to do
                      </h1>
                    </div>
                    <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                      This section is built to answer three things quickly: what each tool is for, what data it shows, and what a user should expect before trusting the output.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild size="lg" className="rounded-full">
                      <Link href={`/help/${helpDocs[0].slug}`}>
                        Start with {helpDocs[0].title}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="lg" asChild className="rounded-full">
                      <Link href="#choose-a-tool">Choose the right tool</Link>
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-background/50 p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400" />
                    <p className="text-sm font-medium text-foreground">What these docs optimize for</p>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>Short enough to read inside the product.</p>
                    <p>Specific enough to set expectations before a user clicks.</p>
                    <p>Strict enough to reflect actual limits and job behavior from the repo.</p>
                  </div>
                </div>
              </div>
            </section>

            <section id="choose-a-tool" className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">Choose the right tool</h2>
                <p className="text-sm text-muted-foreground">
                  Most confusion comes from using the wrong tool for the job. Start here.
                </p>
              </div>

              <Card className="border-border/70 bg-card/70">
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Situation</th>
                        <th className="px-4 py-3 font-medium">Best Tool</th>
                        <th className="px-4 py-3 font-medium">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={row.situation} className="border-t border-border/60">
                          <td className="px-4 py-3 font-medium text-foreground">{row.situation}</td>
                          <td className="px-4 py-3">
                            <Link href={`/help/${row.slug}`} className="text-sky-400 hover:text-sky-300">
                              {row.tool}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{row.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              {helpDocs.map((doc) => {
                const Icon = doc.icon;
                return (
                  <Card key={doc.slug} className="group border-border/70 bg-card/70 transition-colors hover:border-sky-500/40">
                    <CardHeader className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-2xl border border-white/10 bg-background/60 p-2.5">
                            <Icon className="h-5 w-5 text-sky-400" />
                          </div>
                          <div>
                            <CardTitle className="text-xl">{doc.title}</CardTitle>
                            <p className="mt-1 text-sm text-muted-foreground">{doc.summary}</p>
                          </div>
                        </div>
                        <Badge variant="secondary">Guide</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm leading-6 text-muted-foreground">{doc.value}</p>
                      <div className="space-y-2">
                        {doc.bestFor.slice(0, 2).map((item) => (
                          <div key={item} className="rounded-xl border bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                            {item}
                          </div>
                        ))}
                      </div>
                      <Button variant="outline" asChild className="rounded-full">
                        <Link href={`/help/${doc.slug}`}>
                          Read {doc.shortTitle}
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Card className="border-border/70 bg-card/70">
                <CardHeader>
                  <CardTitle className="text-xl">Support</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    If a user gets confused, the useful bug report is not &quot;this is broken&quot;. It is the feature name, what they expected, and what the page actually showed.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" asChild className="rounded-full">
                      <Link href="https://t.me/sovaintel" target="_blank" rel="noopener noreferrer">
                        <Send className="mr-2 h-4 w-4 text-sky-400" />
                        Telegram
                      </Link>
                    </Button>
                    <Button variant="outline" asChild className="rounded-full">
                      <Link href="https://x.com/Sova_intel" target="_blank" rel="noopener noreferrer">
                        <MessageSquare className="mr-2 h-4 w-4 text-sky-400" />
                        X / Twitter
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent">
                <CardHeader>
                  <CardTitle className="text-xl">What comes next</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>Next pass: screenshots, contextual callouts, and eventual external API docs for `/intel` as a separate system.</p>
                  <p>These product docs stay focused on dashboard behavior and user expectations.</p>
                </CardContent>
              </Card>
            </section>

            <HelpChangelog />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
