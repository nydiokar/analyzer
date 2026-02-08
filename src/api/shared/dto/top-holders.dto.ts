import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopHolderItemDto {
  @ApiProperty()
  tokenAccount: string;

  @ApiProperty({ required: false, nullable: true })
  ownerAccount?: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  decimals: number;

  @ApiProperty({ nullable: true })
  uiAmount: number | null;

  @ApiProperty()
  uiAmountString: string;

  @ApiProperty()
  rank: number;

  @ApiPropertyOptional({
    description: 'Known wallet type from registry (e.g., BURN, LP, JUPITER)',
    enum: ['BURN', 'LP', 'RAYDIUM', 'ORCA', 'JUPITER', 'PROTOCOL', 'EXCHANGE', 'SYSTEM'],
  })
  knownType?: string;

  @ApiPropertyOptional({
    description: 'Display label for known wallets (e.g., "🔥 Burn Address")',
  })
  knownLabel?: string;
}

export class TopHoldersResponseDto {
  @ApiProperty()
  mint: string;

  @ApiProperty({ type: () => Object })
  context: { slot: number; apiVersion?: string };

  @ApiProperty({ type: () => [TopHolderItemDto] })
  holders: TopHolderItemDto[];

  @ApiPropertyOptional({
    type: () => Object,
    description: 'Token supply information for percentage calculations'
  })
  supply?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}


