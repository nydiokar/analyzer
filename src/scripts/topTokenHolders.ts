import 'dotenv/config';
import axios from 'axios';

type Commitment = 'finalized' | 'confirmed' | 'processed';

function parseArgs(argv: string[]): { mint?: string; commitment?: Commitment; baseUrl: string } {
  const out: { mint?: string; commitment?: Commitment; baseUrl: string } = {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3001/api/v1',
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--mint' && args[i + 1]) {
      out.mint = args[++i];
    } else if (a === '--commitment' && args[i + 1]) {
      out.commitment = args[++i] as Commitment;
    } else if (a === '--baseUrl' && args[i + 1]) {
      out.baseUrl = args[++i];
    } else if (!a.startsWith('--') && !out.mint) {
      out.mint = a; // positional mint
    }
  }
  return out;
}

function printUsage(): void {
  console.log('Usage: ts-node src/scripts/topTokenHolders.ts --mint <MINT> [--commitment finalized|confirmed|processed] [--baseUrl http://localhost:3001/api/v1]');
  console.log('Env vars: TEST_API_KEY (required for API auth), API_BASE_URL (optional)');
}

async function main(): Promise<void> {
  const { mint, commitment, baseUrl } = parseArgs(process.argv);
  if (!mint) {
    printUsage();
    process.exit(1);
  }

  const apiKey = process.env.TEST_API_KEY;
  if (!apiKey) {
    console.error('TEST_API_KEY is not set in environment.');
    process.exit(1);
  }

  const url = `${baseUrl}/token-info/${mint}/top-holders${commitment ? `?commitment=${encodeURIComponent(commitment)}` : ''}`;
  try {
    const res = await axios.get(url, {
      headers: { 'x-api-key': apiKey },
      timeout: 30000,
    });
    const data = res.data as {
      mint: string;
      context: { slot: number; apiVersion?: string };
      holders: Array<{ tokenAccount: string; ownerAccount?: string; amount: string; decimals: number; uiAmount: number | null; uiAmountString: string; rank: number }>
    };

    console.log(`Mint: ${data.mint}`);
    console.log(`Slot: ${data.context?.slot}`);
    console.log('Top holders:');
    for (const h of data.holders) {
      const display = h.ownerAccount || h.tokenAccount;
      console.log(`${h.rank}. ${display}  (tokenAcc=${h.tokenAccount})  ui=${h.uiAmountString}  raw=${h.amount}  dec=${h.decimals}`);
    }
  } catch (err: any) {
    const status = err?.response?.status;
    const body = err?.response?.data;
    console.error(`Request failed${status ? ` (HTTP ${status})` : ''}.`);
    if (body) {
      try {
        console.error(typeof body === 'string' ? body : JSON.stringify(body));
      } catch {
        console.error(body);
      }
    } else {
      console.error(err?.message || err);
    }
    process.exit(1);
  }
}

main();


