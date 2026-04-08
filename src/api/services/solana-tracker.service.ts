import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createLogger } from 'core/utils/logger';
import { getErrorMessage } from 'core/utils/error-utils';
import type {
  SolanaTrackerTopTrader,
  SolanaTrackerTopTradersResponse,
} from '../../types/solana-tracker.types';

const logger = createLogger('SolanaTrackerService');

const BASE_URL = 'https://data.solanatracker.io';

@Injectable()
export class SolanaTrackerService {
  constructor(private readonly http: HttpService) {}

  /**
   * Fetch the top 100 traders by PnL for a given token mint.
   * Requires SOLANA_TRACKER_API_KEY in env.
   */
  async getTopTraders(tokenMint: string): Promise<SolanaTrackerTopTrader[]> {
    const apiKey = process.env.SOLANA_TRACKER_API_KEY;
    if (!apiKey) {
      throw new Error('SOLANA_TRACKER_API_KEY is not set');
    }

    const url = `${BASE_URL}/top-traders/${tokenMint}`;

    try {
      const response = await firstValueFrom(
        this.http.get<SolanaTrackerTopTradersResponse>(url, {
          headers: { 'x-api-key': apiKey },
        }),
      );
      return response.data;
    } catch (err) {
      logger.error(
        `Failed to fetch top traders for ${tokenMint}: ${getErrorMessage(err)}`,
      );
      throw err;
    }
  }
}
