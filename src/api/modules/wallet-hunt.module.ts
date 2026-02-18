import { Module } from '@nestjs/common';
import { TokenInfoModule } from '../integrations/token-info.module';
import { UsersModule } from './users.module';
import { WalletHuntController } from '../controllers/wallet-hunt.controller';
import { WalletHuntService } from '../services/wallet-hunt.service';

@Module({
  imports: [
    TokenInfoModule,  // Exports TokenHoldersService
    UsersModule,      // Exports UserFavoritesService
  ],
  controllers: [WalletHuntController],
  providers: [WalletHuntService],
  exports: [WalletHuntService],
})
export class WalletHuntModule {}
