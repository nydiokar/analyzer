'use client';

import { AuthModal } from '@/components/auth/AuthModal';
import { LandingShell } from '@/components/layout/LandingShell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { ArrowRight, ChevronRight, Code2, LineChart, LogIn, Menu, Send, ShieldCheck, Terminal, Wallet } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

const stats = [
  ['8', 'Speed categories', 'Sniper to Hodler'],
  ['5', 'Flow patterns', 'Buy-only to Sell-only'],
  ['6', 'API endpoints', 'Snapshots and async jobs'],
  ['$0.009', 'Lowest unit cost', 'At Pro volume'],
] as const;

const features = [
  ['Discover', 'Filter ranked wallets by behavior, PnL, win rate, and activity instead of reviewing addresses one by one.'],
  ['Similarity Lab', 'Run overlap and coordination analysis on wallet lists or token holder sets and inspect cluster-level behavior.'],
  ['Tracked Wallets', 'Save addresses into named collections, keep context, and batch-run the same research workflow repeatedly.'],
  ['Holder Profiles', 'Open a deep report with exit timing, behavior composition, similarity pairs, and a structured narrative.'],
  ['Wallet Hunt', 'Search for wallets matching explicit behavioral criteria before digging into individual cases.'],
] as const;

const endpoints = [
  ['Wallet HUD', 'GET', 'Speed, flow, win rate, PnL, whale and bot flags.'],
  ['Wallet Profile', 'GET', 'Full behavioral analysis for a single wallet.'],
  ['Wallet Tokens', 'GET', 'Per-token PnL breakdown by address.'],
  ['Batch HUD', 'GET', 'Behavior snapshots for multiple wallets in one request.'],
  ['Token Holder Profiles', 'GET', 'Behavioral profiles of top holders of a token.'],
  ['Wallet Similarity', 'GET', 'Run overlap and coordination analysis for wallet sets.'],
] as const;

const steps = [
  ['01', '2 min', 'Register', 'Create an account and open the dashboard or developer surface immediately.'],
  ['02', '5 min', 'Configure', 'Choose browser research or SDK-driven access and set your working path.'],
  ['03', 'Instant', 'Query', 'Pull wallet HUDs, inspect profiles, or start async jobs against holder sets.'],
  ['04', 'Continuous', 'Monitor', 'Reuse saved collections and polling flows for repeat analysis.'],
] as const;

const pricing = [
  ['Starter', '$15', '1,000 credits', '$0.015 / credit'],
  ['Builder', '$120', '10,000 credits', '$0.012 / credit'],
  ['Pro', '$900', '100,000 credits', '$0.009 / credit'],
] as const;

const editorLines = [
  { line: '1', parts: [{ text: 'import', className: 'text-sky-300' }, { text: ' { ', className: 'text-slate-300' }, { text: 'SovaClient', className: 'text-slate-100' }, { text: ' } ', className: 'text-slate-300' }, { text: 'from', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: "'@sova-intel/sdk'", className: 'text-emerald-300' }, { text: ';', className: 'text-slate-500' }] },
  { line: '2', parts: [] },
  { line: '3', parts: [{ text: 'const', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'client', className: 'text-slate-100' }, { text: ' = ', className: 'text-slate-500' }, { text: 'new', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'SovaClient', className: 'text-cyan-300' }, { text: '({', className: 'text-slate-500' }] },
  { line: '4', parts: [{ text: '    ', className: 'text-slate-300' }, { text: 'apiKey', className: 'text-slate-100' }, { text: ': ', className: 'text-slate-500' }, { text: 'process', className: 'text-orange-300' }, { text: '.', className: 'text-slate-500' }, { text: 'env', className: 'text-orange-300' }, { text: '.', className: 'text-slate-500' }, { text: 'SOVA_API_KEY', className: 'text-slate-100' }, { text: ',', className: 'text-slate-500' }] },
  { line: '5', parts: [{ text: '});', className: 'text-slate-500' }] },
  { line: '6', parts: [] },
  { line: '7', parts: [{ text: 'const', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'hud', className: 'text-slate-100' }, { text: ' = ', className: 'text-slate-500' }, { text: 'await', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'client', className: 'text-slate-100' }, { text: '.', className: 'text-slate-500' }, { text: 'walletHud', className: 'text-cyan-300' }, { text: '(', className: 'text-slate-500' }, { text: "'7xKX...mPqR'", className: 'text-emerald-300' }, { text: ');', className: 'text-slate-500' }] },
  { line: '8', parts: [{ text: 'const', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'profile', className: 'text-slate-100' }, { text: ' = ', className: 'text-slate-500' }, { text: 'await', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'client', className: 'text-slate-100' }, { text: '.', className: 'text-slate-500' }, { text: 'walletProfile', className: 'text-cyan-300' }, { text: '(', className: 'text-slate-500' }, { text: "'7xKX...mPqR'", className: 'text-emerald-300' }, { text: ');', className: 'text-slate-500' }] },
  { line: '9', parts: [{ text: 'const', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'job', className: 'text-slate-100' }, { text: ' = ', className: 'text-slate-500' }, { text: 'await', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'client', className: 'text-slate-100' }, { text: '.', className: 'text-slate-500' }, { text: 'walletSimilarity', className: 'text-cyan-300' }, { text: '([', className: 'text-slate-500' }, { text: "'addr1'", className: 'text-emerald-300' }, { text: ', ', className: 'text-slate-500' }, { text: "'addr2'", className: 'text-emerald-300' }, { text: ', ', className: 'text-slate-500' }, { text: "'addr3'", className: 'text-emerald-300' }, { text: ']);', className: 'text-slate-500' }] },
  { line: '10', parts: [{ text: 'const', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'result', className: 'text-slate-100' }, { text: ' = ', className: 'text-slate-500' }, { text: 'await', className: 'text-sky-300' }, { text: ' ', className: 'text-slate-300' }, { text: 'job', className: 'text-slate-100' }, { text: '.', className: 'text-slate-500' }, { text: 'poll', className: 'text-cyan-300' }, { text: '();', className: 'text-slate-500' }] },
] as const;

function SearchParamsHandler({
  showAuthModal,
  setShowAuthModal,
}: {
  showAuthModal: boolean;
  setShowAuthModal: (show: boolean) => void;
}) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const redirectPath = searchParams.get('redirect');
    if (redirectPath && !isAuthenticated) {
      setShowAuthModal(true);
    }
  }, [searchParams, isAuthenticated, setShowAuthModal]);

  useEffect(() => {
    if (isAuthenticated) {
      const redirectPath = searchParams.get('redirect');
      router.push(redirectPath || '/discover');
    }
  }, [isAuthenticated, router, searchParams]);

  if (isAuthenticated) {
    return null;
  }

  return (
    <AuthModal
      open={showAuthModal}
      onOpenChange={setShowAuthModal}
      onSuccess={() => {
        setShowAuthModal(false);
        router.push('/discover');
      }}
    />
  );
}

export default function LandingPage() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <LandingShell>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="pointer-events-none fixed inset-0 opacity-30">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.22),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(124,58,237,0.18),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.02),_transparent_35%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:96px_96px] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.65),transparent)]" />
        </div>

        <header className="sticky top-0 z-50 border-b border-slate-800/70 bg-slate-950/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
            <Link href="/" className="flex items-center gap-3">
              <Image src="/sova_badge_primary.svg" alt="Sova Intel" width={34} height={34} className="rounded-md ring-1 ring-white/10" />
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Sova Intel</div>
                <div className="text-sm font-semibold text-slate-100">Behavioral Solana research</div>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
              <a href="#features" className="transition-colors hover:text-slate-100">Features</a>
              <a href="#access" className="transition-colors hover:text-slate-100">Access</a>
              <a href="#pricing" className="transition-colors hover:text-slate-100">Pricing</a>
              <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-slate-100">
                Docs
              </Link>
            </nav>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAuthModal(true)}
                className="hidden border-white/70 bg-white text-slate-950 hover:bg-slate-100 md:inline-flex"
              >
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
              </Button>
              <Button variant="ghost" size="icon" className="border border-slate-800 text-slate-300 hover:bg-slate-900 md:hidden" aria-label="Open navigation">
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="relative">
          <section className="border-b border-slate-800/70">
            <div className="mx-auto grid max-w-7xl gap-14 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-blue-300">
                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                  Solana wallet intelligence
                </div>

                <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.04em] text-slate-50 md:text-7xl">
                  Stop reading wallets one transfer at a time.
                </h1>

                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 md:text-xl">
                  Sova Intel turns Solana wallet activity into behavior labels, profile reports, similarity graphs,
                  and programmatic research primitives for teams that need faster judgment.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  {['Speed taxonomy', 'Similarity analysis', 'Tracked collections', 'SDK + X402'].map((item, index) => (
                    <div
                      key={item}
                      className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                        index === 3
                          ? 'border-purple-500/20 bg-purple-500/10 text-purple-200'
                          : 'border-blue-500/20 bg-blue-500/10 text-blue-200'
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button onClick={() => setShowAuthModal(true)} size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 px-7 text-white hover:from-blue-700 hover:to-purple-700">
                    Open Dashboard
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="lg" className="w-full border-slate-700 bg-slate-900/40 px-7 text-slate-200 hover:bg-slate-800 hover:text-white sm:w-auto">
                      Read API Docs
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>

                <div className="mt-10 grid gap-4 sm:grid-cols-3">
                  <div className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/30 hover:bg-slate-900/70 hover:shadow-[0_18px_50px_rgba(37,99,235,0.16)]">
                    <div className="mb-4 h-1.5 w-14 rounded-full bg-gradient-to-r from-blue-400/50 to-blue-500/10" />
                    <h2 className="text-lg font-semibold text-slate-100">Behavior classification</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">Label wallets by holding speed and buy-sell balance instead of reading raw transfers by hand.</p>
                  </div>
                  <div className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/30 hover:bg-slate-900/70 hover:shadow-[0_18px_50px_rgba(37,99,235,0.16)]">
                    <div className="mb-4 h-1.5 w-14 rounded-full bg-gradient-to-r from-blue-400/50 to-blue-500/10" />
                    <h2 className="text-lg font-semibold text-slate-100">Similarity detection</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">Compare wallets for overlap in token exposure, allocation patterns, and coordinated action.</p>
                  </div>
                  <div className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/30 hover:bg-slate-900/70 hover:shadow-[0_18px_50px_rgba(37,99,235,0.16)]">
                    <div className="mb-4 h-1.5 w-14 rounded-full bg-gradient-to-r from-blue-400/50 to-blue-500/10" />
                    <h2 className="text-lg font-semibold text-slate-100">Portfolio tracking</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">Keep named wallet collections and batch-run repeat research without rebuilding inputs.</p>
                  </div>
                </div>
              </div>

              <div className="relative rounded-[32px] border border-slate-800 bg-[linear-gradient(180deg,rgba(10,26,47,0.95),rgba(15,23,42,0.96))] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] transition-all duration-500 hover:-translate-y-1 hover:border-blue-500/30 hover:shadow-[0_28px_90px_rgba(37,99,235,0.18)]">
                <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />
                <div className="rounded-[24px] border border-slate-700 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Active Wallet Signal</div>
                      <div className="mt-1 text-xl font-semibold text-slate-50">Behavior snapshot</div>
                    </div>
                    <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">Fresh</div>
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Speed</div>
                      <div className="mt-2 text-3xl font-semibold text-blue-300">Momentum</div>
                      <div className="mt-1 text-sm text-slate-400">Median hold time 8.4h</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Flow</div>
                      <div className="mt-2 text-3xl font-semibold text-slate-100">Balanced</div>
                      <div className="mt-1 text-sm text-slate-400">Net buying profile</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Win rate</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">74%</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Trimmed PnL</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">+412 SOL</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Tokens / day</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">3.8</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Analysis modes</div>
                      <div className="text-xs text-slate-400">Dashboard + API</div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                          <LineChart className="h-4 w-4 text-blue-300" />
                          Manual research
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-400">Browse, inspect, and save wallets directly in the dashboard.</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                          <Code2 className="h-4 w-4 text-blue-300" />
                          Programmatic access
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-400">Query the same intelligence layer from the SDK and REST API.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-auto mt-2 max-w-7xl px-5 pb-10 md:px-8">
              <div className="overflow-hidden rounded-[28px] border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.72))]">
                <div className="grid gap-px bg-slate-800/80 md:grid-cols-4">
                  {stats.map(([value, label, note], index) => (
                    <div
                      key={label}
                      className={`group relative bg-slate-900/80 px-6 py-6 transition-all duration-300 hover:bg-slate-900 ${
                        index < stats.length - 1 ? 'md:border-r md:border-slate-800' : ''
                      }`}
                    >
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/0 to-transparent opacity-0 transition-opacity duration-300 group-hover:via-blue-400/50 group-hover:opacity-100" />
                      <div className="text-3xl font-semibold text-slate-100">{value}</div>
                      <div className="mt-2 text-sm text-slate-300">{label}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="features" className="border-b border-slate-800/70">
            <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
              <div className="max-w-3xl">
                <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Dashboard tools</div>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-50 md:text-5xl">What you can do inside the dashboard.</h2>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-400">
                  These are the main analyst workflows: surface wallets, compare behavior, track collections, and inspect deep profiles without leaving the product.
                </p>
              </div>

              <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="grid gap-5 md:grid-cols-2">
                  {features.map(([title, description]) => (
                    <div key={title} className="group rounded-[28px] border border-slate-800 bg-slate-900/40 p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-500/20 hover:bg-slate-900/70 hover:shadow-[0_20px_55px_rgba(15,23,42,0.45)]">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/40 text-slate-200 transition-transform duration-300 group-hover:scale-110 group-hover:border-blue-500/30">
                        {title === 'Discover' && <LineChart className="h-5 w-5" />}
                        {title === 'Similarity Lab' && <Code2 className="h-5 w-5" />}
                        {title === 'Tracked Wallets' && <Wallet className="h-5 w-5" />}
                        {title === 'Holder Profiles' && <ShieldCheck className="h-5 w-5" />}
                        {title === 'Wallet Hunt' && <Terminal className="h-5 w-5" />}
                      </div>
                      <h3 className="mt-5 text-xl font-semibold text-slate-100">{title}</h3>
                      <p className="mt-3 text-sm leading-7 text-slate-400">{description}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-[32px] border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(10,26,47,0.96))] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-purple-500/20 hover:shadow-[0_18px_48px_rgba(37,99,235,0.12)]">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-blue-300/80">Research angle</div>
                  <h3 className="mt-4 text-2xl font-semibold text-slate-50">Two behavioral axes define the system.</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-400">
                    Sova Intel treats wallet behavior as something measurable: how quickly a wallet exits and how it balances buying against selling over time.
                  </p>

                  <div className="mt-8 space-y-4">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Speed</div>
                      <div className="mt-2 text-lg font-semibold text-slate-100">Sniper, Scalper, Momentum, Intraday, Day Trader, Swing, Position, Hodler</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
                      <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Flow</div>
                      <div className="mt-2 text-lg font-semibold text-slate-100">Buy-Only, Accumulator, Balanced, Distributor, Sell-Only</div>
                    </div>
                    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
                      <div className="text-xs uppercase tracking-[0.22em] text-blue-300/80">Why it matters</div>
                      <p className="mt-2 text-sm leading-7 text-slate-100/90">These labels let an analyst filter for behavior first, then inspect profitability, overlap, and timing with much less noise.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="access" className="border-b border-slate-800/70 bg-slate-950/40">
            <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
              <div className="max-w-2xl">
                <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Access channels</div>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-50 md:text-5xl">Use the interface that fits the work.</h2>
                <p className="mt-4 text-lg leading-8 text-slate-400">
                  Both surfaces sit on the same intelligence layer. Choose the browser when you need visual inspection, or code when you need repeatable throughput.
                </p>
              </div>

              <div className="mt-12 grid gap-6 lg:grid-cols-2">
                <div className="group rounded-[32px] border border-slate-800 bg-slate-900/40 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/20 hover:bg-slate-900/70 hover:shadow-[0_20px_55px_rgba(37,99,235,0.14)]">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Recommended for analysts and traders</div>
                      <h3 className="mt-3 text-2xl font-semibold text-slate-100">Web Dashboard</h3>
                    </div>
                    <div className="rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-300">Browser workflow</div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-400">
                    Browse ranked wallets, open full holder profiles, save collections, and work through behavioral research in a visual interface.
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    {['Discover', 'Holder Profiles', 'Similarity Lab', 'Tracked Wallets'].map((item) => (
                      <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">{item}</div>
                    ))}
                  </div>
                  <div className="mt-6">
                    <Button onClick={() => setShowAuthModal(true)} className="bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700">
                      Get Started
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="group rounded-[32px] border border-slate-800 bg-slate-900/40 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-purple-500/20 hover:bg-slate-900/70 hover:shadow-[0_20px_55px_rgba(124,58,237,0.14)]">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Recommended for developers and autonomous systems</div>
                      <h3 className="mt-3 text-2xl font-semibold text-slate-100">Intel API</h3>
                    </div>
                    <div className="rounded-full bg-purple-500/10 px-3 py-1 text-xs text-purple-300">Programmatic workflow</div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-400">
                    Call wallet HUD, wallet profile, wallet tokens, and async analysis jobs from code using API keys or direct X402 payment.
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    {['SDK', 'API key auth', 'X402 payments', 'Job polling'].map((item) => (
                      <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">{item}</div>
                    ))}
                  </div>
                  <div className="mt-6">
                    <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800 hover:text-white">
                        View Docs
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="border-b border-slate-800/70">
            <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
              <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="max-w-xl">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Getting started</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-50 md:text-5xl">Operational in minutes.</h2>
                  <p className="mt-4 text-lg leading-8 text-slate-400">
                    The product should feel immediate: account, configure access, query data, then keep the workflow running.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {steps.map(([number, time, title, description]) => (
                    <div key={number} className="group rounded-[28px] border border-slate-800 bg-slate-900/40 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/20 hover:bg-slate-900/70 hover:shadow-[0_18px_50px_rgba(37,99,235,0.12)]">
                      <div className="flex items-end justify-between gap-3">
                        <div className="text-4xl font-semibold tracking-[-0.04em] text-slate-100">{number}</div>
                        <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{time}</div>
                      </div>
                      <h3 className="mt-6 text-xl font-semibold text-slate-100">{title}</h3>
                      <p className="mt-3 text-sm leading-7 text-slate-400">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="border-b border-slate-800/70 bg-slate-950/40">
            <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
              <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Developer section</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-50 md:text-5xl">Behavioral data as infrastructure.</h2>
                  <p className="mt-4 text-lg leading-8 text-slate-400">Use the SDK for typed access to the same wallet intelligence exposed in the dashboard.</p>

                  <div className="mt-8 overflow-hidden rounded-[28px] border border-slate-800 bg-[linear-gradient(180deg,rgba(10,26,47,0.95),rgba(15,23,42,0.96))] transition-all duration-300 hover:border-blue-500/25 hover:shadow-[0_18px_48px_rgba(37,99,235,0.14)]">
                    <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4 text-xs uppercase tracking-[0.22em] text-slate-500">
                      <Terminal className="h-4 w-4" />
                      Install
                    </div>
                    <div className="px-5 py-6 font-mono text-sm text-blue-300">npm install @sova-intel/sdk</div>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-[28px] border border-slate-800 bg-[#0a1220] transition-all duration-300 hover:border-purple-500/25 hover:shadow-[0_18px_48px_rgba(124,58,237,0.14)]">
                    <div className="border-b border-slate-800 bg-[#111827] px-5 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                          </div>
                          <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-[11px] text-slate-300">
                            wallet-intel.ts
                          </div>
                        </div>
                        <div className="rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-[11px] text-purple-300">
                          Node / TS SDK
                        </div>
                      </div>
                    </div>

                    <div className="border-b border-slate-800 bg-[#0f172a] px-5 py-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">SDK usage</div>
                      <div className="mt-1 text-sm font-medium text-slate-200">Programmatic access through `@sova-intel/sdk`</div>
                    </div>

                    <div className="overflow-x-auto bg-[#08111f] px-0 py-5 font-mono text-[13px] leading-8 text-slate-300">
                      {editorLines.map((editorLine) => (
                        <div key={editorLine.line} className="grid grid-cols-[44px_minmax(0,1fr)] gap-0 px-5">
                          <div className="select-none pr-4 text-right text-slate-600">{editorLine.line}</div>
                          <div>
                            {editorLine.parts.map((part, index) => (
                              <span key={`${editorLine.line}-${index}`} className={part.className}>
                                {part.text}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-5">
                  <div className="rounded-[32px] border border-slate-800 bg-slate-900/40 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-purple-500/20 hover:bg-slate-900/70 hover:shadow-[0_20px_55px_rgba(124,58,237,0.14)]">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Endpoints</div>
                    <div className="mt-6 space-y-4">
                      {endpoints.map(([name, credits, description]) => (
                        <div key={name} className="flex gap-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 transition-all duration-300 hover:border-purple-500/20 hover:bg-slate-950/70">
                          <div className="h-fit rounded-full bg-purple-500/10 px-3 py-1 text-xs text-purple-300">{credits}</div>
                          <div>
                            <div className="font-semibold text-slate-100">{name}</div>
                            <div className="mt-1 text-sm leading-6 text-slate-400">{description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[32px] border border-blue-500/20 bg-[linear-gradient(180deg,rgba(37,99,235,0.12),rgba(124,58,237,0.12))] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-blue-400/35 hover:shadow-[0_20px_60px_rgba(59,130,246,0.18)]">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-blue-300/80">Autonomous payments</div>
                    <h3 className="mt-4 text-2xl font-semibold text-slate-50">X402 for pay-per-call execution.</h3>
                    <p className="mt-4 text-sm leading-7 text-slate-200/85">
                      When a client is not using a pre-funded account, the API can return HTTP 402 payment instructions.
                      The caller signs the USDC payment and resends with a <code className="rounded bg-slate-950/60 px-1 py-0.5 font-mono text-xs text-blue-200">payment-signature</code> header.
                      This is built for autonomous agent flows without changing the underlying wallet intelligence contract.
                    </p>
                    <div className="mt-6">
                      <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer">
                        <Button className="bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700">
                          Full API Reference
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="border-b border-white/10">
            <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
              <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="max-w-xl">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Security and trust</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-50 md:text-5xl">Built for serious Solana research workflows.</h2>
                  <p className="mt-4 text-lg leading-8 text-slate-400">
                    The product is designed around verifiable trading behavior, repeatable access paths, and a narrower claim set than generic analytics tooling.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    'Specific wallet behavior taxonomy instead of generic scoring.',
                    'Direct Solana-native and on-chain-adjacent workflows.',
                    'Self-serve API access with optional X402 pay-per-call routing.',
                    'Operational for both browser research and autonomous agents.',
                  ].map((point) => (
                    <div key={point} className="rounded-[28px] border border-slate-800 bg-slate-900/40 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/20 hover:bg-slate-900/70">
                      <ShieldCheck className="h-5 w-5 text-blue-300" />
                      <p className="mt-4 text-sm leading-7 text-slate-300">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="pricing" className="border-b border-slate-800/70 bg-slate-950/40">
            <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
              <div className="max-w-2xl">
                <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Pricing</div>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-50 md:text-5xl">Credit packs. No subscription layer.</h2>
                <p className="mt-4 text-lg leading-8 text-slate-400">
                  Credits are purchased in advance and deducted per API call. Dashboard access is included with an account.
                </p>
              </div>

              <div className="mt-12 grid gap-5 md:grid-cols-3">
                {pricing.map(([name, price, credits, unit]) => {
                  const highlighted = name === 'Builder';
                  return (
                    <div key={name} className={`rounded-[32px] border p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_60px_rgba(15,23,42,0.32)] ${highlighted ? 'border-blue-500/30 bg-[linear-gradient(180deg,rgba(37,99,235,0.12),rgba(124,58,237,0.12))] hover:border-blue-400/40' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70'}`}>
                      <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{name}</div>
                      <div className="mt-5 text-5xl font-semibold tracking-[-0.05em] text-slate-50">{price}</div>
                      <div className="mt-4 text-lg font-medium text-slate-200">{credits}</div>
                      <div className="mt-1 text-sm text-slate-400">{unit}</div>
                      <div className="mt-8 space-y-3 text-sm text-slate-300">
                        <div>Wallet HUD, profile, tokens, and batch endpoints.</div>
                        <div>API key and X402 auth paths.</div>
                        <div>Works for manual teams and programmatic use.</div>
                      </div>
                      <Button
                        onClick={() => setShowAuthModal(true)}
                        className={`mt-8 w-full ${highlighted ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700' : 'border border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800 hover:text-white'}`}
                        variant={highlighted ? 'default' : 'outline'}
                      >
                        Choose {name}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </main>

        <footer className="relative border-t border-slate-800/70 bg-slate-950/70">
          <div className="mx-auto max-w-7xl px-5 py-14 md:px-8 md:py-16">
            <div className="grid gap-12 border-b border-slate-800/70 pb-12 md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
              <div className="max-w-sm">
                <div className="flex items-center gap-3">
                  <Image src="/sova_badge_primary.svg" alt="Sova Intel" width={32} height={32} className="rounded-md ring-1 ring-white/10" />
                  <span className="text-lg font-semibold text-slate-100">Sova Intel</span>
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-400">
                  Solana wallet behavioral intelligence for analysts, traders, and developers.
                </p>
                <div className="mt-5 flex items-center gap-4 text-slate-400">
                  <Link href="https://x.com/Sova_intel" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-slate-100">
                    X
                  </Link>
                  <Link href="https://t.me/sovaintel" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 transition-colors hover:text-slate-100">
                    <Send className="h-4 w-4" />
                    Telegram
                  </Link>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Product</div>
                <div className="mt-5 space-y-3 text-sm text-slate-400">
                  <a href="#features" className="block transition-colors hover:text-slate-100">Features</a>
                  <a href="#access" className="block transition-colors hover:text-slate-100">Access</a>
                  <a href="#pricing" className="block transition-colors hover:text-slate-100">Pricing</a>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Resources</div>
                <div className="mt-5 space-y-3 text-sm text-slate-400">
                  <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer" className="block transition-colors hover:text-slate-100">
                    Documentation
                  </Link>
                  <Link href="/help" className="block transition-colors hover:text-slate-100">Help</Link>
                  <Link href="https://t.me/sovaintel" target="_blank" rel="noopener noreferrer" className="block transition-colors hover:text-slate-100">
                    Telegram
                  </Link>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Legal</div>
                <div className="mt-5 space-y-3 text-sm text-slate-400">
                  <Link href="/terms" className="block transition-colors hover:text-slate-100">Terms</Link>
                  <Link href="https://x.com/Sova_intel" target="_blank" rel="noopener noreferrer" className="block transition-colors hover:text-slate-100">
                    X
                  </Link>
                </div>
              </div>
            </div>

            <div className="pt-8 text-center text-sm text-slate-500">
              © 2026 Sova Intel. All rights reserved.
            </div>
          </div>

          <Suspense fallback={null}>
            <SearchParamsHandler showAuthModal={showAuthModal} setShowAuthModal={setShowAuthModal} />
          </Suspense>
        </footer>
      </div>
    </LandingShell>
  );
}
