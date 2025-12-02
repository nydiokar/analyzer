/**
 * Price Provider Interface
 * 
 * Abstraction for fetching token and SOL prices from various sources.
 * Implementations can use Dexscreener, Bird.io, CoinGecko, etc.
 * 
 * This interface allows the application to be provider-agnostic,
 * making it easy to switch or add new price data sources.
 */
export interface IPriceProvider {
  /**
   * Fetch the current SOL price in USD.
   * @returns Promise resolving to SOL price in USD
   */
  fetchSolPrice(): Promise<number>;

  /**
   * Fetch prices for multiple tokens in USD.
   * @param tokenMints Array of token mint addresses
   * @returns Promise resolving to a Map of mint address to price in USD
   */
  fetchTokenPrices(tokenMints: string[]): Promise<Map<string, number>>;

  /**
   * Fetch and save detailed token information (metadata + prices) to database.
   * This is used for enrichment operations.
   * @param tokenAddresses Array of token addresses to enrich
   */
  fetchAndSaveTokenInfo(tokenAddresses: string[]): Promise<void>;
}

