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

  return isBase58 && isLengthValid;
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