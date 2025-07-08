import { HeliusApiClient } from './helius-api-client';
import { TokenBalanceDetails, WalletBalance } from '@/types/wallet';
import { GetMultipleAccountsResult, GetTokenAccountsByOwnerResult, TokenAccount } from '@/types/helius-api';
import { createLogger } from 'core/utils/logger';
import { SPL_TOKEN_PROGRAM_ID } from '../../config/constants';
import { formatLargeNumber } from 'core/utils/number-formatting';
import { TokenInfoService } from '../../api/token-info/token-info.service';
import { TokenInfo } from '@prisma/client';

const logger = createLogger('WalletBalanceService');
const SOL_DECIMALS = 9;

/**
 * Service for fetching LIVE, on-chain SOL and SPL token balances.
 * This is the primary tool for any feature needing an immediate, real-time
 * snapshot of a wallet's current holdings.
 */
export class WalletBalanceService {
  private heliusClient: HeliusApiClient;
  private tokenInfoService?: TokenInfoService;

  /**
   * Constructs an instance of the WalletBalanceService.
   *
   * @param heliusClient An instance of HeliusApiClient to use for RPC calls.
   * @param tokenInfoService An instance of TokenInfoService to fetch token metadata.
   */
  constructor(
    heliusClient: HeliusApiClient,
    tokenInfoService?: TokenInfoService
  ) {
    this.heliusClient = heliusClient;
    this.tokenInfoService = tokenInfoService;
  }

  /**
   * Fetches the SOL and SPL token balances for a list of wallet addresses WITHOUT token metadata.
   * This is optimized for speed and should be used when you need raw balances quickly.
   * Use enrichWalletBalancesWithMetadata() separately if you need token metadata.
   *
   * @param walletAddresses An array of public key strings for the wallets.
   * @param commitment Optional. The commitment level to use for RPC calls (e.g., "finalized", "confirmed").
   * @returns A Promise resolving to a Map where keys are wallet addresses (string) and values are `WalletBalance` objects.
   *          Each `WalletBalance` object contains the SOL balance, an array of token balances (without metadata), and the timestamp when balances were fetched.
   *          If a wallet address cannot be processed, its entry might have default/zero balances.
   */
  public async fetchWalletBalancesRaw(
    walletAddresses: string[],
    commitment?: string
  ): Promise<Map<string, WalletBalance>> {
    if (!walletAddresses || walletAddresses.length === 0) {
      return new Map();
    }

    logger.info(`Fetching RAW wallet balances for ${walletAddresses.length} addresses. Commitment: ${commitment || 'default'}`);
    const walletBalances = new Map<string, WalletBalance>();
    const fetchedAt = new Date();

    // Initialize WalletBalance for all requested addresses to ensure all are present in the map
    for (const address of walletAddresses) {
      walletBalances.set(address, {
        solBalance: 0, // Default to 0, will be updated
        tokenBalances: [],
        fetchedAt: fetchedAt,
      });
    }

    // 1. Fetch SOL balances using getMultipleAccounts (batched)
    const batchSize = 100; // Max 100 pubkeys per getMultipleAccounts call
    for (let i = 0; i < walletAddresses.length; i += batchSize) {
      const batchAddresses = walletAddresses.slice(i, i + batchSize);
      try {
        logger.debug(`Fetching SOL balances for batch of ${batchAddresses.length} addresses (offset ${i}).`);
        const solBalancesResult: GetMultipleAccountsResult = await this.heliusClient.getMultipleAccounts(
          batchAddresses,
          commitment,
          'base64' // SOL balance is fine with base64
        );

        solBalancesResult.value.forEach((accountInfo, index) => {
          const address = batchAddresses[index];
          if (accountInfo) {
            const solBalance = accountInfo.lamports / Math.pow(10, SOL_DECIMALS);
            const existingBalance = walletBalances.get(address);
            if (existingBalance) {
              existingBalance.solBalance = solBalance;
            } else {
              walletBalances.set(address, {
                solBalance,
                tokenBalances: [],
                fetchedAt,
              });
            }
          } else {
            logger.warn(`No SOL balance account info found for address: ${address} in batch.`);
          }
        });
      } catch (error: any) {
        logger.error(`Error fetching SOL balances for batch (offset ${i}, ${batchAddresses.length} addresses): ${error.message || error}`);
        // For addresses in this failed batch, SOL balance will remain 0 or its default.
      }
    }

    // 2. Fetch SPL Token balances for each wallet using getTokenAccountsByOwner
    // This is done sequentially per wallet to avoid overwhelming the RPC with many concurrent requests.
    // HeliusApiClient handles internal rate limiting for its methods.
    for (const address of walletAddresses) {
      try {
        // logger.debug(`Fetching token balances for address: ${address} for SPL Token program.`);
        
        // Fetch for standard SPL Token Program
        const splTokenAccountsResult: GetTokenAccountsByOwnerResult = await this.heliusClient.getTokenAccountsByOwner(
          address,
          undefined, // No specific mint, fetch all tokens
          SPL_TOKEN_PROGRAM_ID, // Standard SPL Token Program ID
          commitment,
          'jsonParsed' // Crucial for getting structured token data
        );

        const currentTokenAccounts: TokenAccount[] = [];
        if (splTokenAccountsResult && splTokenAccountsResult.value) {
          currentTokenAccounts.push(...splTokenAccountsResult.value);
        }
        
        logger.debug(`Address ${address}: Found ${currentTokenAccounts.length} SPL accounts.`);

        const tokenBalances: TokenBalanceDetails[] = [];
        if (currentTokenAccounts.length > 0) {
          currentTokenAccounts.forEach((tokenAccount: TokenAccount) => {
            // Type guard to ensure data is parsed as expected
            const accountData = tokenAccount.account.data;
            if (typeof accountData !== 'string' && !Array.isArray(accountData) && accountData.parsed) {
                const parsedInfo = accountData.parsed.info;
                if (parsedInfo && parsedInfo.tokenAmount) {
                    tokenBalances.push({
                    mint: parsedInfo.mint,
                    tokenAccountAddress: tokenAccount.pubkey,
                    balance: parsedInfo.tokenAmount.amount,
                    decimals: parsedInfo.tokenAmount.decimals,
                    uiBalance: parsedInfo.tokenAmount.uiAmount,
                    uiBalanceString: formatLargeNumber(parsedInfo.tokenAmount.uiAmount),
                    });
                } else {
                    logger.warn(`Token account ${tokenAccount.pubkey} for owner ${address} has parsed data but missing tokenAmount or info.`);
                }
            } else {
                logger.warn(`Token account ${tokenAccount.pubkey} for owner ${address} does not have jsonParsed data as expected. Encoding might have been incorrect or account is not a standard token account.`);
            }
          });
        }

        const existingBalance = walletBalances.get(address);
        if (existingBalance) {
          existingBalance.tokenBalances = tokenBalances;
        } else {
          logger.warn(`Wallet balance for ${address} was not pre-initialized for token balances. This is unexpected.`);
          walletBalances.set(address, {
            solBalance: 0, 
            tokenBalances,
            fetchedAt,
          });
        }
      } catch (error: any) {
        logger.error(`Error fetching token balances for address ${address}: ${error.message || error}`);
        // Token balances for this address will remain empty or its default.
      }
    }

    logger.info(`Successfully processed RAW wallet balance fetching for ${walletAddresses.length} addresses (no metadata).`);
    return walletBalances;
  }

  /**
   * Enriches existing wallet balances with token metadata.
   * This method takes raw balances and adds name, symbol, and imageUrl metadata.
   * 
   * @param walletBalances The raw wallet balances to enrich
   * @returns The enriched wallet balances with metadata
   */
  public async enrichWalletBalancesWithMetadata(
    walletBalances: Map<string, WalletBalance>
  ): Promise<Map<string, WalletBalance>> {
    if (!this.tokenInfoService) {
      logger.warn('TokenInfoService not available, returning balances without metadata enrichment');
      return walletBalances;
    }

    const allMints = Array.from(walletBalances.values()).flatMap(data => data.tokenBalances.map(t => t.mint));
    const uniqueMints = [...new Set(allMints)];
    
    if (uniqueMints.length === 0) {
      logger.debug('No tokens found to enrich with metadata');
      return walletBalances;
    }

    logger.info(`Enriching ${uniqueMints.length} unique tokens with metadata`);
    
    const tokenInfos = await this.tokenInfoService.findMany(uniqueMints);
    const tokenInfoMap = new Map(tokenInfos.map(info => [info.tokenAddress, info]));

    const enrichedBalances = new Map<string, WalletBalance>();
    
    for (const [address, data] of walletBalances.entries()) {
      const tokenBalancesWithMetadata = data.tokenBalances.map(token => {
        const metadata = tokenInfoMap.get(token.mint);
        return {
          ...token,
          name: metadata?.name,
          symbol: metadata?.symbol,
          imageUrl: metadata?.imageUrl,
        };
      });

      enrichedBalances.set(address, {
        solBalance: data.solBalance,
        tokenBalances: tokenBalancesWithMetadata,
        fetchedAt: new Date(),
      });
    }

    logger.info(`Successfully enriched wallet balances with metadata for ${enrichedBalances.size} wallets`);
    return enrichedBalances;
  }

  /**
   * Fetches the SOL and SPL token balances for a list of wallet addresses WITH token metadata.
   * This method combines fetchWalletBalancesRaw() + enrichWalletBalancesWithMetadata().
   * Use fetchWalletBalancesRaw() for faster initial results, then enrich separately if needed.
   *
   * @param walletAddresses An array of public key strings for the wallets.
   * @param commitment Optional. The commitment level to use for RPC calls (e.g., "finalized", "confirmed").
   * @returns A Promise resolving to a Map where keys are wallet addresses (string) and values are `WalletBalance` objects.
   *          Each `WalletBalance` object contains the SOL balance, an array of token balances, and the timestamp when balances were fetched.
   *          If a wallet address cannot be processed, its entry might have default/zero balances.
   */
  public async fetchWalletBalances(
    walletAddresses: string[],
    commitment?: string
  ): Promise<Map<string, WalletBalance>> {
    const rawBalances = await this.fetchWalletBalancesRaw(walletAddresses, commitment);
    return await this.enrichWalletBalancesWithMetadata(rawBalances);
  }
} 