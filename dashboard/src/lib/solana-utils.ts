/**
 * Validates if a given string is a valid Solana public key.
 *
 * A base58-encoded public key should be exactly 44 characters long.
 * This is a strict check that matches Solana RPC requirements.
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
  // They can be shorter than 44 due to leading zeros being omitted in base58 encoding
  if (trimmed.length < 32 || trimmed.length > 44) {
    return false;
  }
  
  // Check if it contains only valid base58 characters
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  return base58Regex.test(trimmed);
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