import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { runMintParticipantsFlow, MintParticipantsParams } from '../../core/flows/mint-participants';

@Injectable()
export class MintParticipantsService {
  private readonly logger = new Logger(MintParticipantsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: DatabaseService,
    private readonly heliusClient: HeliusApiClient,
  ) {}

  async runForMint(
    mint: string,
    cutoffTs: number,
    opts?: Partial<Pick<MintParticipantsParams,
      'windowSeconds' | 'limitBuyers' | 'txCountLimit' | 'candidateWindow' | 'creationScan' | 'creationSkipIfTokenAccountsOver' | 'output' | 'outFile' | 'addressType' | 'sourceWallet' | 'verbose'>>
  ) {
    const params: MintParticipantsParams = {
      mint,
      cutoffTs,
      addressType: opts?.addressType ?? 'auto',
      sourceWallet: opts?.sourceWallet,
      windowSeconds: opts?.windowSeconds ?? Number(this.configService.get('MINT_PARTICIPANTS_WINDOW_SECONDS') || 7),
      limitBuyers: opts?.limitBuyers ?? Number(this.configService.get('MINT_PARTICIPANTS_LIMIT_BUYERS') || 20),
      txCountLimit: opts?.txCountLimit ?? Number(this.configService.get('MINT_PARTICIPANTS_TX_COUNT_LIMIT') || 500),
      candidateWindow: opts?.candidateWindow ?? Number(this.configService.get('MINT_PARTICIPANTS_CANDIDATE_WINDOW') || 300),
      creationScan: opts?.creationScan ?? (this.configService.get('MINT_PARTICIPANTS_CREATION_SCAN') === 'none' ? 'none' : 'full'),
      creationSkipIfTokenAccountsOver: opts?.creationSkipIfTokenAccountsOver ?? Number(this.configService.get('MINT_PARTICIPANTS_CREATION_SKIP_IF_TOKEN_ACCOUNTS_OVER') || 10000),
      output: opts?.output ?? (this.configService.get('MINT_PARTICIPANTS_OUTPUT') as any) ?? 'jsonl',
      outFile: opts?.outFile ?? this.configService.get('MINT_PARTICIPANTS_OUTFILE') ?? undefined,
      verbose: opts?.verbose ?? (this.configService.get('MINT_PARTICIPANTS_VERBOSE') === 'true' ? true : false),
    };

    return await runMintParticipantsFlow(
      this.heliusClient,
      this.dbService,
      params,
      { runScannedAtIso: new Date().toISOString(), runSource: params.addressType }
    );
  }
}


