What is an ATA (Associated Token Account)?
An Associated Token Account (ATA) is a special account that holds tokens for a specific wallet. For every token a wallet wants to hold, there needs to be a separate ATA created.

The Process They Described
Compute the ATA from the mint address and wallet address
Run getTransactionsForAddress on the ATA (not the wallet address)
This approach is much more efficient because:

Wallet addresses can have thousands of transactions (SOL transfers, program interactions, etc.)
Token ATAs only have transactions related to that specific token
How to Compute an ATA
You can compute the ATA address using:

import { getAssociatedTokenAddress } from '@solana/spl-token';

const ata = await getAssociatedTokenAddress(
  mintAddress,    // Your token mint
  walletAddress   // The wallet address
);
Then Query the ATA
const response = await fetch('https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransactionsForAddress',
    params: [
      ata.toString(), // Query the ATA, not the wallet
      {
        transactionDetails: 'full',
        limit: 100
      }
    ]
  })
});