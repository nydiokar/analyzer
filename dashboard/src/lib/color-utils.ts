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

// Collection colors - distinct from tags, using complementary colors
const COLLECTION_COLORS = {
  'main-portfolio': 'bg-emerald-600 text-white',
  'watchlist': 'bg-amber-600 text-white',
  'research': 'bg-violet-600 text-white',
  'trading': 'bg-rose-600 text-white',
  'archive': 'bg-slate-600 text-white',
  'default': 'bg-blue-600 text-white'
} as const;

export function getTagColor(tag: string): string {
  const normalizedTag = tag.toLowerCase().replace(/\s+/g, '-');
  return TAG_COLORS[normalizedTag as keyof typeof TAG_COLORS] || TAG_COLORS.default;
}

export function getCollectionColor(collection: string): string {
  const normalizedCollection = collection.toLowerCase().replace(/\s+/g, '-');
  return COLLECTION_COLORS[normalizedCollection as keyof typeof COLLECTION_COLORS] || COLLECTION_COLORS.default;
} 