// Protocol-specific staking types and configurations

export interface StakingInput {
  amount: number;
  tokenSymbol: string;
  durationDays: number;
  stakingType: 'native' | 'liquid' | 'defi';
  protocol?: string;
}

export interface StakingReport {
  input: StakingInput;
  returns: {
    estimatedApy: number;
    projectedReturns: number;
    usdValue: number;
    tokenAmount: number;
  };
  risks: string[];
  stakingDetails: {
    unstakingPeriod?: number;
    minimumStake?: number;
    protocolInfo?: string;
  };
}

export interface StakingProtocolInfo {
  name: string;
  type: 'native' | 'liquid' | 'defi';
  apy: number;
  minimumStake: number;
  unstakingPeriod: number;
  exchangeRate?: number;  // Exchange rate for liquid staking tokens (e.g., mSOL/SOL)
  risks: string[];
}

// Protocol configurations
export const STAKING_PROTOCOLS: Record<string, Record<string, StakingProtocolInfo>> = {
  'SOL': {
    'native': {
      name: 'Solana Native Staking',
      type: 'native',
      apy: 6.5, // Example APY, will be fetched from network
      minimumStake: 1,
      unstakingPeriod: 2, // days
      risks: [
        'Validator performance impact',
        'Network stability',
        'Unstaking period lock'
      ]
    },
    'marinade': {
      name: 'Marinade Finance',
      type: 'liquid',
      apy: 6.8,
      minimumStake: 0.1,
      unstakingPeriod: 0,
      risks: [
        'Smart contract risk',
        'Protocol risk',
        'Market liquidity risk'
      ]
    }
  },
  'ETH': {
    'native': {
      name: 'Ethereum Beacon Chain',
      type: 'native',
      apy: 4.5,
      minimumStake: 32,
      unstakingPeriod: 0,
      risks: [
        'Network upgrade risks',
        'Technical complexity',
        'Validator duties'
      ]
    },
    'lido': {
      name: 'Lido Finance',
      type: 'liquid',
      apy: 4.8,
      minimumStake: 0.01,
      unstakingPeriod: 0,
      risks: [
        'Smart contract risk',
        'Protocol risk',
        'Market liquidity risk'
      ]
    }
  }
}; 