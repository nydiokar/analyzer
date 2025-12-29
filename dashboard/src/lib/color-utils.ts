// Purple-themed color palette for tags - better contrast and readability
const TAG_COLORS = {
  'high-volume-trader': 'bg-purple-600 text-white border-purple-500',
  'follow': 'bg-purple-500 text-white border-purple-400',
  'research': 'bg-violet-600 text-white border-violet-500',
  'risky': 'bg-fuchsia-600 text-white border-fuchsia-500',
  'hodl': 'bg-indigo-600 text-white border-indigo-500',
  'bot-activity': 'bg-purple-700 text-white border-purple-600',
  'defi': 'bg-violet-700 text-white border-violet-600',
  'nft': 'bg-purple-800 text-white border-purple-700',
  'meme': 'bg-fuchsia-500 text-white border-fuchsia-400',
  'whale': 'bg-indigo-500 text-white border-indigo-400',
  'default': 'bg-purple-600 text-white border-purple-500'
} as const;

// Collection color palette - diverse colors for dynamic collections
const COLLECTION_COLOR_PALETTE = [
  { bg: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-500', name: 'emerald' },
  { bg: 'bg-amber-500', text: 'text-amber-700', border: 'border-amber-500', name: 'amber' },
  { bg: 'bg-violet-500', text: 'text-violet-700', border: 'border-violet-500', name: 'violet' },
  { bg: 'bg-rose-500', text: 'text-rose-700', border: 'border-rose-500', name: 'rose' },
  { bg: 'bg-cyan-500', text: 'text-cyan-700', border: 'border-cyan-500', name: 'cyan' },
  { bg: 'bg-orange-500', text: 'text-orange-700', border: 'border-orange-500', name: 'orange' },
  { bg: 'bg-indigo-500', text: 'text-indigo-700', border: 'border-indigo-500', name: 'indigo' },
  { bg: 'bg-pink-500', text: 'text-pink-700', border: 'border-pink-500', name: 'pink' },
  { bg: 'bg-teal-500', text: 'text-teal-700', border: 'border-teal-500', name: 'teal' },
  { bg: 'bg-fuchsia-500', text: 'text-fuchsia-700', border: 'border-fuchsia-500', name: 'fuchsia' },
  { bg: 'bg-lime-500', text: 'text-lime-700', border: 'border-lime-500', name: 'lime' },
  { bg: 'bg-sky-500', text: 'text-sky-700', border: 'border-sky-500', name: 'sky' },
];

// Simple hash function for consistent color assignment
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function getTagColor(tag: string): string {
  const normalizedTag = tag.toLowerCase().replace(/\s+/g, '-');
  return TAG_COLORS[normalizedTag as keyof typeof TAG_COLORS] || TAG_COLORS.default;
}

export function getCollectionColor(collection: string): string {
  const hash = hashString(collection);
  const colorIndex = hash % COLLECTION_COLOR_PALETTE.length;
  const color = COLLECTION_COLOR_PALETTE[colorIndex];
  return `${color.border} ${color.text}`;
}

// Get full collection color classes including background for filled badges
export function getCollectionColorFilled(collection: string): string {
  const hash = hashString(collection);
  const colorIndex = hash % COLLECTION_COLOR_PALETTE.length;
  const color = COLLECTION_COLOR_PALETTE[colorIndex];
  return `${color.bg} ${color.border} text-white`;
} 