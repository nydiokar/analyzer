import { Module } from '@nestjs/common';
import { WalletRepresentationController } from '../controllers/wallet-representation.controller';

/**
 * Module for the SPEC-001/002 wallet-representation dashboard read surface
 * (SURFACE-1). Depends only on the globally-provided DatabaseService, so it
 * needs no additional imports. Kept isolated from the credit-gated IntelModule
 * so the dashboard read never touches the /intel contract.
 */
@Module({
  controllers: [WalletRepresentationController],
})
export class WalletRepresentationModule {}
