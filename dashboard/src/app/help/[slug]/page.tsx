import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, BookOpenText, CircleHelp, ExternalLink, LineChart, Sparkles } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { HelpChangelog } from "@/components/help/HelpChangelog";
import { HelpDocsSidebar } from "@/components/help/HelpDocsSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getAdjacentHelpDocs, getHelpDoc, helpDocs } from "@/lib/help-docs";

type HelpDocPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const sectionAnchors = [
  { id: "summary", label: "Summary" },
  { id: "workflow", label: "Workflow" },
  { id: "data", label: "Data inside" },
  { id: "expect", label: "What to expect" },
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
  const imagePath = getHelpImagePath(slug);

  return (
    <AppShell>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.06),transparent_22%)]">
        <div className="mx-auto grid max-w-[1760px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:px-8">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <HelpDocsSidebar currentSlug={slug} />

            <div className="hidden rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.72)] p-5 lg:block">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                On this page
              </p>
              <nav className="mt-4 space-y-1">
                {sectionAnchors.map((section) => (
                  <Link
                    key={section.id}
                    href={`#${section.id}`}
                    className="block rounded-xl px-3 py-2 text-sm text-foreground/78 transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    {section.label}
                  </Link>
                ))}
              </nav>
            </div>
          </aside>

          <div className="min-w-0 space-y-10">
            <header className="border-b border-border/60 pb-10">
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-6">
                  <Button variant="ghost" asChild className="w-fit rounded-full px-0 text-muted-foreground hover:text-foreground">
                    <Link href="/help">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to Help
                    </Link>
                  </Button>

                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                        <Icon className="h-5 w-5 text-sky-400" />
                      </div>
                      <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                        Feature Guide
                      </Badge>
                    </div>
                    <div className="space-y-3">
                      <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
                        {doc.title}
                      </h1>
                      <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
                        {doc.summary}
                      </p>
                    </div>
                  </div>

                  <div id="summary" className="space-y-8">
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-5">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Why this exists
                          </p>
                          <p className="mt-3 max-w-3xl text-lg leading-8 text-foreground">
                            {doc.value}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Best for
                          </p>
                          <ul className="mt-4 space-y-3">
                            {doc.bestFor.map((item) => (
                              <li key={item} className="flex gap-3 text-base leading-7 text-muted-foreground">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="space-y-5 rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.55)] p-6">
                        <div>
                          <p className="text-sm font-medium text-foreground">Open the feature</p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Use the guide for framing. Use the live page for actual analysis.
                          </p>
                        </div>
                        <Button asChild className="w-full rounded-full">
                          <Link href={getFeatureRoute(slug)}>Open {doc.title}</Link>
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-[32px] border border-border/60 bg-[linear-gradient(140deg,rgba(10,24,48,0.92),rgba(5,11,24,0.98))] p-6">
                      <div>
                        <p className="text-sm font-medium text-foreground">Screenshot</p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Main product view for {doc.title}.
                        </p>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-[24px] border border-border/60">
                        <div className="bg-[linear-gradient(140deg,rgba(8,17,33,0.96),rgba(4,9,20,0.98))] p-4">
                          <Image
                            src={imagePath}
                            alt={`${doc.title} dashboard screenshot`}
                            width={1600}
                            height={1000}
                            className="h-auto w-full rounded-[18px] object-contain"
                            priority
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 xl:pt-16">
                  <div className="rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.55)] p-6">
                    <p className="text-sm font-medium text-foreground">Quick read</p>
                    <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                      <p>Read workflow first to understand how the page is supposed to be used.</p>
                      <p>Read what to expect and limits before you trust the output literally.</p>
                      <p>Use the FAQ for edge cases.</p>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.55)] p-6">
                    <p className="text-sm font-medium text-foreground">Read next</p>
                    <div className="mt-4 space-y-3">
                      {previous ? (
                        <Link
                          href={`/help/${previous.slug}`}
                          className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-foreground/85 transition-colors hover:bg-white/5"
                        >
                          <span>{previous.title}</span>
                          <ArrowLeft className="h-4 w-4" />
                        </Link>
                      ) : null}
                      {next ? (
                        <Link
                          href={`/help/${next.slug}`}
                          className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-foreground/85 transition-colors hover:bg-white/5"
                        >
                          <span>{next.title}</span>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_360px]">
              <article className="min-w-0 space-y-10">
                <DocSection
                  id="workflow"
                  title="Typical workflow"
                  icon={BookOpenText}
                  items={doc.workflow}
                  ordered
                />
                <DocSection
                  id="data"
                  title="What data is inside"
                  icon={LineChart}
                  items={doc.dataInside}
                />
                <DocSection
                  id="expect"
                  title="What to expect"
                  icon={Sparkles}
                  items={doc.expect}
                />
                <DocSection
                  id="limits"
                  title="Limits"
                  icon={CircleHelp}
                  items={doc.limits}
                />
              </article>

              <aside id="faq" className="space-y-5">
                <div className="rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.55)] p-6">
                  <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
                  <div className="mt-6 space-y-6">
                    {doc.faq.map((item) => (
                      <div key={item.question} className="space-y-2">
                        <h3 className="text-lg font-medium leading-7 text-foreground">
                          {item.question}
                        </h3>
                        <p className="text-base leading-7 text-muted-foreground">
                          {item.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.55)] p-6">
                  <p className="text-sm font-medium text-foreground">Need the live page?</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    These docs frame the feature. The actual interpretation still happens in the product itself.
                  </p>
                  <Link
                    href={getFeatureRoute(slug)}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sky-400 transition-colors hover:text-sky-300"
                  >
                    Open live page
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              </aside>
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
    <section id={id} className="scroll-mt-24 border-t border-border/60 pt-8">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-sky-400" />
        <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-6 space-y-5">
        {items.map((item, index) => (
          <div key={item} className="grid gap-3 md:grid-cols-[32px_minmax(0,1fr)] md:items-start">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 text-sm font-semibold text-foreground">
              {ordered ? index + 1 : <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
            </div>
            <p className="text-base leading-8 text-muted-foreground">
              {item}
            </p>
          </div>
        ))}
      </div>
    </section>
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

function getHelpImagePath(slug: string): string {
  switch (slug) {
    case "discovery":
      return "/help/discovery-overview.png";
    case "tracked-wallets":
      return "/help/tracked-wallets-overview.png";
    case "similarity-lab":
      return "/help/similarity-lab-overview.png";
    case "holder-profiles":
      return "/help/holder-profiles-overview.jpg";
    case "wallet-hunt":
      return "/help/wallet-hunt-overview.png";
    default:
      return "/help/discovery-overview.png";
  }
}
