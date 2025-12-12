/**
 * Display Name Generator
 * Generates unique, memorable display names for users
 * Format: [Adjective][Noun][2-digit-number]
 * Example: BravePhoenix47, QuickFalcon23, WiseEagle91
 */

const ADJECTIVES = [
  'Brave', 'Swift', 'Wise', 'Bold', 'Quick', 'Fierce', 'Clever', 'Mighty',
  'Silent', 'Noble', 'Bright', 'Dark', 'Hidden', 'Ancient', 'Mystic', 'Iron',
  'Silver', 'Golden', 'Diamond', 'Crystal', 'Shadow', 'Storm', 'Thunder', 'Lightning',
  'Frost', 'Flame', 'Ocean', 'Mountain', 'Desert', 'Forest', 'Sky', 'Star',
  'Lunar', 'Solar', 'Cosmic', 'Quantum', 'Digital', 'Cyber', 'Neon', 'Velvet',
  'Crimson', 'Azure', 'Emerald', 'Amber', 'Violet', 'Jade', 'Onyx', 'Pearl',
  'Rogue', 'Phantom', 'Ghost', 'Spirit', 'Soul', 'Echo', 'Nexus', 'Apex',
  'Prime', 'Elite', 'Alpha', 'Beta', 'Omega', 'Delta', 'Sigma', 'Gamma',
];

const NOUNS = [
  'Phoenix', 'Dragon', 'Tiger', 'Wolf', 'Eagle', 'Falcon', 'Hawk', 'Raven',
  'Lion', 'Bear', 'Panther', 'Lynx', 'Fox', 'Viper', 'Cobra', 'Shark',
  'Whale', 'Dolphin', 'Orca', 'Kraken', 'Titan', 'Giant', 'Golem', 'Knight',
  'Warrior', 'Hunter', 'Ranger', 'Scout', 'Guardian', 'Sentinel', 'Warden', 'Keeper',
  'Sage', 'Wizard', 'Mage', 'Sorcerer', 'Shaman', 'Oracle', 'Prophet', 'Seer',
  'Blade', 'Arrow', 'Spear', 'Shield', 'Hammer', 'Axe', 'Sword', 'Dagger',
  'Storm', 'Thunder', 'Lightning', 'Tempest', 'Hurricane', 'Typhoon', 'Cyclone', 'Vortex',
  'Star', 'Moon', 'Sun', 'Comet', 'Meteor', 'Nebula', 'Galaxy', 'Cosmos',
];

/**
 * Generates a random display name
 * @returns A unique display name in format: [Adjective][Noun][2-digit-number]
 */
export function generateDisplayName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 90) + 10; // 10-99

  return `${adjective}${noun}${number}`;
}

/**
 * Generates a display name and checks for uniqueness
 * @param checkUniqueness - Async function that checks if a name is already taken
 * @param maxAttempts - Maximum number of generation attempts (default: 10)
 * @returns A unique display name
 */
export async function generateUniqueDisplayName(
  checkUniqueness: (name: string) => Promise<boolean>,
  maxAttempts: number = 10
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const name = generateDisplayName();
    const isUnique = await checkUniqueness(name);

    if (isUnique) {
      return name;
    }
  }

  // Fallback: append timestamp if we couldn't find a unique name
  const fallbackName = generateDisplayName();
  const timestamp = Date.now().toString().slice(-4);
  return `${fallbackName}${timestamp}`;
}

/**
 * Validates a display name
 * @param name - Display name to validate
 * @returns True if valid, false otherwise
 */
export function validateDisplayName(name: string): boolean {
  // Must be 3-30 characters
  if (name.length < 3 || name.length > 30) {
    return false;
  }

  // Must contain only alphanumeric characters
  if (!/^[a-zA-Z0-9]+$/.test(name)) {
    return false;
  }

  return true;
}

/**
 * Gets initials from a display name for avatar
 * @param name - Display name
 * @returns Two-letter initials
 */
export function getInitials(name: string): string {
  if (!name || name.length === 0) {
    return 'U';
  }

  // Extract capital letters from the name (e.g., "BravePhoenix47" -> "BP")
  const capitals = name.match(/[A-Z]/g);

  if (capitals && capitals.length >= 2) {
    return capitals.slice(0, 2).join('');
  }

  // Fallback: first two characters
  return name.slice(0, 2).toUpperCase();
}
