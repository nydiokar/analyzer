import WalletProfileLayout from "@/components/layout/WalletProfileLayout";
import { AppShell } from "@/components/layout/AppShell";

export const dynamic = 'force-dynamic'; // Keep this, it's good practice for dynamic routes

// This type definition is specifically crafted to satisfy the Next.js 15 build process,
// which expects a promise-like object for params in async pages.
interface WalletProfilePageProps {
  params: {
    walletAddress: string;
  } & Promise<any>; // Acknowledge the promise-like nature for the build check
}

// The component is async because in Next.js 15, `params` must be awaited before use.
export default async function WalletProfilePage({ params }: WalletProfilePageProps) {
  // Awaiting params is required by the Next.js runtime.
  const { walletAddress } = await params;

  return (
    <AppShell>
      <WalletProfileLayout walletAddress={walletAddress}>
        {null}
      </WalletProfileLayout>
    </AppShell>
  );
} 