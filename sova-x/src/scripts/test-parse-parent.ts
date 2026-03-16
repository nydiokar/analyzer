import { extractSingleMintFromMention } from '../core/solana';

function main(): void {
  const mention = '@sova_intel 9xQeWvG816bUx9EPfEZkLqN2YtY1YfB9F9r3uL6kP7z';
  const inferred = extractSingleMintFromMention(mention);
  console.log(JSON.stringify({ mention, inferred }, null, 2));
}

main();
