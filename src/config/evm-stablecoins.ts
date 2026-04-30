// EVM stablecoin addresses by chain (all lowercase for normalization)
export const STABLECOINS_BY_CHAIN: Record<string, Record<string, { name: string; decimals: number }>> = {
  solana: {
    'epjfwdd5aufqssqem2qn1xzybapC8g4weggkzwytdt1v': { name: 'USDC', decimals: 6 },
    'es9vmfrzacermmjfrf4h2fyd4kconky11mccce8benwnyb': { name: 'USDT', decimals: 6 },
    'usd1ttgy1n17neehllmeoaybftrbuserhqyiqzvemub': { name: 'USD1', decimals: 6 },
  },
  ethereum: {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USDC', decimals: 6 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'USDT', decimals: 6 },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'DAI', decimals: 18 },
    '0x4fabb145d64652a948d72533023f6e7a623c7c53': { name: 'BUSD', decimals: 18 },
    '0x0000000000085d4780b73119b644ae5ecd22b376': { name: 'TUSD', decimals: 18 },
    '0x8e870d67f660d95d5be530380d0ec0bd388289e1': { name: 'USDP', decimals: 18 },
  },
  arbitrum: {
    '0xff970a61a04b1ca14834a43f5de4533ebddb5f86': { name: 'USDC.e', decimals: 6 },
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { name: 'USDC', decimals: 6 },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { name: 'USDT', decimals: 6 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'DAI', decimals: 18 },
  },
  base: {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { name: 'USDC', decimals: 6 },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { name: 'DAI', decimals: 18 },
  },
};

export function isStablecoin(tokenAddress: string, chain: string): boolean {
  const chainMap = STABLECOINS_BY_CHAIN[chain];
  if (!chainMap) return false;
  return !!chainMap[tokenAddress.toLowerCase()];
}

export function getStablecoinInfo(tokenAddress: string, chain: string) {
  const chainMap = STABLECOINS_BY_CHAIN[chain];
  if (!chainMap) return undefined;
  return chainMap[tokenAddress.toLowerCase()];
}

export function getStablecoinAddresses(chain: string): string[] {
  return Object.keys(STABLECOINS_BY_CHAIN[chain] ?? {});
}
