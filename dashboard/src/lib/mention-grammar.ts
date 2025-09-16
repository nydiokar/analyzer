// Lightweight client-side mention parsing aligned with server parser in `src/api/shared/mention-parser.ts`
// Focus: detect @ca:, @sym:, @meta/@risk/@thesis, @time, @user for pre-submit validation and UX hints.

export type ClientMentionKind = 'token' | 'tag' | 'time' | 'user';

export interface ClientParsedMention {
  kind: ClientMentionKind;
  refId?: string;
  rawValue: string;
  metaJson?: Record<string, unknown>;
}

const CA_RE = /@ca:([1-9A-HJ-NP-Za-km-z]{32,44})/g;
const SYM_RE = /@sym:([A-Za-z0-9_\.\-]{1,15})/g;
const TAG_RE = /@(meta|risk|thesis):([a-z0-9_\-]+)/gi;
const TIME_RE = /@time:(\d+)(m|h|d)/gi;
const USER_RE = /@user:([A-Za-z0-9_\.\-]{1,32})/g;

export function parseMentionsClient(body: string): ClientParsedMention[] {
  const mentions: ClientParsedMention[] = [];

  for (const match of body.matchAll(CA_RE)) {
    mentions.push({ kind: 'token', refId: match[1], rawValue: match[0] });
  }

  for (const match of body.matchAll(SYM_RE)) {
    mentions.push({ kind: 'token', rawValue: match[0], metaJson: { symbol: match[1] } });
  }

  for (const match of body.matchAll(TAG_RE)) {
    const type = match[1].toLowerCase();
    const name = match[2].toLowerCase();
    mentions.push({ kind: 'tag', rawValue: match[0], metaJson: { type, name } });
  }

  for (const match of body.matchAll(TIME_RE)) {
    const qty = Number(match[1]);
    const unit = match[2];
    const minutes = unit === 'm' ? qty : unit === 'h' ? qty * 60 : qty * 60 * 24;
    mentions.push({ kind: 'time', rawValue: match[0], metaJson: { minutes } });
  }

  for (const match of body.matchAll(USER_RE)) {
    mentions.push({ kind: 'user', rawValue: match[0], metaJson: { handle: match[1] } });
  }

  return mentions;
}

export function extractUnresolvedSymbols(body: string): string[] {
  const syms: string[] = [];
  for (const match of body.matchAll(SYM_RE)) {
    syms.push(match[1]);
  }
  return syms;
}

// Extract bare @SYMBOL that are not already namespaced and not a known namespace like @meta/@time/@user
export function extractBareSymbols(body: string): string[] {
  const bareRe = /@([A-Za-z0-9_\.\-]{1,15})\b/g;
  const disallowedPrefixes = ['ca:', 'sym:', 'meta:', 'risk:', 'thesis:', 'time:', 'user:'];
  const results: string[] = [];
  for (const match of body.matchAll(bareRe)) {
    const afterAt = body.slice(match.index! + 1).toLowerCase();
    if (disallowedPrefixes.some((p) => afterAt.startsWith(p))) continue;
    results.push(match[1]);
  }
  return results;
}

export const mentionNamespaces = [
  { key: 'ca', label: 'Contract address', example: '@ca:V5cCi…' },
  { key: 'sym', label: 'Symbol', example: '@sym:JUP' },
  { key: 'meta', label: 'Tag (meta)', example: '@meta:elon' },
  { key: 'risk', label: 'Tag (risk)', example: '@risk:scam' },
  { key: 'thesis', label: 'Tag (thesis)', example: '@thesis:long' },
  { key: 'time', label: 'Time ref', example: '@time:5h' },
  { key: 'user', label: 'User', example: '@user:alice' },
];


