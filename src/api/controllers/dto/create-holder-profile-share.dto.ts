import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateHolderProfileShareDto {
  @IsString()
  tokenMint: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  topN?: number;
}
