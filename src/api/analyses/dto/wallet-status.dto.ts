import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsBoolean } from 'class-validator';

export class WalletStatusRequestDto {
  @ApiProperty({
    description: 'An array of wallet addresses to check.',
    type: [String],
    example: ['ADDRESS_1', 'ADDRESS_2'],
  })
  @IsArray()
  @IsString({ each: true })
  walletAddresses: string[];
}

class WalletStatusDto {
    @ApiProperty({ description: 'The wallet address.'})
    @IsString()
    walletAddress: string;

    @ApiProperty({ description: 'Indicates if the wallet exists in the database.'})
    @IsBoolean()
    exists: boolean;
}

export class WalletStatusResponseDto {
    @ApiProperty({ 
        description: 'An array of wallet statuses.',
        type: [WalletStatusDto] 
    })
    @IsArray()
    statuses: WalletStatusDto[];
} 