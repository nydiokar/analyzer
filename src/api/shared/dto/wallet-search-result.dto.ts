import { ApiProperty } from '@nestjs/swagger';

export class WalletSearchResultItemDto {
  @ApiProperty({ description: 'The full wallet address.', example: 'JBCXjv1dYRx3fmqUsbQb37up7JSBcc1cfPd93WjpQS9x' })
  address: string;
}

export class WalletSearchResultsDto {
  @ApiProperty({ type: [WalletSearchResultItemDto], description: 'A list of wallets matching the search query.' })
  wallets: WalletSearchResultItemDto[];
} 