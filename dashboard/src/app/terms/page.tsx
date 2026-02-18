import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollText } from "lucide-react";
import Link from "next/link";

export default function TermsPage() {
  return (
    <AppShell>
      <div className="container mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl flex items-center gap-3">
              <ScrollText className="h-8 w-8 text-blue-500" />
              Terms of Service
            </h1>
            <p className="text-lg text-muted-foreground">
              Effective Date: February 11, 2026
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Welcome to Sova Intel</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-4 text-sm text-muted-foreground">
              <p>
                By using Sova Intel, you agree to these Terms. Simple as that. If you don&apos;t agree, don&apos;t use the platform.
              </p>
              <p>
                We&apos;re a Solana wallet analysis tool. We analyze public blockchain data and show you insights. That&apos;s it.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1. What We Do</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                We analyze public Solana blockchain data and give you insights on wallet behavior, trading patterns, and holdings.
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Wallet analysis (PnL, behavior patterns, trading metrics)</li>
                <li>Track your favorite wallets</li>
                <li>Holder analysis and wallet comparisons</li>
                <li>Real-time progress updates</li>
                <li>Data caching for faster lookups</li>
              </ul>
              <p className="font-semibold text-amber-400">
                We&apos;re in beta. Things might be slow sometimes. We&apos;re working on it.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">2. Acceptable Use</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                You might need an invite code during beta. Keep your credentials secure and don&apos;t share your account.
              </p>
              <p><strong className="text-foreground">Don&apos;t:</strong></p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Abuse rate limits or spam our API</li>
                <li>Scrape our data or reverse engineer our algorithms</li>
                <li>Create multiple accounts or automate signups</li>
                <li>Attempt unauthorized access to accounts or infrastructure</li>
                <li>Use the platform for illegal purposes or harassment</li>
              </ul>
              <p>
                Violations may result in immediate account termination.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">3. Your Data</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                Everything we analyze is already public on the Solana blockchain. We&apos;re just reading what&apos;s already out there.
              </p>
              <p><strong className="text-foreground">What we store:</strong></p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Your email and hashed password</li>
                <li>Wallets you track and any custom notes you add</li>
                <li>Analysis results to make things faster next time</li>
                <li>Usage logs for debugging and security</li>
              </ul>
              <p>
                <strong className="text-foreground">What we DON&apos;T do:</strong> We never sell your data. We don&apos;t share it with anyone. We&apos;re not in the data-selling business.
              </p>
              <p className="text-xs">
                Want to delete your account? Just contact us.
              </p>
            </CardContent>
          </Card>

          <Card className="border-red-500/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                4. We&apos;re Not Your Financial Advisor
                <span className="text-2xl">🚨</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p className="font-bold text-red-400 text-base">
                READ THIS: WE ARE NOT GIVING YOU FINANCIAL ADVICE.
              </p>
              <p>
                This is a data tool. We show you what wallets did in the past. That&apos;s it. We&apos;re not telling you what to buy, sell, or trade.
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Past performance means NOTHING about future results</li>
                <li>Just because a wallet made money before doesn&apos;t mean it will again</li>
                <li>You can lose all your money trading crypto</li>
                <li>Your trades are YOUR responsibility, not ours</li>
              </ul>
              <p className="font-semibold text-amber-400">
                Always do your own research and consult qualified financial advisors before making investment decisions.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">5. Things Break Sometimes</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                We try to be accurate, but blockchain data is messy. Our algorithms aren&apos;t perfect. Sometimes we get things wrong.
              </p>
              <p>The platform might go down because:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>We&apos;re doing maintenance or updates</li>
                <li>External data providers have issues</li>
                <li>Too many people using it at once (we&apos;re beta, remember?)</li>
                <li>Stuff just breaks sometimes 🤷</li>
              </ul>
              <p className="font-semibold text-foreground">
                We provide everything &quot;as is&quot; - no guarantees, no warranties.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">6. Rate Limits</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                We enforce rate limits to ensure fair access for all users. Excessive requests may result in temporary throttling or account restrictions.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">7. Who Owns What</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                Our code, algorithms, and designs are ours. Don&apos;t steal them.
              </p>
              <p>
                Your wallet nicknames and notes are yours. We just store them so you can see them.
              </p>
              <p>
                Blockchain data is public. Nobody owns it. But our analysis of that data is our intellectual property.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">8. Limitation of Liability</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">
                To the maximum extent permitted by law:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>We are not liable for trading losses or missed opportunities</li>
                <li>We are not responsible for data inaccuracies or analysis errors</li>
                <li>We are not liable for service outages or downtime</li>
                <li>We are not responsible for third-party service failures</li>
              </ul>
              <p className="font-semibold text-amber-400">
                You use this platform at your own risk.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">9. Security</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                We implement industry-standard security practices: password hashing, secure session management, rate limiting, and access controls.
              </p>
              <p>
                However, no system is perfectly secure. You are responsible for maintaining the confidentiality of your credentials and must notify us immediately if you suspect unauthorized access.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">10. We Can Change These Terms</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                We might update these Terms. If we make big changes, we&apos;ll let you know via email or a notice on the platform.
              </p>
              <p>
                If you keep using the platform after we update the Terms, that means you agree to the new ones.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">11. Termination</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                You may stop using the platform at any time.
              </p>
              <p>
                We may suspend or terminate your access if:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>You violate these Terms</li>
                <li>We detect abusive behavior or security threats</li>
                <li>We discontinue the service</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                We may retain certain data as required by law or for legitimate security purposes.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">12. Disputes</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                If you have any concerns or disputes, please contact us directly via Telegram or X. We believe most issues can be resolved through direct communication.
              </p>
              <p className="text-xs text-muted-foreground">
                These Terms are governed by applicable laws, and any legal proceedings must be brought in a court of competent jurisdiction.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">13. Legal Stuff</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                These Terms are the whole agreement. If part of it is unenforceable, the rest still applies.
              </p>
              <p>
                You can&apos;t transfer your account to someone else. We can transfer our rights if we sell the business or whatever.
              </p>
              <p className="text-xs text-muted-foreground">
                (This is the boring legal stuff lawyers make us say.)
              </p>
            </CardContent>
          </Card>

          <Card className="border-blue-500/30 bg-card/50">
            <CardHeader>
              <CardTitle className="text-lg">Contact Us</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none space-y-3 text-sm text-muted-foreground">
              <p>
                Questions about these Terms? Reach out to us:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Telegram: <Link href="https://t.me/sovaintel" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">t.me/sovaintel</Link></li>
                <li>X/Twitter: <Link href="https://x.com/Sova_intel" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">@Sova_intel</Link></li>
              </ul>
            </CardContent>
          </Card>

          <div className="text-center text-xs text-muted-foreground pt-8 pb-4 space-y-2">
            <p>© 2026 Sova Intel. All rights reserved.</p>
            <p>
              By using this platform, you agree to these Terms. Pretty simple.
            </p>
            <p className="text-slate-600">
              Now go analyze some wallets 🚀
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
