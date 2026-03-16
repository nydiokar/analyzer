const SOLANA_ADDRESS_REGEX: RegExp = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

export function extractCandidateSolanaAddresses(text: string): string[] {
  const matches: string[] = text.match(SOLANA_ADDRESS_REGEX) ?? [];
  return Array.from(new Set(matches));
}

export function extractSingleMintFromMention(text: string): string | null {
  const candidates: string[] = extractCandidateSolanaAddresses(text);
  return candidates.length === 1 ? candidates[0] : null;
}
