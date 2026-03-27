import { IsString } from 'class-validator';

export class CreateHolderProfileShareDto {
  @IsString()
  tokenMint: string;

  @IsString()
  jobId: string;
}
