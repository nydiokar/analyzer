import type { MessageLite } from './types';

export const extractTokenMentions = (items: MessageLite[]): string[] => {
  const tokens = new Set<string>();
  for (const m of items || []) {
    const mentions = (m.mentions || []).filter((x) => (x.kind === 'TOKEN' || x.kind === 'token') && !!x.refId);
    for (const x of mentions) tokens.add(String(x.refId));
  }
  return Array.from(tokens);
};


