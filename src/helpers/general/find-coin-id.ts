
// This script is used to find the correct CoinGecko ID for a cryptocurrency by symbol or name

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CoinGeckoClient } from '../../general_crypto/fetcher/coingecko-client';
import { RateLimitConfig } from '../../general_crypto/types/crypto';
import { createLogger } from '../../utils/logger';
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
      console.log("Example: npm run analyze-changes bitcoin --days 30");
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
  .scriptName('find-coin-id')
  .command({
    command: '$0 <query>',
    describe: 'Find the correct CoinGecko ID for a cryptocurrency by symbol or name',
    builder: (yargs) => {
      return yargs
        .positional('query', {
          describe: 'Cryptocurrency symbol (e.g., BTC, ETH) or name (e.g., Bitcoin, Ethereum)',
          type: 'string',
          demandOption: true,
        })
        .example('npm run find-coin-id BTC', 'Find cryptocurrencies with BTC symbol')
        .example('npm run find-coin-id bitcoin', 'Find cryptocurrencies with "bitcoin" in their name or ID')
        .example('npm run find-coin-id sol', 'Find Solana and other cryptocurrencies matching "sol"')
        .epilogue(
          'This utility helps you find the correct CoinGecko ID for use with the analyze-changes tool.\n' +
          'Once you find the correct ID, use it with:\n' +
          '  npm run analyze-changes <coin-id> [--days <number>]'
        );
    },
    handler: async (argv) => {
      const query = argv.query as string;
      await findCoin(query);
    }
  })
  .fail((msg, err, yargs) => {
    if (msg) {
      console.error('\nError:', msg);
      console.error('\nSearch for a CoinGecko coin ID by symbol or name: BTC, FET, binancecoin, etc.');
      console.error('Example: npm run find-coin-id BTC');
      console.error('Example: npm run find-coin-id ethereum\n');
    }
    if (err) logger.error(err);
    process.exit(1);
  })
  .help()
  .alias('help', 'h')
  .parse();