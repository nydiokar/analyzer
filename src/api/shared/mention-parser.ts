export type ParsedMention = {
  kind: 'token' | 'tag' | 'time' | 'user';
  refId?: string;
  rawValue: string;
  metaJson?: Record<string, unknown>;
};

const CA_RE = /@ca:([1-9A-HJ-NP-Za-km-z]{32,44})/g;
const SYM_RE = /@sym:([A-Za-z0-9_\.\-]{1,15})/g;
const TAG_RE = /@(meta|risk|thesis):([a-z0-9_\-]+)/gi;
const TIME_RE = /@time:(\d+)(m|h|d)/gi;
const USER_RE = /@user:([A-Za-z0-9_\.\-]{1,32})/g;

export function parseMentions(body: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];

  // token by contract
  for (const match of body.matchAll(CA_RE)) {
    mentions.push({ kind: 'token', refId: match[1], rawValue: match[0] });
  }

  // symbol (left unresolved here; controller/service will resolve to address)
  for (const match of body.matchAll(SYM_RE)) {
    mentions.push({ kind: 'token', rawValue: match[0], metaJson: { symbol: match[1] } });
  }

  // tags
  for (const match of body.matchAll(TAG_RE)) {
    const type = match[1].toLowerCase();
    const name = match[2].toLowerCase();
    mentions.push({ kind: 'tag', rawValue: match[0], metaJson: { type, name } });
  }

  // time
  for (const match of body.matchAll(TIME_RE)) {
    const qty = Number(match[1]);
    const unit = match[2];
    const minutes = unit === 'm' ? qty : unit === 'h' ? qty * 60 : qty * 60 * 24;
    mentions.push({ kind: 'time', rawValue: match[0], metaJson: { minutes } });
  }

  // user
  for (const match of body.matchAll(USER_RE)) {
    mentions.push({ kind: 'user', rawValue: match[0], metaJson: { handle: match[1] } });
  }

  return mentions;
}


