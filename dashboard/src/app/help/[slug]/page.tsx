import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, BookOpenText, CheckCircle2, CircleHelp, LineChart, Sparkles } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { HelpChangelog } from "@/components/help/HelpChangelog";
import { HelpDocsSidebar } from "@/components/help/HelpDocsSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdjacentHelpDocs, getHelpDoc, helpDocs } from "@/lib/help-docs";

type HelpDocPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const sectionAnchors = [
  { id: "best-for", label: "Best For" },
  { id: "workflow", label: "Workflow" },
  { id: "data-inside", label: "Data Inside" },
  { id: "expect", label: "Expect" },
  { id: "limits", label: "Limits" },
  { id: "faq", label: "FAQ" },
];

export async function generateStaticParams() {
  return helpDocs.map((doc) => ({ slug: doc.slug }));
}

export default async function HelpDocPage({ params }: HelpDocPageProps) {
  const { slug } = await params;
  const doc = getHelpDoc(slug);

  if (!doc) {
    notFound();
  }

  const { previous, next } = getAdjacentHelpDocs(slug);
  const Icon = doc.icon;

  return (
    <AppShell>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_24%)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <HelpDocsSidebar currentSlug={slug} />

            <Card className="hidden border-border/70 bg-card/70 lg:block">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
                  On This Page
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {sectionAnchors.map((section) => (
                  <Link
                    key={section.id}
                    href={`#${section.id}`}
                    className="block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    {section.label}
                  </Link>
                ))}
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-6">
            <section className="overflow-hidden rounded-3xl border border-border/70 bg-card/70 shadow-[0_20px_80px_rgba(0,0,0,0.22)] backdrop-blur">
              <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_260px] md:p-8">
                <div className="space-y-5">
                  <Button variant="ghost" asChild className="w-fit rounded-full px-0 text-muted-foreground hover:text-foreground">
                    <Link href="/help">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to Help
                    </Link>
                  </Button>
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                      <Icon className="h-6 w-6 text-sky-400" />
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                          Feature Guide
                        </Badge>
                        <Badge variant="secondary">Dashboard</Badge>
                      </div>
                      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{doc.title}</h1>
                    </div>
                  </div>
                  <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                    {doc.summary}
                  </p>
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Why it exists:</span> {doc.value}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-background/45 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400" />
                    <p className="text-sm font-medium text-foreground">Fast read</p>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>Read Best For first to decide if you are on the right page.</p>
                    <p>Read Limits before relying on the workflow.</p>
                    <p>Use FAQ to answer edge-case questions without leaving the product.</p>
                  </div>
                </div>
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <DocSection
                  id="best-for"
                  title="Best For"
                  icon={CheckCircle2}
                  items={doc.bestFor}
                />
                <DocSection
                  id="workflow"
                  title="Typical Workflow"
                  icon={BookOpenText}
                  items={doc.workflow}
                  ordered
                />
                <DocSection
                  id="data-inside"
                  title="What Data Is Inside"
                  icon={LineChart}
                  items={doc.dataInside}
                />
                <DocSection
                  id="expect"
                  title="What To Expect"
                  icon={Sparkles}
                  items={doc.expect}
                />
                <DocSection
                  id="limits"
                  title="Limits"
                  icon={CircleHelp}
                  items={doc.limits}
                />

                <Card id="faq" className="scroll-mt-24 border-border/70 bg-card/70">
                  <CardHeader>
                    <CardTitle className="text-xl">FAQ</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {doc.faq.map((item) => (
                      <div key={item.question} className="rounded-2xl border bg-background/45 p-4">
                        <p className="font-medium text-foreground">{item.question}</p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.answer}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card className="border-border/70 bg-card/70">
                  <CardHeader>
                    <CardTitle className="text-xl">Read Next</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {previous ? (
                      <Button variant="outline" asChild className="w-full justify-between rounded-2xl">
                        <Link href={`/help/${previous.slug}`}>
                          <span>{previous.title}</span>
                          <ArrowLeft className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : null}
                    {next ? (
                      <Button variant="outline" asChild className="w-full justify-between rounded-2xl">
                        <Link href={`/help/${next.slug}`}>
                          <span>{next.title}</span>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent">
                  <CardHeader>
                    <CardTitle className="text-xl">Need the live page?</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>These docs explain the feature. The actual interpretation still happens best in the product itself.</p>
                    <Button variant="outline" asChild className="rounded-full">
                      <Link href={getFeatureRoute(slug)}>Open {doc.title}</Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            <HelpChangelog />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function DocSection({
  id,
  title,
  icon: Icon,
  items,
  ordered = false,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  items: string[];
  ordered?: boolean;
}) {
  return (
    <Card id={id} className="scroll-mt-24 border-border/70 bg-card/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Icon className="h-5 w-5 text-sky-400" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item, index) => (
          <div key={item} className="flex gap-3 rounded-2xl border bg-background/45 p-4">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-foreground">
              {ordered ? (index + 1) : (<span className="h-2 w-2 rounded-full bg-sky-400" />)}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{item}</p>
          </div>
        ))}
      </CardContent>
    </Card>
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

