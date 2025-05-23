import WalletProfileLayout from "@/components/layout/WalletProfileLayout";

export const dynamic = 'force-dynamic'; // Keep this, it's good practice for dynamic routes

export default async function WalletProfilePage({ params }: { params: { walletAddress: string } }) {
  // Per Next.js 15 docs, params must be awaited in async Server Components
  const awaitedParams = await params;
  const { walletAddress } = awaitedParams;

  return (
    // Pass the resolved walletAddress, not the whole params promise or awaited object if not needed by layout directly
    <WalletProfileLayout walletAddress={walletAddress}>
      <div>
        <h1>Wallet Profile Main Content</h1>
        <p>Displaying data for wallet: {walletAddress}</p>
        {/* Actual tab content will go here */}
      </div>
    </WalletProfileLayout>
  );
} 