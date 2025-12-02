/**
 * Script to fetch and analyze SPL token metadata onchain
 * 
 * This script fetches:
 * 1. Mint account info (to check mint authority status)
 * 2. Metaplex metadata account (to check update authority and isMutable flag)
 * 3. Transaction details from the mint transaction
 * 
 * Usage:
 * npx ts-node src/scripts/fetch-token-metadata.ts --mint <MINT_ADDRESS> [--tx <TX_SIGNATURE>]
 */

import * as dotenv from 'dotenv';
import * as https from 'https';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config();

interface MintAccountInfo {
  mintAuthority: string | null;
  supply: string;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: string | null;
}

interface MetaplexMetadata {
  key: number;
  updateAuthority: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  creators: Array<{ address: string; verified: boolean; share: number }> | null;
  primarySaleHappened: boolean;
  isMutable: boolean;
  editionNonce: number | null;
  tokenStandard: number | null;
  collection: { verified: boolean; key: string } | null;
  uses: any | null;
}

interface TokenMetadataAnalysis {
  mint: string;
  mintAccount: MintAccountInfo;
  metaplexMetadata: MetaplexMetadata | null;
  metadataUri: string | null;
  externalMetadata: any | null;
  analysis: {
    isMintAuthorityRevoked: boolean;
    isFreezeAuthorityRevoked: boolean;
    isUpdateAuthorityRevoked: boolean;
    isMutable: boolean;
    isFullyImmutable: boolean;
  };
}

class TokenMetadataFetcher {
  private apiKey: string;
  private rpcUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }

  /**
   * Make an RPC request to Helius
   */
  private async makeRpcRequest<T>(method: string, params: any[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      });

      const url = new URL(this.rpcUrl);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`RPC Error: ${JSON.stringify(parsed.error)}`));
            } else {
              resolve(parsed.result);
            }
          } catch (e) {
            reject(new Error(`Failed to parse RPC response: ${e}`));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`Request failed: ${e.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Derive the Metaplex metadata PDA from a mint address
   */
  private deriveMetadataPDA(mintAddress: string): string {
    // This is a simplified version - for production, use @solana/web3.js PublicKey.findProgramAddress
    // Metaplex metadata program: metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
    // For now, we'll fetch it using the DAS API which is easier
    return mintAddress; // Placeholder - we'll use DAS API instead
  }

  /**
   * Fetch mint account info using getAccountInfo
   */
  async fetchMintAccount(mintAddress: string): Promise<MintAccountInfo> {
    console.log(`\n📋 Fetching mint account info for: ${mintAddress}`);
    
    const result = await this.makeRpcRequest<any>('getAccountInfo', [
      mintAddress,
      {
        encoding: 'jsonParsed',
        commitment: 'confirmed',
      },
    ]);

    if (!result || !result.value) {
      throw new Error('Mint account not found');
    }

    const mintInfo = result.value.data.parsed.info;
    
    return {
      mintAuthority: mintInfo.mintAuthority,
      supply: mintInfo.supply,
      decimals: mintInfo.decimals,
      isInitialized: mintInfo.isInitialized,
      freezeAuthority: mintInfo.freezeAuthority,
    };
  }

  /**
   * Fetch Metaplex metadata using Helius DAS API
   */
  async fetchMetaplexMetadata(mintAddress: string): Promise<MetaplexMetadata | null> {
    console.log(`\n📦 Fetching Metaplex metadata for: ${mintAddress}`);
    
    try {
      // Use Helius DAS (Digital Asset Standard) API to get metadata
      const result = await this.makeRpcRequest<any>('getAsset', [mintAddress]);
      
      if (!result) {
        console.log('⚠️  No metadata found via DAS API, trying direct metadata account fetch...');
        return await this.fetchMetaplexMetadataDirect(mintAddress);
      }

      // Extract metadata from DAS response
      const metadata: MetaplexMetadata = {
        key: 4, // Metadata V1
        updateAuthority: result.authorities?.[0]?.address || 'Unknown',
        mint: mintAddress,
        name: result.content?.metadata?.name || '',
        symbol: result.content?.metadata?.symbol || '',
        uri: result.content?.json_uri || '',
        sellerFeeBasisPoints: result.royalty?.basis_points || 0,
        creators: result.creators || null,
        primarySaleHappened: result.royalty?.primary_sale_happened || false,
        isMutable: result.mutable || false,
        editionNonce: null,
        tokenStandard: result.token_info?.token_standard ? parseInt(result.token_info.token_standard) : null,
        collection: result.grouping?.find((g: any) => g.group_key === 'collection')?.group_value 
          ? { verified: true, key: result.grouping.find((g: any) => g.group_key === 'collection').group_value }
          : null,
        uses: null,
      };

      return metadata;
    } catch (error: any) {
      console.log(`⚠️  DAS API fetch failed: ${error.message}`);
      return await this.fetchMetaplexMetadataDirect(mintAddress);
    }
  }

  /**
   * Fetch Metaplex metadata directly via RPC (fallback method)
   */
  private async fetchMetaplexMetadataDirect(mintAddress: string): Promise<MetaplexMetadata | null> {
    try {
      // We need to compute the PDA - for simplicity, we'll use a known pattern
      // In production, use @solana/web3.js or @metaplex-foundation/js
      console.log('ℹ️  Direct metadata account fetch not implemented - requires PDA derivation');
      console.log('ℹ️  Consider using @metaplex-foundation/js for full metadata support');
      return null;
    } catch (error) {
      console.error('Failed to fetch metadata directly:', error);
      return null;
    }
  }

  /**
   * Fetch external metadata from URI
   */
  async fetchExternalMetadata(uri: string): Promise<any> {
    if (!uri) return null;
    
    console.log(`\n🌐 Fetching external metadata from: ${uri}`);
    
    return new Promise((resolve) => {
      try {
        const url = new URL(uri);
        const options: https.RequestOptions = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          timeout: 5000,
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              console.log(`⚠️  Failed to parse external metadata: ${e}`);
              resolve(null);
            }
          });
        });

        req.on('error', (e) => {
          console.log(`⚠️  Failed to fetch external metadata: ${e.message}`);
          resolve(null);
        });

        req.on('timeout', () => {
          console.log('⚠️  Request timeout fetching external metadata');
          req.destroy();
          resolve(null);
        });

        req.end();
      } catch (e) {
        console.log(`⚠️  Invalid URI: ${e}`);
        resolve(null);
      }
    });
  }

  /**
   * Fetch transaction details
   */
  async fetchTransaction(signature: string): Promise<any> {
    console.log(`\n🔍 Fetching transaction: ${signature}`);
    
    const result = await this.makeRpcRequest<any>('getTransaction', [
      signature,
      {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      },
    ]);

    return result;
  }

  /**
   * Analyze token metadata comprehensively
   */
  async analyzeToken(mintAddress: string, txSignature?: string): Promise<TokenMetadataAnalysis> {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔬 ANALYZING TOKEN: ${mintAddress}`);
    console.log(`${'='.repeat(80)}`);

    // Fetch mint account
    const mintAccount = await this.fetchMintAccount(mintAddress);

    // Fetch Metaplex metadata
    const metaplexMetadata = await this.fetchMetaplexMetadata(mintAddress);

    // Fetch external metadata if URI exists
    let externalMetadata = null;
    if (metaplexMetadata?.uri) {
      externalMetadata = await this.fetchExternalMetadata(metaplexMetadata.uri);
    }

    // Fetch transaction if provided
    if (txSignature) {
      try {
        const tx = await this.fetchTransaction(txSignature);
        console.log(`\n📄 Transaction fetched - Slot: ${tx?.slot}`);
      } catch (error: any) {
        console.log(`⚠️  Failed to fetch transaction: ${error.message}`);
      }
    }

    // Analyze the results
    const analysis = {
      isMintAuthorityRevoked: mintAccount.mintAuthority === null,
      isFreezeAuthorityRevoked: mintAccount.freezeAuthority === null,
      isUpdateAuthorityRevoked: metaplexMetadata?.updateAuthority === '11111111111111111111111111111111' || 
                                  metaplexMetadata?.updateAuthority === null,
      isMutable: metaplexMetadata?.isMutable ?? true,
      isFullyImmutable: false,
    };

    // A token is fully immutable if:
    // 1. Mint authority is revoked (null)
    // 2. Freeze authority is revoked (null)  
    // 3. Update authority is revoked (set to system program or null)
    // 4. isMutable is false
    analysis.isFullyImmutable = 
      analysis.isMintAuthorityRevoked &&
      analysis.isFreezeAuthorityRevoked &&
      analysis.isUpdateAuthorityRevoked &&
      !analysis.isMutable;

    return {
      mint: mintAddress,
      mintAccount,
      metaplexMetadata,
      metadataUri: metaplexMetadata?.uri || null,
      externalMetadata,
      analysis,
    };
  }

  /**
   * Print analysis results in a readable format
   */
  printAnalysis(analysis: TokenMetadataAnalysis): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 ANALYSIS RESULTS`);
    console.log(`${'='.repeat(80)}`);

    console.log(`\n🪙 MINT ACCOUNT:`);
    console.log(`  └─ Mint Address: ${analysis.mint}`);
    console.log(`  └─ Decimals: ${analysis.mintAccount.decimals}`);
    console.log(`  └─ Supply: ${analysis.mintAccount.supply}`);
    console.log(`  └─ Mint Authority: ${analysis.mintAccount.mintAuthority || '❌ REVOKED'}`);
    console.log(`  └─ Freeze Authority: ${analysis.mintAccount.freezeAuthority || '❌ REVOKED'}`);

    if (analysis.metaplexMetadata) {
      console.log(`\n📦 METAPLEX METADATA:`);
      console.log(`  └─ Name: ${analysis.metaplexMetadata.name}`);
      console.log(`  └─ Symbol: ${analysis.metaplexMetadata.symbol}`);
      console.log(`  └─ Update Authority: ${analysis.metaplexMetadata.updateAuthority}`);
      console.log(`  └─ Is Mutable: ${analysis.metaplexMetadata.isMutable ? '✅ TRUE' : '❌ FALSE'}`);
      console.log(`  └─ URI: ${analysis.metaplexMetadata.uri}`);
      
      if (analysis.metaplexMetadata.creators) {
        console.log(`  └─ Creators:`);
        analysis.metaplexMetadata.creators.forEach((creator, idx) => {
          console.log(`      ${idx + 1}. ${creator.address} (${creator.share}%, ${creator.verified ? 'verified' : 'unverified'})`);
        });
      }
    }

    if (analysis.externalMetadata) {
      console.log(`\n🌐 EXTERNAL METADATA (from URI):`);
      console.log(`  └─ Name: ${analysis.externalMetadata.name || 'N/A'}`);
      console.log(`  └─ Description: ${analysis.externalMetadata.description || 'N/A'}`);
      console.log(`  └─ Image: ${analysis.externalMetadata.image || 'N/A'}`);
      
      // Check for social links in multiple possible locations
      const hasSocialLinks = 
        analysis.externalMetadata.twitter ||
        analysis.externalMetadata.website ||
        analysis.externalMetadata.telegram ||
        analysis.externalMetadata.discord ||
        analysis.externalMetadata.properties?.links;

      if (hasSocialLinks) {
        console.log(`  └─ Social Links (set at creation):`);
        
        // Direct links (pump.fun style)
        if (analysis.externalMetadata.twitter) {
          console.log(`      • Twitter: ${analysis.externalMetadata.twitter}`);
        }
        if (analysis.externalMetadata.website) {
          console.log(`      • Website: ${analysis.externalMetadata.website}`);
        }
        if (analysis.externalMetadata.telegram) {
          console.log(`      • Telegram: ${analysis.externalMetadata.telegram}`);
        }
        if (analysis.externalMetadata.discord) {
          console.log(`      • Discord: ${analysis.externalMetadata.discord}`);
        }
        
        // Nested links (standard Metaplex style)
        if (analysis.externalMetadata.properties?.links) {
          const links = analysis.externalMetadata.properties.links;
          if (links.twitter) console.log(`      • Twitter: ${links.twitter}`);
          if (links.website) console.log(`      • Website: ${links.website}`);
          if (links.telegram) console.log(`      • Telegram: ${links.telegram}`);
          if (links.discord) console.log(`      • Discord: ${links.discord}`);
        }
      } else {
        console.log(`  └─ Social Links: ❌ None found`);
      }

      if (analysis.externalMetadata.external_url) {
        console.log(`  └─ External URL: ${analysis.externalMetadata.external_url}`);
      }
      
      if (analysis.externalMetadata.createdOn) {
        console.log(`  └─ Created On: ${analysis.externalMetadata.createdOn}`);
      }
    }

    console.log(`\n🔒 IMMUTABILITY ANALYSIS:`);
    console.log(`  └─ Mint Authority Revoked: ${analysis.analysis.isMintAuthorityRevoked ? '✅ YES' : '❌ NO'}`);
    console.log(`  └─ Freeze Authority Revoked: ${analysis.analysis.isFreezeAuthorityRevoked ? '✅ YES' : '❌ NO'}`);
    console.log(`  └─ Update Authority Revoked: ${analysis.analysis.isUpdateAuthorityRevoked ? '✅ YES' : '❌ NO'}`);
    console.log(`  └─ Is Mutable: ${analysis.analysis.isMutable ? '⚠️  TRUE (can be changed)' : '✅ FALSE (locked)'}`);
    console.log(`  └─ Fully Immutable: ${analysis.analysis.isFullyImmutable ? '✅ YES' : '❌ NO'}`);

    console.log(`\n💡 INTERPRETATION:`);
    if (analysis.analysis.isFullyImmutable) {
      console.log(`  ✅ This token is FULLY IMMUTABLE - all authorities revoked and metadata locked.`);
    } else {
      console.log(`  ⚠️  This token is NOT fully immutable:`);
      if (!analysis.analysis.isMintAuthorityRevoked) {
        console.log(`      • Mint authority can still create new tokens`);
      }
      if (!analysis.analysis.isFreezeAuthorityRevoked) {
        console.log(`      • Freeze authority can still freeze token accounts`);
      }
      if (!analysis.analysis.isUpdateAuthorityRevoked) {
        console.log(`      • Update authority can still modify metadata`);
      }
      if (analysis.analysis.isMutable) {
        console.log(`      • Metadata is mutable and can be changed`);
      }
    }

    console.log(`\n${'='.repeat(80)}\n`);
  }
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('mint', {
      alias: 'm',
      type: 'string',
      description: 'Token mint address to analyze',
      demandOption: true,
    })
    .option('tx', {
      alias: 't',
      type: 'string',
      description: 'Optional: Transaction signature to analyze',
    })
    .help()
    .argv;

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: HELIUS_API_KEY not found in .env file');
    process.exit(1);
  }

  const fetcher = new TokenMetadataFetcher(apiKey);
  
  try {
    const analysis = await fetcher.analyzeToken(argv.mint, argv.tx);
    fetcher.printAnalysis(analysis);

    // Also save to file for reference
    const fs = await import('fs/promises');
    const outputFile = `debug_output/token_metadata_${argv.mint}.json`;
    await fs.writeFile(outputFile, JSON.stringify(analysis, null, 2));
    console.log(`💾 Full analysis saved to: ${outputFile}\n`);

  } catch (error: any) {
    console.error(`\n❌ Error analyzing token: ${error.message}`);
    process.exit(1);
  }
}

main();

