import { useMemo } from 'react';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';

export function useTokenTrackDefaults(tokenMint: string | null) {
  const { metadata: tokenMeta } = useTokenMetadata(tokenMint ?? undefined);

  const sanitizeTokenLabel = (label: string) => {
    const cleaned = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    return cleaned || 'token';
  };

  const tokenLabel = useMemo(() => {
    const rawLabel =
      tokenMeta?.symbol ||
      tokenMeta?.onchainSymbol ||
      tokenMeta?.name ||
      tokenMeta?.onchainName;
    if (rawLabel && String(rawLabel).trim()) {
      return String(rawLabel).trim();
    }
    return 'TOKEN';
  }, [tokenMeta]);

  const tokenLabelSafe = useMemo(() => sanitizeTokenLabel(tokenLabel), [tokenLabel]);
  const defaultCollectionName = useMemo(() => `${tokenLabelSafe.toUpperCase()}_TH`, [tokenLabelSafe]);
  const defaultNicknamePrefix = useMemo(() => `${tokenLabelSafe.toLowerCase()}_th_`, [tokenLabelSafe]);

  return { defaultCollectionName, defaultNicknamePrefix };
}
