export interface DexInfo {
  name: string;
  type: 'uniswap-v2' | 'uniswap-v3' | 'curve' | 'balancer' | 'zero-x' | 'other';
  feeBps?: number; // basis points
}

// All addresses lowercase for normalization
export const DEX_PROGRAMS_BY_CHAIN: Record<string, Record<string, DexInfo>> = {
  ethereum: {
    // Uniswap V2
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'UniswapV2Router02', type: 'uniswap-v2', feeBps: 30 },
    // Uniswap V3
    '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'UniswapV3SwapRouter', type: 'uniswap-v3', feeBps: 30 },
    '0x68b3465833fb72b5a828ccebea90d26f202d94c2': { name: 'UniswapV3SwapRouter02', type: 'uniswap-v3', feeBps: 30 },
    '0x000000000004444c5dc75cb358380d2e3de08a90': { name: 'UniswapV4UniversalRouter', type: 'uniswap-v3', feeBps: 30 },
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'UniswapUniversalRouter', type: 'uniswap-v3', feeBps: 30 },
    // SushiSwap
    '0xd9e1ce17f2641f24ae83637ab915310313d6f82d': { name: 'SushiSwapRouter', type: 'uniswap-v2', feeBps: 30 },
    // Curve
    '0x99a58482bd75cbab83b27ec03ca68ff489b5788f': { name: 'CurveRouter', type: 'curve', feeBps: 4 },
    '0xf18056bbd320e96a48e3fbf8bc061322531aac99': { name: 'CurveRouterV2', type: 'curve', feeBps: 4 },
    // 0x Protocol
    '0xdef1c0ded9bacc59751b9ec6c1dcf37075a2c9b6': { name: '0xExchangeProxyV4', type: 'zero-x', feeBps: 0 },
    // Balancer
    '0xba12222222228d8ba445958a75a0704d566bf2c8': { name: 'BalancerV2Vault', type: 'balancer', feeBps: 0 },
    // 1inch
    '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inchV5AggregationRouter', type: 'other', feeBps: 0 },
    '0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inchV6AggregationRouter', type: 'other', feeBps: 0 },
    // Paraswap
    '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': { name: 'ParaswapV5', type: 'other', feeBps: 0 },
    // Cow Protocol
    '0x9008d19f58aabd9ed0d60971565aa8510560ab41': { name: 'CowProtocolSettlement', type: 'other', feeBps: 0 },
  },
  arbitrum: {
    // Uniswap V3
    '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'UniswapV3SwapRouter', type: 'uniswap-v3', feeBps: 30 },
    '0x68b3465833fb72b5a828ccebea90d26f202d94c2': { name: 'UniswapV3SwapRouter02', type: 'uniswap-v3', feeBps: 30 },
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'UniswapUniversalRouter', type: 'uniswap-v3', feeBps: 30 },
    // SushiSwap
    '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506': { name: 'SushiSwapRouter', type: 'uniswap-v2', feeBps: 30 },
    // Camelot (Arbitrum-native)
    '0xc873fecbd354f5a56e00e710b90ef4201db2448d': { name: 'CamelotRouter', type: 'uniswap-v2', feeBps: 30 },
    // 0x Protocol
    '0xdef1c0ded9bacc59751b9ec6c1dcf37075a2c9b6': { name: '0xExchangeProxyV4', type: 'zero-x', feeBps: 0 },
    // Balancer
    '0xba12222222228d8ba445958a75a0704d566bf2c8': { name: 'BalancerV2Vault', type: 'balancer', feeBps: 0 },
    // 1inch
    '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inchV5AggregationRouter', type: 'other', feeBps: 0 },
    '0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inchV6AggregationRouter', type: 'other', feeBps: 0 },
  },
  base: {
    // Uniswap V3
    '0x2626664c2603336e57b271c5c0b26f421741e481': { name: 'UniswapV3SwapRouter02', type: 'uniswap-v3', feeBps: 30 },
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'UniswapUniversalRouter', type: 'uniswap-v3', feeBps: 30 },
    // Aerodrome (Base-native)
    '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43': { name: 'AerodromeRouter', type: 'uniswap-v2', feeBps: 5 },
    // 1inch
    '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inchV5AggregationRouter', type: 'other', feeBps: 0 },
    '0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inchV6AggregationRouter', type: 'other', feeBps: 0 },
    // Balancer
    '0xba12222222228d8ba445958a75a0704d566bf2c8': { name: 'BalancerV2Vault', type: 'balancer', feeBps: 0 },
  },
};

export function isDexProgram(address: string, chain: string): boolean {
  const chainMap = DEX_PROGRAMS_BY_CHAIN[chain];
  if (!chainMap) return false;
  return !!chainMap[address.toLowerCase()];
}

export function getDexInfo(address: string, chain: string): DexInfo | undefined {
  const chainMap = DEX_PROGRAMS_BY_CHAIN[chain];
  if (!chainMap) return undefined;
  return chainMap[address.toLowerCase()];
}
