// ---------------------------------------------------------------------------
// X402 payment builder — Solana USDC transferChecked
// Only loaded when x402 mode is active.
// ---------------------------------------------------------------------------

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

export async function buildSolanaX402Payment(
  privateKeyBase58: string,
  payTo: string,
  amountBaseUnits: bigint,
): Promise<string> {
  const {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    clusterApiUrl,
  } = await import("@solana/web3.js");
  const { createTransferCheckedInstruction, getAssociatedTokenAddress } =
    await import("@solana/spl-token");
  const bs58 = await import("bs58");

  const connection = new Connection(
    process.env.SOLANA_RPC_URL ?? clusterApiUrl("mainnet-beta"),
  );

  const payer = Keypair.fromSecretKey(bs58.default.decode(privateKeyBase58));
  const usdcMint = new PublicKey(USDC_MINT);
  const treasury = new PublicKey(payTo);

  const sourceAta = await getAssociatedTokenAddress(usdcMint, payer.publicKey);
  const destAta = await getAssociatedTokenAddress(usdcMint, treasury);

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payer.publicKey });

  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      usdcMint,
      destAta,
      payer.publicKey,
      amountBaseUnits,
      USDC_DECIMALS,
    ),
  );

  tx.sign(payer);

  const serialized = tx.serialize();
  const payload = JSON.stringify({
    x402Version: 2,
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    payload: { transaction: Buffer.from(serialized).toString("base64") },
  });

  return Buffer.from(payload).toString("base64");
}
