import { EvmChain } from '@/types/evm-api';

export type ChainType = 'solana' | EvmChain;

export function isEvmChain(chain: string): chain is EvmChain {
  return chain === 'ethereum' || chain === 'arbitrum' || chain === 'base';
}

export function isSolanaChain(chain: string): chain is 'solana' {
  return chain === 'solana';
}

/**
 * Determines the ingestion path for a given wallet address.
 * EVM addresses start with '0x'; Solana addresses are base58 (no '0x').
 */
export function detectChainFromAddress(address: string): ChainType {
  if (address.startsWith('0x') && address.length === 42) {
    return 'ethereum'; // Default to ethereum for 0x addresses; caller can override
  }
  return 'solana';
}
