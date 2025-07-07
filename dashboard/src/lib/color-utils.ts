// Improved color palette for tags - softer, more professional
const TAG_COLORS = {
  'high-volume-trader': 'bg-rose-50 text-rose-700 border-rose-200',
  'follow': 'bg-blue-50 text-blue-700 border-blue-200',
  'research': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'risky': 'bg-amber-50 text-amber-700 border-amber-200',
  'hodl': 'bg-violet-50 text-violet-700 border-violet-200',
  'bot-activity': 'bg-slate-50 text-slate-700 border-slate-200',
  'defi': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'nft': 'bg-pink-50 text-pink-700 border-pink-200',
  'meme': 'bg-orange-50 text-orange-700 border-orange-200',
  'whale': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  'default': 'bg-gray-50 text-gray-700 border-gray-200'
} as const;

// Collection colors - distinct from tags
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