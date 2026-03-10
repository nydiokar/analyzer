import Link from "next/link";
import { ArrowRight, ExternalLink, MessageSquare, Send } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { HelpChangelog } from "@/components/help/HelpChangelog";
import { HelpDocsSidebar } from "@/components/help/HelpDocsSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { helpDocs } from "@/lib/help-docs";

const principles = [
  "Start with the workflow the user is trying to run.",
  "Explain what the page returns before listing every feature.",
  "Call out limits, freshness, and queued behavior early.",
];

export default function HelpPage() {
  return (
    <AppShell>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.06),transparent_22%)]">
        <div className="mx-auto grid max-w-[1760px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:px-8">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <HelpDocsSidebar />
          </aside>

          <div className="min-w-0 space-y-10">
            <header className="border-b border-border/60 pb-10">
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-end">
                <div className="space-y-5">
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                    Dashboard Docs
                  </Badge>
                  <div className="space-y-4">
                    <h1 className="max-w-5xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
                      Clear product documentation for every workflow in the dashboard.
                    </h1>
                    <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
                      Use the overview to pick the right tool, then open a focused guide for workflow, data, limits, and the live page.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild size="lg" className="rounded-full">
                      <Link href="#guides">
                        Browse guides
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="outline" size="lg" asChild className="rounded-full">
                      <Link href="/help/discovery">Read first guide</Link>
                    </Button>
                  </div>
                </div>

                <div className="rounded-[32px] border border-border/60 bg-[linear-gradient(140deg,rgba(10,24,48,0.92),rgba(5,11,24,0.98))] p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Overview screenshot</p>
                      <p className="text-sm text-muted-foreground">Add one clean product image here.</p>
                    </div>
                    <Badge variant="secondary">Placeholder</Badge>
                  </div>
                  <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-sky-400/30 px-6 text-center text-sm leading-7 text-muted-foreground">
                    Use a single screenshot with 2-3 labels. This should orient the reader before they enter the guides.
                  </div>
                </div>
              </div>
            </header>

            <section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-5">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Design principles
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  {principles.map((item) => (
                    <div key={item} className="text-base leading-7 text-foreground">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.55)] p-6">
                <div>
                  <p className="text-sm font-medium text-foreground">How to use this section</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Start with the guide that matches the task. Then check the expectation and limits sections before you trust the output.
                  </p>
                </div>
                <Separator />
                <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>Use the overview to choose the right page.</p>
                  <p>Use the feature guide to understand the workflow.</p>
                  <p>Use the live product page for actual interpretation.</p>
                </div>
              </div>
            </section>

            <section id="guides" className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight">Guides</h2>
                <p className="text-base leading-7 text-muted-foreground">
                  Every guide answers the same core questions: what the tool is for, how it works, what data it shows, and what limits matter.
                </p>
              </div>

              <div className="overflow-hidden rounded-[32px] border border-border/60 bg-[rgba(3,9,20,0.55)]">
                {helpDocs.map((doc, index) => {
                  const Icon = doc.icon;

                  return (
                    <div key={doc.slug}>
                      <article className="grid gap-6 px-6 py-8 transition-colors hover:bg-white/[0.02] lg:grid-cols-[240px_minmax(0,1fr)_280px_190px] lg:items-start">
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                              <Icon className="h-5 w-5 text-sky-400" />
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                Guide
                              </p>
                              <h3 className="mt-1 text-2xl font-semibold tracking-tight">{doc.title}</h3>
                            </div>
                          </div>
                          <p className="text-base leading-7 text-muted-foreground">{doc.summary}</p>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                              Best for
                            </p>
                            <p className="mt-2 text-base leading-7 text-foreground">{doc.bestFor[0]}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                              Why it matters
                            </p>
                            <p className="mt-2 text-base leading-7 text-muted-foreground">{doc.value}</p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Typical workflow
                          </p>
                          <ol className="space-y-3">
                            {doc.workflow.slice(0, 2).map((item, workflowIndex) => (
                              <li key={item} className="flex gap-3 text-sm leading-7 text-muted-foreground">
                                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/60 text-[11px] font-semibold text-foreground">
                                  {workflowIndex + 1}
                                </span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ol>
                        </div>

                        <div className="flex flex-col gap-3 lg:items-end">
                          <Button asChild className="w-full rounded-full lg:w-[170px]">
                            <Link href={`/help/${doc.slug}`}>Read guide</Link>
                          </Button>
                          <Link
                            href={getFeatureRoute(doc.slug)}
                            className="inline-flex items-center gap-2 text-sm font-medium text-sky-400 transition-colors hover:text-sky-300"
                          >
                            Open live page
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </div>
                      </article>
                      {index < helpDocs.length - 1 ? <Separator /> : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-8 border-t border-border/60 pt-8 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight">Still confusing?</h2>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  Good documentation feedback is specific: which guide, which task, and which step or expectation was unclear.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 xl:justify-end">
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
            </section>

            <HelpChangelog />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function getFeatureRoute(slug: string): string {
  switch (slug) {
    case "discovery":
      return "/discover";
    case "tracked-wallets":
      return "/trackers";
    case "similarity-lab":
      return "/similarity-lab";
    case "holder-profiles":
      return "/tools/holder-profiles";
    case "wallet-hunt":
      return "/wallet-hunt";
    default:
      return "/help";
  }
}
