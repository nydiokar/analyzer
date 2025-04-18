import axios from 'axios';
import { createLogger } from '../../utils/logger';
import { StakingProtocolInfo } from '../../types/staking';

const logger = createLogger('ProtocolFetcher');

export type SupportedProtocol = 'marinade' | 'lido';

interface MarinadeApiResponse {
  apy?: number;
  price_sol?: number;
  price_usd?: number;
}

export class ProtocolFetcher {
  private static MARINADE_BASE_URL = 'https://api.marinade.finance';
  
  private static async getMarinadeData(): Promise<StakingProtocolInfo> {
    try {
      const [apyResponse, priceResponse] = await Promise.all([
        axios.get<MarinadeApiResponse>(`${ProtocolFetcher.MARINADE_BASE_URL}/msol/apy/1d`),
        axios.get<MarinadeApiResponse>(`${ProtocolFetcher.MARINADE_BASE_URL}/msol/price_sol`)
      ]);

      const apy = apyResponse.data.apy || 6.8; // Fallback to conservative estimate
      const price_sol = priceResponse.data.price_sol || 1;

      return {
        name: 'Marinade Finance',
        type: 'liquid',
        apy: apy,
        minimumStake: 0.1,
        unstakingPeriod: 0,
        exchangeRate: price_sol,
        risks: [
          'Smart contract risk',
          'Protocol risk',
          'Market liquidity risk'
        ]
      };
    } catch (error) {
      logger.warn('Failed to fetch Marinade data, using defaults', { error });
      return ProtocolFetcher.DEFAULT_PROTOCOLS['SOL']['marinade'];
    }
  }

  // Endpoints for different protocols
  private static ENDPOINTS: Record<SupportedProtocol, string> = {
    'marinade': 'https://api.marinade.finance/api/v1/info',  // Example endpoint
    'lido': 'https://api.lido.fi/v1/protocol/stats',        // Example endpoint
  };

  // Fallback/default protocol data
  private static DEFAULT_PROTOCOLS: Record<string, Record<string, StakingProtocolInfo>> = {
    'SOL': {
      'native': {
        name: 'Solana Native Staking',
        type: 'native',
        apy: 6.5,
        minimumStake: 1,
        unstakingPeriod: 2, // days
        risks: [
          'Validator performance impact',
          'Network stability',
          'Unstaking period lock'
        ]
      },
      'marinade': {
        name: 'Marinade Finance',
        type: 'liquid',
        apy: 6.8,
        minimumStake: 0.1,
        unstakingPeriod: 0,
        risks: [
          'Smart contract risk',
          'Protocol risk',
          'Market liquidity risk'
        ]
      }
    },
    'ETH': {
      'native': {
        name: 'Ethereum Beacon Chain',
        type: 'native',
        apy: 4.5,
        minimumStake: 32,
        unstakingPeriod: 0,
        risks: [
          'Network upgrade risks',
          'Technical complexity',
          'Validator duties'
        ]
      },
      'lido': {
        name: 'Lido Finance',
        type: 'liquid',
        apy: 4.8,
        minimumStake: 0.01,
        unstakingPeriod: 0,
        risks: [
          'Smart contract risk',
          'Protocol risk',
          'Market liquidity risk'
        ]
      }
    }
  };

  async getProtocolInfo(token: string, protocol: string): Promise<StakingProtocolInfo | null> {
    try {
      if (token.toUpperCase() === 'SOL' && protocol.toLowerCase() === 'marinade') {
        return await ProtocolFetcher.getMarinadeData();
      }

      // First try to get live data if available
      const protocolKey = protocol.toLowerCase() as SupportedProtocol;
      if (Object.prototype.hasOwnProperty.call(ProtocolFetcher.ENDPOINTS, protocolKey)) {
        try {
          const response = await axios.get(ProtocolFetcher.ENDPOINTS[protocolKey]);
          logger.info('Fetched live protocol data', { token, protocol });
          
          // Here we would parse the response and convert it to StakingProtocolInfo
          // For now, we'll use default data
          logger.warn('Live protocol data parsing not implemented, using defaults', { token, protocol });
        } catch (error) {
          logger.warn('Failed to fetch live protocol data, using defaults', { error, token, protocol });
        }
      }

      // Use default/fallback data
      const defaultData = ProtocolFetcher.DEFAULT_PROTOCOLS[token.toUpperCase()]?.[protocol.toLowerCase()];
      if (defaultData) {
        logger.info('Using default protocol data', { token, protocol, apy: defaultData.apy });
        return defaultData;
      }

      logger.error('Protocol not supported', { token, protocol });
      return null;
    } catch (error) {
      logger.error('Error fetching protocol info', { error, token, protocol });
      return null;
    }
  }

  getSupportedTokens(): string[] {
    return Object.keys(ProtocolFetcher.DEFAULT_PROTOCOLS);
  }

  getSupportedProtocols(token: string): string[] {
    const protocols = ProtocolFetcher.DEFAULT_PROTOCOLS[token.toUpperCase()];
    return protocols ? Object.keys(protocols) : [];
  }
} 