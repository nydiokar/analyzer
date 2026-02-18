import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';

export class CreateHuntDto {
  @ApiProperty({ description: 'Name for the hunt', example: 'TG Caller Alpha' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class AddSnapshotDto {
  @ApiProperty({ description: 'Token mint address', example: 'So11111111111111111111111111111111111111112' })
  @IsString()
  @IsNotEmpty()
  tokenMint: string;

  @ApiProperty({ description: 'Source type for wallet fetching', enum: ['TOP_HOLDERS'] })
  @IsString()
  @IsIn(['TOP_HOLDERS'])
  sourceType: 'TOP_HOLDERS';

  @ApiPropertyOptional({ description: 'Optional note about this snapshot', example: 'Posted at 3pm in TG' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class HuntListItemDto {
  @ApiProperty({ description: 'Hunt ID' })
  id: string;

  @ApiProperty({ description: 'Hunt name' })
  name: string;

  @ApiProperty({ description: 'Number of snapshots in this hunt' })
  snapshotCount: number;

  @ApiProperty({ description: 'When the hunt was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Last time user viewed this hunt' })
  lastVisitedAt: Date;
}

export class CandidateDto {
  @ApiProperty({ description: 'Candidate wallet address' })
  walletAddress: string;

  @ApiProperty({ description: 'Number of unique tokens this wallet appeared in' })
  appearanceCount: number;

  @ApiProperty({ description: 'Confidence score (appearanceCount / uniqueTokenCount)' })
  confidence: number;

  @ApiProperty({ description: 'Token mints where this wallet appeared', type: [String] })
  tokenMints: string[];

  @ApiProperty({ description: 'Source types that found this wallet', type: [String] })
  sources: string[];
}

export class SnapshotDto {
  @ApiProperty({ description: 'Snapshot ID' })
  id: string;

  @ApiProperty({ description: 'Token mint address' })
  tokenMint: string;

  @ApiProperty({ description: 'Source type' })
  sourceType: string;

  @ApiProperty({ description: 'When the snapshot was captured' })
  capturedAt: Date;

  @ApiProperty({ description: 'Number of holders in this snapshot' })
  holderCount: number;

  @ApiPropertyOptional({ description: 'User note' })
  note?: string;
}

export class HuntDetailDto {
  @ApiProperty({ description: 'Hunt details' })
  hunt: {
    id: string;
    name: string;
    createdAt: Date;
    lastVisitedAt: Date;
  };

  @ApiProperty({ description: 'Snapshots in this hunt', type: [SnapshotDto] })
  snapshots: SnapshotDto[];

  @ApiProperty({ description: 'Computed candidate wallets', type: [CandidateDto] })
  candidates: CandidateDto[];
}

export class AddSnapshotResponseDto {
  @ApiProperty({ description: 'The created snapshot' })
  snapshot: SnapshotDto;

  @ApiProperty({ description: 'Updated candidate wallets', type: [CandidateDto] })
  candidates: CandidateDto[];
}
