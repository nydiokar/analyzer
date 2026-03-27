import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateHolderProfileShareSimilarityPairDto {
  @IsString()
  walletA: string;

  @IsString()
  walletB: string;

  @IsNumber()
  binaryScore: number;

  @IsNumber()
  capitalScore: number;

  @IsInt()
  @Min(0)
  binarySharedTokenCount: number;

  @IsInt()
  @Min(0)
  binaryUniqueTokenCountA: number;

  @IsInt()
  @Min(0)
  binaryUniqueTokenCountB: number;
}

class CreateHolderProfileShareSimilaritySnapshotDto {
  @IsInt()
  version: 1;

  @IsInt()
  @Min(0)
  walletCount: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateHolderProfileShareSimilarityPairDto)
  pairs: CreateHolderProfileShareSimilarityPairDto[];
}

export class CreateHolderProfileShareDto {
  @IsString()
  tokenMint: string;

  @IsString()
  jobId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateHolderProfileShareSimilaritySnapshotDto)
  similaritySnapshot?: CreateHolderProfileShareSimilaritySnapshotDto;
}
