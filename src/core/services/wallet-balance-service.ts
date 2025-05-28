import { HeliusApiClient } from 'core/services/helius-api-client';
import { TokenBalanceDetails, WalletBalance } from '@/types/wallet';
import { GetMultipleAccountsResult, GetTokenAccountsByOwnerResult, RpcAccountInfo, TokenAccount } from '@/types/helius-api';
import { createLogger } from 'core/utils/logger';
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../../config/constants';

const logger = createLogger('WalletBalanceService');
const SOL_DECIMALS = 9;
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112'; // For reference, not used in SOL balance fetch

export class WalletBalanceService {
  private heliusClient: HeliusApiClient;

  constructor(heliusClient: HeliusApiClient) {
    this.heliusClient = heliusClient;
  }

  /**
   * Fetches the SOL and SPL token balances for a list of wallet addresses.
   * Batches requests to getMultipleAccounts if more than 100 wallet addresses are provided.
   * @param walletAddresses An array of public key strings for the wallets.
   * @param commitment Optional commitment level for RPC calls.
   * @returns A Promise resolving to a Map where keys are wallet addresses and values are WalletBalance objects.
   */
  public async fetchWalletBalances(
    walletAddresses: string[],
    commitment?: string
  ): Promise<Map<string, WalletBalance>> {
    if (!walletAddresses || walletAddresses.length === 0) {
      return new Map();
    }

    logger.info(`Fetching wallet balances for ${walletAddresses.length} addresses. Commitment: ${commitment || 'default'}`);
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
        logger.debug(`Fetching token balances for address: ${address} for SPL Token and Token-2022 programs.`);
        
        // Fetch for standard SPL Token Program
        const splTokenAccountsResult: GetTokenAccountsByOwnerResult = await this.heliusClient.getTokenAccountsByOwner(
          address,
          undefined, // No specific mint, fetch all tokens
          SPL_TOKEN_PROGRAM_ID, // Standard SPL Token Program ID
          commitment,
          'jsonParsed' // Crucial for getting structured token data
        );

        // Fetch for Token-2022 Program
        const token2022AccountsResult: GetTokenAccountsByOwnerResult = await this.heliusClient.getTokenAccountsByOwner(
          address,
          undefined, // No specific mint, fetch all tokens
          TOKEN_2022_PROGRAM_ID, // Token-2022 Program ID
          commitment,
          'jsonParsed'
        );

        const combinedTokenAccounts: TokenAccount[] = [];
        if (splTokenAccountsResult && splTokenAccountsResult.value) {
          combinedTokenAccounts.push(...splTokenAccountsResult.value);
        }
        if (token2022AccountsResult && token2022AccountsResult.value) {
          combinedTokenAccounts.push(...token2022AccountsResult.value);
        }
        
        logger.debug(`Address ${address}: Found ${splTokenAccountsResult?.value?.length || 0} SPL accounts and ${token2022AccountsResult?.value?.length || 0} Token-2022 accounts. Total: ${combinedTokenAccounts.length}`);

        const tokenBalances: TokenBalanceDetails[] = [];
        if (combinedTokenAccounts.length > 0) {
          combinedTokenAccounts.forEach((tokenAccount: TokenAccount) => {
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
                    uiBalanceString: parsedInfo.tokenAmount.uiAmountString,
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

    logger.info(`Successfully processed wallet balance fetching for ${walletAddresses.length} addresses.`);
    return walletBalances;
  }
} 