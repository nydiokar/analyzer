'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingShell } from '@/components/layout/LandingShell';
import { AuthModal } from '@/components/auth/AuthModal';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

// ── helpers ────────────────────────────────────────────────────────────────

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-blue-300">
      <span className="h-2 w-2 rounded-full bg-blue-400" />
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
      {children}
    </p>
  );
}

// ── prompt cards ───────────────────────────────────────────────────────────

type ResultLine = { label: string; value: string; color?: 'accent' | 'warn' | 'ok' | 'muted' };

function PromptCard({
  prompt,
  tool,
  cost,
  lines,
}: {
  prompt: string;
  tool: string;
  cost: string;
  lines: ResultLine[];
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all duration-300 hover:border-slate-700 hover:shadow-[0_18px_50px_rgba(0,0,0,0.3)]">
      {/* Question */}
      <div className="flex items-start gap-3 border-b border-slate-800 px-6 py-5">
        <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-purple-500/30 bg-purple-500/10 text-[11px] text-purple-300">
          ↗
        </span>
        <p className="text-sm italic leading-relaxed text-slate-300">&ldquo;{prompt}&rdquo;</p>
      </div>
      {/* Result */}
      <div className="px-6 py-5">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {tool} · {cost}
        </div>
        <dl className="space-y-1 font-mono text-[13px]">
          {lines.map(({ label, value, color }) => (
            <div key={label} className="flex gap-3">
              <dt className="w-40 flex-shrink-0 text-slate-500">{label}</dt>
              <dd className={
                color === 'accent' ? 'font-semibold text-violet-300' :
                color === 'warn'   ? 'text-amber-400' :
                color === 'ok'     ? 'text-emerald-400' :
                color === 'muted'  ? 'text-slate-500' :
                'text-slate-200'
              }>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ── install tab ────────────────────────────────────────────────────────────

function InstallBlock() {
  const [tab, setTab] = useState<'claudecode' | 'desktop'>('claudecode');

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 md:p-8">
      <div className="mb-6 flex gap-2">
        {(['claudecode', 'desktop'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              tab === t
                ? 'border border-slate-600 bg-slate-800 text-slate-100'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t === 'claudecode' ? 'Claude Code' : 'Claude Desktop / Cursor'}
          </button>
        ))}
      </div>

      {tab === 'claudecode' && (
        <pre className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-950 p-4 text-[13px] leading-6 text-slate-300">
          <span className="text-violet-400">claude</span>
          {' mcp add sova-intel \\\n  -e '}
          <span className="text-sky-300">SOVA_API_KEY</span>
          {'='}
          <span className="text-emerald-300">ak_your_key</span>
          {' \\\n  -- npx -y @sova-intel/mcp'}
        </pre>
      )}

      {tab === 'desktop' && (
        <>
          <pre className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-950 p-4 text-[13px] leading-6 text-slate-300">
            {'{\n  '}
            <span className="text-sky-300">&quot;mcpServers&quot;</span>
            {': {\n    '}
            <span className="text-sky-300">&quot;sova-intel&quot;</span>
            {': {\n      '}
            <span className="text-sky-300">&quot;command&quot;</span>
            {': '}
            <span className="text-emerald-300">&quot;npx&quot;</span>
            {',\n      '}
            <span className="text-sky-300">&quot;args&quot;</span>
            {': ['}
            <span className="text-emerald-300">&quot;-y&quot;</span>
            {', '}
            <span className="text-emerald-300">&quot;@sova-intel/mcp&quot;</span>
            {'],\n      '}
            <span className="text-sky-300">&quot;env&quot;</span>
            {': { '}
            <span className="text-sky-300">&quot;SOVA_API_KEY&quot;</span>
            {': '}
            <span className="text-emerald-300">&quot;ak_your_key&quot;</span>
            {' }\n    }\n  }\n}'}
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            Claude Desktop:{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-400">%APPDATA%\Claude\claude_desktop_config.json</code>
            {' (Windows) · '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-400">~/Library/Application Support/Claude/claude_desktop_config.json</code>
            {' (Mac)'}
            <br />
            Cursor: <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-400">.cursor/mcp.json</code> in project root
          </p>
        </>
      )}
    </div>
  );
}

// ── tool card ──────────────────────────────────────────────────────────────

function ToolCard({ name, desc, cost }: { name: string; desc: string; cost: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 transition-all duration-200 hover:border-slate-700">
      <p className="mb-1.5 font-mono text-[13px] font-medium text-violet-300">{name}</p>
      <p className="mb-3 text-sm leading-relaxed text-slate-400">{desc}</p>
      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-300">{cost}</span>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function McpPage() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('register');
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const openRegister = () => { setAuthTab('register'); setShowAuthModal(true); };
  const openLogin    = () => { setAuthTab('login');    setShowAuthModal(true); };

  return (
    <LandingShell>
      {/* background texture */}
      <div className="pointer-events-none fixed inset-0 opacity-25">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.2),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(124,58,237,0.15),_transparent_35%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.6),transparent_70%)]" />
      </div>

      {/* ── nav ── */}
      <header className="sticky top-0 z-50 border-b border-slate-800/70 bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/sova_badge_primary.svg" alt="Sova Intel" width={30} height={30} className="rounded-md ring-1 ring-white/10" />
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Sova Intel</div>
              <div className="text-sm font-semibold text-slate-100">MCP Server</div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={openLogin}
              className="hidden text-slate-400 hover:text-slate-100 md:inline-flex"
            >
              <LogIn className="mr-1.5 h-3.5 w-3.5" />
              Sign In
            </Button>
            <Button
              size="sm"
              onClick={openRegister}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
            >
              Get API Key
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-5 pb-32 md:px-8">

        {/* ── hero ── */}
        <section className="pt-20 pb-16 text-center md:pt-28">
          <Badge>@sova-intel/mcp · MCP Server</Badge>

          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em] text-slate-50 md:text-6xl">
            Ask questions about<br />
            <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
              on-chain wallets.
            </span>
            <br />Get answers.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
            Add one config block to Claude Desktop, Claude Code, or Cursor.
            Then ask anything — behavioral profiles, token holder maps,
            coordination detection — in plain language.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              onClick={openRegister}
              className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-white hover:from-blue-700 hover:to-purple-700"
            >
              Get an API key
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
            <Link
              href="https://www.npmjs.com/package/@sova-intel/mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="lg"
                className="border-slate-700 bg-slate-900/40 px-8 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                npm package ↗
              </Button>
            </Link>
          </div>

          {/* compatible clients */}
          <p className="mt-8 text-xs text-slate-600">
            Works with Claude Desktop · Claude Code · Cursor · any MCP-compatible client
          </p>
        </section>

        {/* ── demo prompts ── */}
        <section className="py-16">
          <SectionLabel>Live demo</SectionLabel>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-100 md:text-3xl">
            Three questions. Real answers.
          </h2>
          <p className="mb-10 text-slate-500">
            This is what a session looks like. You type the question — the MCP handles everything else.
          </p>

          <div className="space-y-4">
            <PromptCard
              prompt="What kind of trader is DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm?"
              tool="wallet_hud"
              cost="1 credit"
              lines={[
                { label: 'behavior',     value: 'DAY_TRADER',  color: 'accent' },
                { label: 'win rate',     value: '29.9%' },
                { label: 'median hold',  value: '12.9 hours' },
                { label: 'holdings',     value: '777 SOL · $62,892' },
                { label: 'data quality', value: 'GOLD',        color: 'ok' },
              ]}
            />

            <PromptCard
              prompt="Who are the top holders of J5DnHXXmKsXmCAeSvPRc5qR64ruYKcZHKwZijv9HnZgK and what are their trading styles?"
              tool="token_holder_profiles"
              cost="20 credits"
              lines={[
                { label: 'holders analyzed', value: '9 / 10' },
                { label: 'top 5 supply',     value: '17.98%' },
                { label: 'dominant style',   value: 'INTRADAY  (4 wallets, 11.9% supply)', color: 'accent' },
                { label: 'also present',     value: 'MOMENTUM · SWING · SNIPER',           color: 'muted' },
                { label: 'avg holder PnL',   value: '−260 SOL',                            color: 'warn' },
              ]}
            />

            <PromptCard
              prompt="Do any of those holders look coordinated or like the same actor?"
              tool="wallet_similarity"
              cost="20 credits"
              lines={[
                { label: 'coordination',  value: '0.28  LOW',            color: 'ok' },
                { label: 'pairs checked', value: '36' },
                { label: 'flagged pairs', value: '6',                    color: 'warn' },
                { label: 'top flag',      value: '2jjgBE… ↔ ACp9B9…' },
                { label: 'similarity',    value: '0.82 · 677 shared tokens', color: 'warn' },
              ]}
            />
          </div>

          <p className="mt-6 text-center text-xs text-slate-600">
            Async jobs (token holders, similarity) are handled automatically — the MCP polls and resumes without you doing anything.
          </p>
        </section>

        {/* ── install ── */}
        <section className="py-16">
          <SectionLabel>Setup</SectionLabel>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-100 md:text-3xl">
            Running in two minutes.
          </h2>
          <p className="mb-10 text-slate-500">
            No SDK to learn. No code to write. Just a config block and a restart.
          </p>

          {/* steps */}
          <ol className="mb-8 space-y-6">
            {[
              {
                n: '1',
                title: <><a onClick={openRegister} className="cursor-pointer text-blue-400 hover:underline">Get an API key</a> at sova-intel.com</>,
              },
              {
                n: '2',
                title: 'Add to your client config',
                content: <InstallBlock />,
              },
              {
                n: '3',
                title: 'Restart your client and confirm sova-intel appears connected.',
              },
              {
                n: '4',
                title: 'Ask your first question — paste any of the prompts above.',
              },
            ].map(({ n, title, content }) => (
              <li key={n} className="flex gap-5">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-400">
                  {n}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="mb-3 text-sm font-medium text-slate-200">{title}</p>
                  {content}
                </div>
              </li>
            ))}
          </ol>

          {/* x402 note */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4 text-sm text-slate-500">
            <span className="font-medium text-slate-300">No account?</span>
            {' '}Use X402 mode — pay per call with Solana USDC, no signup needed.
            Set <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-400">SOLANA_PRIVATE_KEY</code> instead of an API key.
          </div>
        </section>

        {/* ── tools ── */}
        <section className="py-16">
          <SectionLabel>Tools</SectionLabel>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-100 md:text-3xl">
            Nine tools. Ask anything.
          </h2>
          <p className="mb-10 text-slate-500">
            Your client picks the right tool automatically based on your question.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ToolCard name="wallet_hud"              desc="Behavior type, win rate, hold time, and data quality for any wallet."               cost="1 credit" />
            <ToolCard name="wallet_profile"          desc="Full intel — HUD + PnL summary + behavior breakdown + KOL identity."                cost="5 credits" />
            <ToolCard name="wallet_token_pnl"        desc="Per-token PnL breakdown for a wallet, paginated."                                   cost="3 credits" />
            <ToolCard name="batch_wallet_hud"        desc="HUD signals for up to 30 wallets in one call."                                      cost="5 credits flat" />
            <ToolCard name="token_holder_profiles"   desc="Behavioral profiles for a token's top holders. Runs async, auto-resumes."           cost="20 credits" />
            <ToolCard name="wallet_similarity"       desc="Coordination and sybil score for 2–30 wallets."                                     cost="20 credits" />
            <ToolCard name="deep_token_analysis"     desc="Holder profiles + similarity bundled in one call."                                   cost="35 credits" />
            <ToolCard name="job_status / job_wait"   desc="Resume async jobs. Handled automatically — you rarely need to call these."          cost="Free" />
          </div>
        </section>

        {/* ── cta ── */}
        <section className="py-16">
          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 px-8 py-14 text-center">
            {/* top accent line */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />

            <h2 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
              Ready to ask your first question?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-slate-400">
              Get an API key, paste one config block, restart your client.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                onClick={openRegister}
                className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 text-white hover:from-blue-700 hover:to-purple-700"
              >
                Get API Key — free credits included
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
              <Link
                href="https://www.npmjs.com/package/@sova-intel/mcp"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  size="lg"
                  className="border-slate-700 bg-slate-900/40 px-8 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  npm package ↗
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── footer ── */}
      <footer className="border-t border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-6 md:px-8">
          <div className="flex gap-6 text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-300 transition-colors">sova-intel.com</Link>
            <Link href="https://www.npmjs.com/package/@sova-intel/mcp" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">npm</Link>
            <Link href="https://docs.sova-intel.com" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">Docs</Link>
            <Link href="/terms" className="hover:text-slate-300 transition-colors">Terms</Link>
          </div>
          <span className="text-sm text-slate-600">MIT License</span>
        </div>
      </footer>

      {/* ── auth modal ── */}
      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        defaultTab={authTab}
        onSuccess={() => {
          setShowAuthModal(false);
          if (isAuthenticated) router.push('/discover');
        }}
      />
    </LandingShell>
  );
}
