import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CoinGeckoClient } from '../core/fetcher/coingecko-client';
import { RateLimitConfig } from '../types/crypto';
import { createLogger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('FindCoinID');

// Use the same default rate limit config as the reporter
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequestsPerMinute: parseInt(process.env.COINGECKO_RATE_LIMIT_MAX_REQ ?? '30', 10),
  buffer: parseInt(process.env.COINGECKO_RATE_LIMIT_BUFFER ?? '5', 10),
};

async function findCoin(query: string) {
  logger.info(`Searching for CoinGecko ID for query: "${query}"...`);
  const client = new CoinGeckoClient(DEFAULT_RATE_LIMIT);

  try {
    const coinList = await client.getCoinsList();
    logger.info(`Fetched ${coinList.length} coins from CoinGecko.`);

    const lowerCaseQuery = query.toLowerCase();

    const results = coinList.filter(coin => 
      coin.id.toLowerCase().includes(lowerCaseQuery) || 
      coin.symbol.toLowerCase() === lowerCaseQuery || // Exact symbol match
      coin.name.toLowerCase().includes(lowerCaseQuery)
    );

    if (results.length === 0) {
      logger.warn(`No coins found matching "${query}". Try a different symbol or name.`);
    } else {
      console.log(`Found ${results.length} potential match(es) for "${query}":`);
      results.slice(0, 20).forEach(coin => { // Limit output to avoid spam
        console.log(`  - ID: ${coin.id.padEnd(25)} Symbol: ${coin.symbol.padEnd(10)} Name: ${coin.name}`);
      });
      if (results.length > 20) {
        console.log("  ... (output limited to 20 results)");
      }
      console.log("\nUse the 'ID' value with the analyze-changes script.");
    }

  } catch (error) {
    logger.error(`Error finding coin ID for "${query}":`, error instanceof Error ? error.message : error);
  } finally {
    logger.info(`Search finished for "${query}".`);
    // Note: CoinGeckoClient doesn't have a close method
  }
}

// Setup command line arguments
yargs(hideBin(process.argv))
  .command(
    '$0 <query>',
    'Search for a CoinGecko coin ID by symbol or name',
    (yargs) => {
      return yargs
        .positional('query', {
          describe: 'Coin symbol (e.g., BTC) or name fragment (e.g., Fetch)',
          type: 'string',
          demandOption: true,
        });
    },
    async (argv) => {
      const query = argv.query as string;
      await findCoin(query);
    }
  )
  .help()
  .alias('help', 'h')
  .parse(); 