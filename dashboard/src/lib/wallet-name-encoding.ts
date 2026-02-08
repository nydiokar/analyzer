import type { WalletHudDto } from '@/types/api';

const HUD_PREFIX = '[HUD:';
const HUD_SUFFIX = ']';

const QUALITY_CODE: Record<string, string> = {
  GOLD: 'G',
  SILVER: 'S',
  BRONZE: 'B',
  INSUFFICIENT: 'I',
};

const trimTrailingZero = (value: string) => value.replace(/\.0$/, '');

const formatHoldTime = (hours?: number): string | null => {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) return null;

  const seconds = hours * 3600;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (hours < 24) return `${trimTrailingZero(hours.toFixed(1))}h`;

  const days = hours / 24;
  if (days < 30) return `${trimTrailingZero(days.toFixed(1))}d`;
  return `${Math.round(days)}d`;
};

const formatTradesPerDay = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return trimTrailingZero(value.toFixed(1));
  return trimTrailingZero(value.toFixed(2));
};

const formatWinRate = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return `${Math.round(value * 100)}`;
};

export const buildHudEncodingTag = (hud: WalletHudDto): string => {
  const segments: string[] = [];

  if (hud.behaviorCode) {
    segments.push(hud.behaviorCode);
  }

  const hold = formatHoldTime(hud.medianHoldTimeHours);
  if (hold) segments.push(`h${hold}`);

  const winRate = formatWinRate(hud.winRate);
  if (winRate) segments.push(`w${winRate}`);

  const tradesPerDay = formatTradesPerDay(hud.avgTradesPerDay);
  if (tradesPerDay) segments.push(`t${tradesPerDay}`);

  const quality = QUALITY_CODE[hud.dataQualityTier];
  if (quality) segments.push(`q${quality}`);

  if (hud.isWhale) segments.push('🐋');
  if (hud.isBot) segments.push('🤖');

  return `${HUD_PREFIX}${segments.join(' ')}${HUD_SUFFIX}`;
};

export const stripHudEncoding = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith(HUD_PREFIX) && trimmed.endsWith(HUD_SUFFIX)) {
    return '';
  }

  const suffixIndex = trimmed.lastIndexOf(` ${HUD_PREFIX}`);
  if (suffixIndex === -1 || !trimmed.endsWith(HUD_SUFFIX)) {
    return trimmed;
  }

  return trimmed.slice(0, suffixIndex).trimEnd();
};

export const encodeHudName = (name: string | undefined, hud: WalletHudDto): string => {
  const base = stripHudEncoding(name ?? '');
  const tag = buildHudEncodingTag(hud);
  return base ? `${base} ${tag}` : tag;
};
