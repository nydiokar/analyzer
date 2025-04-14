# Crypto Staking Calculator Script

## Task Requirements
- [x] Calculate potential returns from any crypto token staking/yield-farming
- [x] Generate summary report of results
- [x] Create verifiable, testable output
- [x] Support future monetization potential

## Script Structure

### Input
```typescript
interface StakingInput {
  amount: number;         // Amount of tokens to stake
  tokenSymbol: string;    // Token symbol (e.g., 'SOL', 'ETH', 'DOT')
  durationDays: number;   // Investment period
  stakingType: 'native' | 'liquid' | 'defi'; // Staking method
  protocol?: string;      // Optional protocol name for liquid/defi staking
}
```

### Output
```typescript
interface StakingReport {
  input: StakingInput;
  returns: {
    estimatedApy: number;
    projectedReturns: number;
    usdValue: number;
    tokenAmount: number;
  };
  risks: string[];
  stakingDetails: {
    unstakingPeriod?: number;  // in days
    minimumStake?: number;
    protocolInfo?: string;
  };
}
```

## Implementation Steps

1. Basic Script (`src/scripts/staking-calc.ts`)
   - Single file implementation
   - Command line interface
   - Token-agnostic configuration

2. Data Sources
   - Token price: CoinGecko API
   - Staking APY: Chain-specific RPC or API
   - Protocol rates: DeFi protocol APIs

3. Verification Points
   - Input validation
   - Calculation accuracy
   - Report generation
   - Error handling

## Usage Example
```bash
# Run calculation (Example with Solana)
npm run calc-staking -- --token SOL --amount 100 --days 365 --type native

# Example with other tokens
npm run calc-staking -- --token ETH --amount 10 --days 180 --type liquid --protocol lido

# Expected output:
=== Staking Report for [TOKEN] ===
Input:
  Token: [TOKEN]
  Amount: XX.XX
  Duration: XXX days
  Type: [Staking Type]
  Protocol: [If applicable]

Projected Returns:
  Current Price: $XX.XX
  Estimated APY: X.XX%
  Expected Return: XX.XX [TOKEN]
  USD Value: $X,XXX.XX

Risk Assessment:
  - Protocol-specific risks
  - Price volatility consideration
  - Unstaking period details
```

## Testing Verification
1. Test script with known values
2. Compare against actual staking calculators
3. Verify price data accuracy
4. Check edge cases (min/max values)

## Future Extensions
- Support for more tokens and protocols
- Enhanced reporting options
- API endpoint wrapper
- Web interface

## Success Criteria
- [x] Script runs successfully with any supported token
- [x] Calculations match real-world rates
- [x] Report is clear and actionable
- [x] Code is well-documented
- [x] Tests verify functionality

## Example Implementations
1. Solana (SOL)
   - Native staking via validators
   - Liquid staking via Marinade/Lido

2. Ethereum (ETH)
   - Beacon chain staking
   - Liquid staking via Lido/Rocket Pool

3. Polkadot (DOT)
   - Nominated proof of stake
   - Liquid staking options 