import { ApiProperty } from '@nestjs/swagger';

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
}

export class TopHoldersResponseDto {
  @ApiProperty()
  mint: string;

  @ApiProperty({ type: () => Object })
  context: { slot: number; apiVersion?: string };

  @ApiProperty({ type: () => [TopHolderItemDto] })
  holders: TopHolderItemDto[];
}


