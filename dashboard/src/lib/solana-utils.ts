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