import WalletProfileLayout from "@/components/layout/WalletProfileLayout";

export const dynamic = 'force-dynamic'; // Keep this, it's good practice for dynamic routes

export default function WalletProfilePage({ params }: { params: { walletAddress: string } }) {
  const { walletAddress } = params;

  return (
    <WalletProfileLayout walletAddress={walletAddress}>
      <div>
        <h1></h1>
        <p></p>
        {/* Actual tab content will go here */}
      </div>
    </WalletProfileLayout>
  );
} 