const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map<string, number>(
  BASE58_ALPHABET.split('').map((char, index) => [char, index]),
);

const decodeBase58 = (input: string): Uint8Array | null => {
  if (!input) return null;

  const bytes = [0];
  for (const char of input) {
    const value = BASE58_MAP.get(char);
    if (value === undefined) return null;

    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Handle leading zeros (base58 "1" maps to 0x00)
  let leadingZeros = 0;
  for (const char of input) {
    if (char !== '1') break;
    leadingZeros += 1;
  }
  while (leadingZeros > 0) {
    bytes.push(0);
    leadingZeros -= 1;
  }

  return new Uint8Array(bytes.reverse());
};

/**
 * Validates if a given string is a valid Solana public key.
 *
 * A base58-encoded public key must decode to exactly 32 bytes.
 *
 * @param address The string to validate.
 * @returns `true` if the string is a valid Solana public key, `false` otherwise.
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const trimmed = address.trim();

  // Solana addresses are base58 encoded and typically 32-44 characters
  if (trimmed.length < 32 || trimmed.length > 44) {
    return false;
  }

  // Fast reject for invalid characters
  for (const char of trimmed) {
    if (!BASE58_MAP.has(char)) {
      return false;
    }
  }

  const decoded = decodeBase58(trimmed);
  return !!decoded && decoded.length === 32;
}

export function isValidEvmAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

export function isValidWalletAddress(address: string): boolean {
  return isValidSolanaAddress(address) || isValidEvmAddress(address);
}

export type WalletChain = 'solana' | 'ethereum' | 'arbitrum' | 'base';

export function detectChain(address: string): WalletChain | null {
  if (isValidSolanaAddress(address)) return 'solana';
  if (isValidEvmAddress(address)) return 'ethereum';
  return null;
}

export function chainNativeToken(chain: WalletChain | null): string {
  if (!chain || chain === 'solana') return 'SOL';
  return 'ETH';
}

export function chainLabel(chain: WalletChain | null): string {
  switch (chain) {
    case 'solana': return 'Solana';
    case 'ethereum': return 'Ethereum';
    case 'arbitrum': return 'Arbitrum';
    case 'base': return 'Base';
    default: return 'Unknown';
  }
}

/**
 * Shortens a Solana address for display purposes.
 * e.g., "So11111111111111111111111111111111111111112" -> "So11...1112"
 * @param address The full Solana address.
 * @param chars The number of characters to show at the beginning and end.
 * @returns The shortened address string.
 */
export const shortenAddress = (address: string, chars = 4): string => {
  if (!address) return '';
  return address.length < chars * 2 ? address : `${address.slice(0, chars)}...${address.slice(-chars)}`;
};
