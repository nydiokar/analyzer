import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsEnum } from 'class-validator';
import { WalletAnalysisStatus } from '@/types/wallet';

export class WalletStatusRequestDto {
  @ApiProperty({
    description: 'An array of Solana wallet addresses to check.',
    type: [String],
    example: ['...'],
  })
  @IsArray()
  @IsString({ each: true })
  walletAddresses: string[];
}

export class WalletStatusDto {
  @ApiProperty({ description: 'The wallet address.' })
  @IsString()
  walletAddress: string;

  @ApiProperty({ 
    description: 'The analysis status of the wallet.',
    enum: WalletAnalysisStatus
  })
  @IsEnum(WalletAnalysisStatus)
  status: WalletAnalysisStatus;
}

export class WalletStatusResponseDto {
  @ApiProperty({
    description: 'An array of wallet statuses.',
    type: [WalletStatusDto],
  })
  @IsArray()
  statuses: WalletStatusDto[];
} 