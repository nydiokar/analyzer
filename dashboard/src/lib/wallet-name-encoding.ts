import type { WalletHudDto } from '@/types/api';

const HUD_SEPARATOR = '|';

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

const formatTokensPerDay = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return trimTrailingZero(value.toFixed(1));
  return trimTrailingZero(value.toFixed(1));
};

const formatWinRate = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return `${Math.round(value * 100)}`;
};

const formatPnl = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '+';

  if (absValue >= 1000) return `${sign}${trimTrailingZero((absValue / 1000).toFixed(1))}k`;
  if (absValue >= 100) return `${sign}${Math.round(absValue)}`;
  if (absValue >= 10) return `${sign}${trimTrailingZero(absValue.toFixed(1))}`;
  return `${sign}${trimTrailingZero(absValue.toFixed(2))}`;
};

export const buildHudEncodingTag = (hud: WalletHudDto): string => {
  const segments: string[] = [];

  // Behavior code (D, M, S, etc.)
  if (hud.behaviorCode) {
    segments.push(hud.behaviorCode);
  }

  // Hold time (7.2h, 3d, etc.)
  const hold = formatHoldTime(hud.medianHoldTimeHours);
  if (hold) segments.push(hold);

  // Unique tokens per day (not avgTradesPerDay!)
  const tokensPerDay = formatTokensPerDay(hud.uniqueTokensPerDay);
  if (tokensPerDay) segments.push(`${tokensPerDay}td`);

  // Win rate (20%wr, 68%wr, etc.)
  const winRate = formatWinRate(hud.winRate);
  if (winRate) segments.push(`${winRate}%wr`);

  // Trimmed mean PnL (+12.5p, -3.2kp, etc.)
  const pnl = formatPnl(hud.trimmedMeanPnl);
  if (pnl) segments.push(`${pnl}p`);

  // Quality tier (qG, qS, qB)
  const quality = QUALITY_CODE[hud.dataQualityTier];
  if (quality) segments.push(`q${quality}`);

  // Bot/Whale badges
  if (hud.isBot) segments.push('🤖');
  if (hud.isWhale) segments.push('🐋');

  return segments.join(HUD_SEPARATOR);
};

export const stripHudEncoding = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '';

  // Handle OLD format: "name [HUD:...]" or just "[HUD:...]"
  const oldHudPattern = /\s*\[HUD:[^\]]+\]\s*$/;
  if (oldHudPattern.test(trimmed)) {
    const stripped = trimmed.replace(oldHudPattern, '').trim();
    return stripped;
  }

  // Handle case where entire name is just "[HUD:...]"
  if (/^\[HUD:[^\]]+\]$/.test(trimmed)) {
    return '';
  }

  // Handle NEW format: "name|D|7.2h|6.9td|20%wr|qG|🤖"
  const firstPipeIndex = trimmed.indexOf(HUD_SEPARATOR);
  if (firstPipeIndex === -1) {
    return trimmed; // No HUD encoding present
  }

  // Check if this looks like HUD encoding by looking for characteristic patterns.
  // HUD should start with a behavior code (single [A-Z?]) either as the first segment
  // or as the segment immediately after the first pipe.
  const beforeFirstPipe = trimmed.slice(0, firstPipeIndex);
  const afterFirstPipe = trimmed.slice(firstPipeIndex + 1);

  const isPureTag = /^[A-Z?]$/.test(beforeFirstPipe); // whole tag, no base name: "D|7.2h|..."
  const hasHudPattern = /^[A-Z?](\||$)/.test(afterFirstPipe); // name prefix: "rouch|D|..."

  if (!isPureTag && !hasHudPattern) {
    return trimmed; // Not a HUD encoding, just a name with pipes
  }

  if (isPureTag) {
    return ''; // Entire string is a HUD tag — no base name
  }

  // Strip everything from the first pipe onwards
  return trimmed.slice(0, firstPipeIndex).trimEnd();
};

export const encodeHudName = (_name: string | undefined, hud: WalletHudDto): string => {
  return buildHudEncodingTag(hud);
};

/**
 * Extract bot/whale emoji from encoded wallet name
 * Returns the special emoji icon if present (bot/whale), otherwise null
 */
export const extractWalletIcon = (encodedName: string | null | undefined): string | null => {
  if (!encodedName) return null;

  // Check if name contains bot or whale emoji (these override user emoji)
  if (encodedName.includes('🤖')) return '🤖';
  if (encodedName.includes('🐋')) return '🐋';

  return null;
};

/**
 * Extract performance metrics from encoded name to determine emoji
 * Format: name|D|7.2h|6.9td|20%wr|-0.08p|qG|🤖
 */
const extractPerformanceFromEncoding = (encodedName: string): {
  winRate: number | null;
  pnl: number | null;
  holdTime: number | null;
  behaviorCode: string | null;
  isBot: boolean;
  isWhale: boolean;
} => {
  if (!encodedName) return { winRate: null, pnl: null, holdTime: null, behaviorCode: null, isBot: false, isWhale: false };

  const isBot = encodedName.includes('🤖');
  const isWhale = encodedName.includes('🐋');

  // Extract behavior code (first segment after name)
  const parts = encodedName.split('|');
  const behaviorCode = parts.length > 1 ? parts[1] : null;

  // Extract hold time (e.g., "7.2h", "3d", "16m")
  let holdTime: number | null = null;
  const holdMatch = encodedName.match(/(\d+\.?\d*)([smhd])\|/);
  if (holdMatch) {
    const value = parseFloat(holdMatch[1]);
    const unit = holdMatch[2];
    // Convert to hours
    if (unit === 's') holdTime = value / 3600;
    else if (unit === 'm') holdTime = value / 60;
    else if (unit === 'h') holdTime = value;
    else if (unit === 'd') holdTime = value * 24;
  }

  // Extract win rate (e.g., "20%wr")
  const wrMatch = encodedName.match(/(\d+)%wr/);
  const winRate = wrMatch ? parseInt(wrMatch[1]) : null;

  // Extract PnL (e.g., "-0.08p" or "+12.5p" or "-3.2kp")
  const pnlMatch = encodedName.match(/([+-]\d+\.?\d*k?)p/);
  let pnl: number | null = null;
  if (pnlMatch) {
    const value = pnlMatch[1];
    if (value.includes('k')) {
      pnl = parseFloat(value.replace('k', '')) * 1000;
    } else {
      pnl = parseFloat(value);
    }
  }

  return { winRate, pnl, holdTime, behaviorCode, isBot, isWhale };
};

/**
 * Get performance-based face emoji
 * 😭 Crying - Losing money (negative PnL, low win rate)
 * 😐 Neutral - Breaking even or mixed results
 * 😊 Happy - Slight profit (20-40% WR, small positive PnL)
 * 😁 Grinning - Good profit (40-60% WR, decent PnL)
 * 🤑 Money face - Great profit (>60% WR, high PnL)
 * 😴 Sleeping - Inactive/holder (long hold times - days+)
 */
const getPerformanceEmoji = (
  winRate: number | null,
  pnl: number | null,
  holdTime: number | null,
  behaviorCode: string | null
): string => {
  // Check for holders first (hold time > 24 hours or behavior codes H/P)
  if (holdTime !== null && holdTime > 24) return '😴'; // Sleeping - 1+ day holds
  if (behaviorCode === 'H' || behaviorCode === 'P') return '😴'; // HODLER or POSITION trader

  // If no data, return neutral
  if (winRate === null && pnl === null) return '😐';

  // Combined logic: consider both PnL and WR
  const isLoser = (pnl !== null && pnl < 0) || (winRate !== null && winRate < 30);
  const isBreakeven = (pnl !== null && pnl >= -0.05 && pnl <= 0.05) || (winRate !== null && winRate >= 30 && winRate < 40);
  const isSmallWinner = (pnl !== null && pnl > 0.05 && pnl < 2) || (winRate !== null && winRate >= 40 && winRate < 60);
  const isGoodWinner = (pnl !== null && pnl >= 2 && pnl < 10) || (winRate !== null && winRate >= 60 && winRate < 75);
  const isGreatWinner = (pnl !== null && pnl >= 10) || (winRate !== null && winRate >= 75);

  if (isGreatWinner) return '🤑'; // Money face - great profit (>60% WR, high PnL)
  if (isGoodWinner) return '😁'; // Grinning - good profit (40-60% WR, decent PnL)
  if (isSmallWinner) return '😊'; // Happy - slight profit (20-40% WR, small positive PnL)
  if (isBreakeven) return '😐'; // Neutral - breaking even
  if (isLoser) return '😭'; // Crying - losing money

  return '😐'; // Default neutral
};

/**
 * Get the display icon for a wallet
 * Priority: Bot/Whale combo > Bot > Whale > Performance-based emoji > User emoji > Default
 */
export const getWalletDisplayIcon = (
  encodedName: string | null | undefined,
  userEmoji: string | null | undefined
): string => {
  if (!encodedName) {
    return userEmoji || '😐';
  }

  const { winRate, pnl, holdTime, behaviorCode, isBot, isWhale } = extractPerformanceFromEncoding(encodedName);

  // Handle bot + whale combo
  if (isBot && isWhale) return '👑'; // King emoji for bot whale

  // Handle special individual cases
  if (isBot) return '🤖';
  if (isWhale) return '🐋';

  // If user hasn't set custom emoji, use performance-based emoji
  if (!userEmoji) {
    return getPerformanceEmoji(winRate, pnl, holdTime, behaviorCode);
  }

  // User has custom emoji, use it
  return userEmoji;
};
