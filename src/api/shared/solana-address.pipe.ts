import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';

/**
 * Validates if a given string is a plausible Solana public key.
 *
 * A base58-encoded public key should be between 32 and 44 characters long.
 * This is a basic check and does not validate the address against the ed25519 curve.
 *
 * @param address The string to validate.
 * @returns `true` if the string is a plausible Solana public key, `false` otherwise.
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map(BASE58_ALPHABET.split('').map((char, index) => [char, index]));

const decodeBase58 = (value: string): Uint8Array | null => {
  if (!value) {
    return null;
  }

  const bytes: number[] = [0];

  for (const char of value) {
    const charIndex = BASE58_MAP.get(char);
    if (charIndex === undefined) {
      return null;
    }

    let carry = charIndex;
    for (let i = 0; i < bytes.length; i++) {
      const x = bytes[i] * 58 + carry;
      bytes[i] = x & 0xff;
      carry = x >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Account for leading zero bytes ("1" in base58)
  for (let i = 0; i < value.length && value[i] === '1'; i++) {
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
};

export const isValidSolanaAddress = (address: string): boolean => {
  if (!address) {
    return false;
  }
  // Regular expression to check for a valid base58 string.
  // It should only contain characters from the base58 alphabet.
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  const isBase58 = base58Regex.test(address);

  // Check length constraints. Public keys are typically 32-44 characters.
  const isLengthValid = address.length >= 32 && address.length <= 44;
  if (!isBase58 || !isLengthValid) {
    return false;
  }

  const decoded = decodeBase58(address);
  return decoded !== null && decoded.length === 32;
};

export const isValidEvmAddress = (address: string): boolean => {
  if (!address || typeof address !== 'string') return false;
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
};

export const isValidWalletAddress = (address: string): boolean =>
  isValidSolanaAddress(address) || isValidEvmAddress(address);

export type WalletChain = 'solana' | 'ethereum' | 'arbitrum' | 'base';

export const detectChain = (address: string): WalletChain | null => {
  if (isValidSolanaAddress(address)) return 'solana';
  if (isValidEvmAddress(address)) return 'ethereum'; // default EVM chain; callers can override via ?chain= param
  return null;
};

@Injectable()
export class SolanaAddressPipe implements PipeTransform<string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (metadata.type !== 'param' || !isValidSolanaAddress(value)) {
      throw new BadRequestException(`Invalid Solana address: ${value}`);
    }
    return value;
  }
}
