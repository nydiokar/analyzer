import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function createWallet() {
  console.log('[WALLET] Creating new PFTL wallet...');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['@postfiatorg/pft-chatbot-mcp'],
    env: process.env, // No BOT_SEED - setup mode
  });

  const client = new Client({ name: 'wallet-creator', version: '1.0.0' }, {});

  try {
    await client.connect(transport);
    console.log('[WALLET] MCP connected');

    const result = await client.callTool({
      name: 'create_wallet',
      arguments: { algorithm: 'ed25519' }
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const walletData = JSON.parse(content[0].text);

    console.log('\n========================================');
    console.log('WALLET CREATED SUCCESSFULLY');
    console.log('========================================');
    console.log('Address:', walletData.address);
    console.log('Seed:', walletData.seed);
    console.log('Public Key:', walletData.public_key);
    console.log('========================================\n');
    console.log('NEXT STEPS:');
    console.log('1. Save the seed in pft-bot_v2/.env as BOT_SEED=' + walletData.seed);
    console.log('2. Deposit at least 10 PFT to:', walletData.address);
    console.log('3. Use https://tasknode.postfiat.org to send PFT');
    console.log('========================================\n');

    await client.close();

    return walletData;
  } catch (err) {
    console.error('[WALLET] Error:', err);
    await client.close();
    throw err;
  }
}

createWallet().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
