'use client';

import React, { useState, Suspense, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';
import { useRouter, useSearchParams } from 'next/navigation';
import { LandingShell } from '@/components/layout/LandingShell';
import { Send, ChevronRight, Terminal, ArrowRight } from 'lucide-react';

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

  if (isAuthenticated) return null;

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
      {/*
        .landing-noise and .hero-grid are defined in globals.css (or injected below via <style>).
        Noise: fixed SVG fractal overlay at opacity 0.025 — adds micro-texture without being visible in scans.
        Hero grid: radial-gradient dot pattern at 7% slate-400 on 32px grid.
      */}
      <style>{`
        .landing-noise::before {
          content: '';
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          pointer-events: none;
          z-index: 100;
          opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          background-repeat: repeat;
          background-size: 128px 128px;
        }
        .hero-grid {
          background-image: radial-gradient(circle, rgb(148 163 184 / 0.07) 1px, transparent 1px);
          background-size: 32px 32px;
        }
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .cursor-blink::after {
          content: '▋';
          animation: blink 1s step-end infinite;
          color: rgb(74 222 128);
          margin-left: 2px;
        }
      `}</style>

      <div className="landing-noise min-h-screen w-full bg-slate-950 text-slate-100">

        {/* ── 1. Navigation ─────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 w-full border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <Image
                src="/sova_badge_primary.svg"
                alt="Sova Intel"
                width={32}
                height={32}
                className="rounded-md"
              />
              <span className="text-sm font-semibold tracking-tight text-white">Sova Intel</span>
            </div>
            <nav className="flex items-center gap-2">
              <Button
                onClick={() => setShowAuthModal(true)}
                variant="outline"
                className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white text-sm transition-all duration-150"
              >
                Sign In
              </Button>
              <Button
                onClick={() => setShowAuthModal(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm px-5 transition-all duration-150"
              >
                Sign Up
              </Button>
            </nav>
          </div>
        </header>

        {/* ── 2. Hero ───────────────────────────────────────────────── */}
        <section className="hero-grid relative overflow-hidden border-b border-slate-800">
          {/* Ambient blobs — radial-gradient, no blur-3xl to avoid compositing cost */}
          <div
            className="pointer-events-none absolute left-1/3 top-0 -translate-x-1/2"
            style={{ width: 800, height: 600, background: 'radial-gradient(ellipse at center, rgb(37 99 235 / 0.07) 0%, transparent 70%)' }}
          />
          <div
            className="pointer-events-none absolute right-1/4 top-1/4"
            style={{ width: 500, height: 400, background: 'radial-gradient(ellipse at center, rgb(124 58 237 / 0.06) 0%, transparent 70%)' }}
          />

          <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-24 md:pt-32">
            <div className="mx-auto max-w-3xl text-center">

              {/* Eyebrow badge with pulsing live dot */}
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 font-mono text-xs text-slate-400">
                <span aria-hidden="true" className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                Solana wallet behavioral intelligence
              </div>

              {/* H1 — specific claim, gradient on the classification vocabulary */}
              <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight text-white md:text-6xl lg:text-7xl">
                Classify any Solana wallet
                <br />
                by how it trades.{' '}
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Speed. Flow. Coordination.
                </span>
              </h1>

              {/* Subheadline — two sentences, dense, specific */}
              <p className="mx-auto mb-10 max-w-2xl text-base text-slate-400 leading-relaxed md:text-lg">
                Eight speed categories — Sniper to Hodler — and five flow patterns — Accumulator to Distributor — applied to every wallet on Solana.
                Use the dashboard to browse, filter, and profile, or query the same behavioral data through the REST API.
              </p>

              {/* CTA pair */}
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <Button
                  onClick={() => setShowAuthModal(true)}
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-3.5 text-base font-medium shadow-lg shadow-blue-900/30 transition-all duration-150"
                >
                  Start Analyzing
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
                <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    size="lg"
                    className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white px-8 py-3.5 text-base font-medium transition-all duration-150"
                  >
                    API Docs
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Stats strip — data-table border-grid pattern */}
            <div className="mx-auto mt-20 max-w-5xl grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800 md:grid-cols-4">
              {[
                { value: '8', label: 'Speed categories' },
                { value: '5', label: 'Flow patterns' },
                { value: '6', label: 'API endpoints' },
                { value: '$0.009', label: 'Per call at scale' },
              ].map((stat) => (
                <div key={stat.label} className="bg-slate-900/80 px-6 py-6 text-center">
                  <div className="text-2xl font-bold text-white md:text-3xl">{stat.value}</div>
                  <div className="mt-1 text-xs text-slate-500 uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 3. Two-Surface Split ──────────────────────────────────── */}
        <section className="border-b border-slate-800 bg-slate-900/40">
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold text-white md:text-4xl">Two surfaces, one intelligence layer</h2>
              <p className="mt-3 text-base text-slate-400 leading-normal">
                Use the dashboard manually or consume the same data programmatically via API.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Dashboard card — blue path */}
              <div className="group rounded-2xl border border-slate-800 bg-slate-900 p-8 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-slate-500 uppercase tracking-wider">sova-intel.com</div>
                    <div className="text-base font-semibold text-white">The Dashboard</div>
                  </div>
                </div>
                <p className="mb-5 text-sm text-slate-400 leading-normal">
                  A web application for Solana wallet analytics. Browse wallets ranked by PnL and winrate,
                  run similarity analysis across holder sets, build tracked collections, and read deep
                  behavioral profiles for any address.
                </p>
                <div className="mb-5 text-xs font-mono text-slate-500 uppercase tracking-wider">For traders and researchers</div>
                <Button
                  onClick={() => setShowAuthModal(true)}
                  variant="outline"
                  size="sm"
                  className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150"
                >
                  Open Dashboard
                  <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>

              {/* API card — purple path */}
              <div className="group rounded-2xl border border-slate-800 bg-slate-900 p-8 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                    <Terminal className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-mono text-xs text-slate-500 uppercase tracking-wider">api.sova-intel.com</div>
                    <div className="text-base font-semibold text-white">The Intel API</div>
                  </div>
                </div>
                <p className="mb-5 text-sm text-slate-400 leading-normal">
                  A REST API for developers and autonomous agents. Query wallet behavior snapshots, full profiles,
                  per-token P&L breakdowns, and batch similarity jobs — authenticated by API key or direct
                  X402 payment from a USDC wallet.
                </p>
                <div className="mb-5 text-xs font-mono text-slate-500 uppercase tracking-wider">For developers and builders</div>
                <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150"
                  >
                    Read the Docs
                    <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Dashboard Feature Highlights ──────────────────────── */}
        <section className="border-b border-slate-800">
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">

            <div className="mb-4 text-center">
              <span className="font-mono text-xs uppercase tracking-widest text-blue-400">Dashboard</span>
            </div>
            <h2 className="mb-3 text-center text-3xl font-bold text-white md:text-4xl">
              Five surfaces, one source of truth
            </h2>
            <p className="mx-auto mb-14 max-w-xl text-center text-base text-slate-400 leading-relaxed">
              Each feature is built around a specific research question that manual methods cannot answer at scale.
            </p>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

              {/* Discover */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-300" aria-hidden="true">
                  <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">Discover</h3>
                <p className="min-h-[120px] text-sm text-slate-400 leading-relaxed">
                  A filterable feed of Solana wallets ranked by PnL, winrate, and activity. Each wallet carries
                  a Speed classification — Sniper through Hodler — and a Flow classification — Buy-Only through
                  Sell-Only. Filter by any combination of both axes to surface wallets that match your research frame.
                </p>
              </div>

              {/* Similarity Lab */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800/80 text-slate-300" aria-hidden="true">
                  <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">Similarity Lab</h3>
                <p className="min-h-[120px] text-sm text-slate-400 leading-relaxed">
                  Submit a list of wallet addresses or pull the top holders of any token. The system runs a background
                  analysis job and returns a similarity matrix showing which wallets share capital allocation patterns,
                  overlapping token exposure, and coordinated buying behavior. Used to detect shared teams, related
                  smart money clusters, and organized accumulation.
                </p>
              </div>

              {/* Tracked Wallets */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-300" aria-hidden="true">
                  <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">Tracked Wallets</h3>
                <p className="min-h-[120px] text-sm text-slate-400 leading-relaxed">
                  Save wallets with custom nicknames and organize them into named collections. View portfolio-level
                  stats across all tracked addresses, batch-analyze groups, and import or export wallet lists.
                  State persists across sessions.
                </p>
              </div>

              {/* Holder Profiles */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800/80 text-slate-300" aria-hidden="true">
                  <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">Holder Profiles</h3>
                <p className="min-h-[120px] text-sm text-slate-400 leading-relaxed">
                  A full behavioral profile for any wallet address: behavior composition, exit timing breakdown
                  by position duration, cognitive primitives, similarity pairs, and a human-readable narrative
                  of how the wallet trades. Not a summary — a structured analysis of the address as a market actor.
                </p>
              </div>

              {/* Wallet Hunt */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-colors duration-150 hover:border-slate-700">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-300" aria-hidden="true">
                  <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">Wallet Hunt</h3>
                <p className="min-h-[120px] text-sm text-slate-400 leading-relaxed">
                  Search the wallet database by behavioral criteria. Set the Speed category, Flow pattern, and
                  performance thresholds you are looking for and retrieve the addresses that match — without
                  reviewing wallets one at a time.
                </p>
              </div>
            </div>

            <div className="mt-12 text-center">
              <Button
                onClick={() => setShowAuthModal(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-7 transition-all duration-150"
              >
                Open the Dashboard
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        {/* ── 5. API / Developer Section ────────────────────────────── */}
        <section className="border-b border-slate-800 bg-slate-900/40">
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">

            <div className="mb-4 text-center">
              <span className="font-mono text-xs uppercase tracking-widest text-purple-400">Intel API</span>
            </div>
            <h2 className="mb-3 text-center text-3xl font-bold text-white md:text-4xl">
              Behavioral data as infrastructure
            </h2>
            <p className="mx-auto mb-16 max-w-xl text-center text-base text-slate-400 leading-relaxed">
              One SDK. Two auth modes. Every wallet data type Sova Intel produces, available programmatically.
            </p>

            <div className="grid gap-8 lg:grid-cols-2">

              {/* Left: code blocks */}
              <div className="space-y-5">

                {/* Install block */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
                  {/* Terminal chrome */}
                  <div className="mb-3 flex items-center gap-3">
                    <div aria-hidden="true" className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs text-slate-500">
                      <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                      install
                    </div>
                  </div>
                  {/* Separator line */}
                  <div className="border-t border-slate-800/60 -mx-5 mb-4 mt-0" />
                  <code>
                    <pre className="font-mono text-sm text-green-400">
                      <span className="cursor-blink">npm install @sova-intel/sdk</span>
                    </pre>
                  </code>
                  <p className="mt-3 font-mono text-xs text-slate-500">Zero dependencies. TypeScript. Handles async job polling and both auth modes.</p>
                </div>

                {/* Usage snippet */}
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-5">
                  {/* Terminal chrome */}
                  <div className="mb-3 flex items-center gap-3">
                    <div aria-hidden="true" className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs text-slate-500">
                      <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                      usage
                    </div>
                  </div>
                  {/* Separator line */}
                  <div className="border-t border-slate-800/60 -mx-5 mb-4 mt-0" />
                  <code>
                    <pre className="font-mono text-xs leading-relaxed text-slate-300 whitespace-pre">{`import { SovaClient } from '@sova-intel/sdk';

const client = new SovaClient({
  apiKey: process.env.SOVA_API_KEY,
});

// Wallet HUD — behavior snapshot, 1 credit
const hud = await client.walletHud('7xKX...mPqR');
console.log(hud.speedCategory);   // 'Sniper'
console.log(hud.flowPattern);     // 'Accumulator'
console.log(hud.winrate);         // 0.74

// Full behavioral profile — 5 credits
const profile = await client.walletProfile('7xKX...mPqR');
console.log(profile.narrative);   // human-readable trade summary

// Similarity job (async) — 20 credits
const job = await client.walletSimilarity(['addr1', 'addr2', 'addr3']);
const result = await job.poll(); // SDK handles polling`}</pre>
                  </code>
                </div>
              </div>

              {/* Right: endpoint list + X402 + docs link */}
              <div className="space-y-5">

                {/* Endpoint list */}
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                  <div className="mb-4 font-mono text-xs text-slate-400 uppercase tracking-widest">Endpoints</div>
                  <div className="space-y-3.5">
                    {[
                      { name: 'Wallet HUD', desc: 'Behavior snapshot — speed category, flow pattern, winrate, PnL, bot and whale flags', credits: '1 cr' },
                      { name: 'Wallet Profile', desc: 'Full behavioral analysis with exit timing breakdown and trade narrative', credits: '5 cr' },
                      { name: 'Wallet Tokens', desc: 'Per-token P&L breakdown for any address', credits: '3 cr' },
                      { name: 'Batch HUD', desc: 'Behavior snapshots for multiple wallets in a single call', credits: '5 cr' },
                      { name: 'Token Holder Profiles', desc: 'Async job — behavioral profiles for all holders of a given token', credits: '20 cr' },
                      { name: 'Wallet Similarity', desc: 'Async job — behavioral overlap and coordination comparison across a wallet set', credits: '20 cr' },
                    ].map((ep) => (
                      <div key={ep.name} className="flex items-start gap-3 text-sm">
                        <span className="mt-0.5 shrink-0 font-mono text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
                          {ep.credits}
                        </span>
                        <div>
                          <span className="font-semibold text-slate-200">{ep.name}</span>
                          <span className="text-slate-500"> — {ep.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* X402 card — blue-tinted, left accent stripe */}
                <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-6 border-l-2 border-l-blue-500/40">
                  <h3 className="mb-2 text-sm font-semibold text-slate-200">X402 — Autonomous Payments</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Pay per call directly from a Solana USDC wallet with no pre-funded account required.
                    The API returns HTTP 402 with payment instructions; the client builds and signs a USDC
                    transaction, then resends the request with a{' '}
                    <code className="font-mono text-xs text-blue-300 bg-slate-900 px-1 py-0.5 rounded">payment-signature</code>{' '}
                    header. Designed for AI agents operating autonomously — the SDK handles the full X402 flow.
                  </p>
                </div>

                <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150"
                  >
                    Full API Reference
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Pricing ────────────────────────────────────────────── */}
        <section className="border-b border-slate-800">
          <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">

            <div className="mb-4 text-center">
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500">Pricing</span>
            </div>
            <h2 className="mb-3 text-center text-3xl font-bold text-white md:text-4xl">
              Credit packs. No subscriptions.
            </h2>
            <p className="mx-auto mb-14 max-w-md text-center text-base text-slate-400 leading-relaxed">
              Buy credits, use them when you need them. Credits do not expire.
            </p>

            <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">

              {/* Starter */}
              <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-7">
                <div className="mb-1 font-mono text-xs text-slate-500 uppercase tracking-wider">Starter</div>
                {/* Oversized background number */}
                <div className="relative mb-1">
                  <span aria-hidden="true" className="pointer-events-none select-none absolute -top-3 left-0 text-7xl font-black leading-none text-slate-800/40">$15</span>
                  <div className="relative text-3xl font-bold text-white">$15</div>
                </div>
                <div className="mb-6 text-sm text-slate-500">1,000 credits &nbsp;·&nbsp; $0.015 / credit</div>
                <ul className="flex-1 space-y-2.5 text-sm text-slate-400">
                  {['1,000 Wallet HUDs', '200 Full Profiles', '50 Similarity jobs', 'API Key auth', 'X402 auth'].map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-0.5 text-green-500" aria-hidden="true">&#10003;</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => setShowAuthModal(true)}
                  variant="outline"
                  className="mt-8 w-full border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150"
                >
                  Get Starter
                </Button>
              </div>

              {/* Builder — highlighted */}
              <div className="flex flex-col rounded-2xl border border-blue-700/50 bg-gradient-to-b from-blue-950/40 to-slate-900 p-7 ring-1 ring-blue-700/30">
                {/* Gradient top-edge accent line */}
                <div aria-hidden="true" className="-mx-7 -mt-7 mb-6 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
                <div className="mb-1 font-mono text-xs text-blue-400 uppercase tracking-wider">Builder</div>
                {/* Oversized background number */}
                <div className="relative mb-1">
                  <span aria-hidden="true" className="pointer-events-none select-none absolute -top-3 left-0 text-7xl font-black leading-none text-slate-800/40">$120</span>
                  <div className="relative text-3xl font-bold text-white">$120</div>
                </div>
                <div className="mb-6 text-sm text-slate-400">10,000 credits &nbsp;·&nbsp; $0.012 / credit</div>
                <ul className="flex-1 space-y-2.5 text-sm text-slate-400">
                  {['10,000 Wallet HUDs', '2,000 Full Profiles', '500 Similarity jobs', 'API Key auth', 'X402 auth'].map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-0.5 text-green-500" aria-hidden="true">&#10003;</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => setShowAuthModal(true)}
                  className="mt-8 w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white transition-all duration-150"
                >
                  Get Builder
                </Button>
              </div>

              {/* Pro */}
              <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-7">
                <div className="mb-1 font-mono text-xs text-slate-500 uppercase tracking-wider">Pro</div>
                {/* Oversized background number */}
                <div className="relative mb-1">
                  <span aria-hidden="true" className="pointer-events-none select-none absolute -top-3 left-0 text-7xl font-black leading-none text-slate-800/40">$900</span>
                  <div className="relative text-3xl font-bold text-white">$900</div>
                </div>
                <div className="mb-6 text-sm text-slate-500">100,000 credits &nbsp;·&nbsp; $0.009 / credit</div>
                <ul className="flex-1 space-y-2.5 text-sm text-slate-400">
                  {['100,000 Wallet HUDs', '20,000 Full Profiles', '5,000 Similarity jobs', 'API Key auth', 'X402 auth'].map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-0.5 text-green-500" aria-hidden="true">&#10003;</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => setShowAuthModal(true)}
                  variant="outline"
                  className="mt-8 w-full border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150"
                >
                  Get Pro
                </Button>
              </div>
            </div>

            <p className="mt-8 text-center text-xs text-slate-500">
              Credits are deducted per API call. Dashboard access is included with any account.
            </p>
          </div>
        </section>

        {/* ── 7. Footer ─────────────────────────────────────────────── */}
        <footer className="bg-slate-950">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
              <div className="flex items-center gap-2.5">
                <Image src="/sova_badge_primary.svg" alt="Sova Intel" width={28} height={28} className="rounded-md" />
                <span className="text-sm font-semibold text-white">Sova Intel</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                <Link
                  href="https://t.me/sovaintel"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Telegram
                </Link>
                <Link
                  href="https://x.com/Sova_intel"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  X
                </Link>
                <Link
                  href="https://docs.sova-intel.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Docs
                </Link>
                <Link href="/terms" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
                  Terms
                </Link>
                <Link href="/help" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
                  Help
                </Link>
              </div>
            </div>
            <div className="mt-8 border-t border-slate-800/60 pt-8 text-center text-xs text-slate-700">
              Sova Intel &mdash; Solana wallet behavioral intelligence
            </div>
          </div>
        </footer>

        {/* Auth modal handler */}
        <Suspense fallback={null}>
          <SearchParamsHandler showAuthModal={showAuthModal} setShowAuthModal={setShowAuthModal} />
        </Suspense>
      </div>
    </LandingShell>
  );
}
