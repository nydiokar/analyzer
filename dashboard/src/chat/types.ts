export type Scope = { kind: 'global' } | { kind: 'token'; tokenAddress: string };

export type ReactionLite = { type: string; count: number };

export type MentionLite = { kind: string; refId?: string | null; rawValue: string; metaJson?: unknown };

export type MessageLite = {
  id: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  parentId?: string | null;
  isPinned?: boolean;
  reactions?: ReactionLite[];
  mentions?: MentionLite[];
};

export type PagedResult<T> = { items: T[]; nextCursor: string | null };

export type ChatActions = {
  onTogglePin: (messageId: string, nextIsPinned: boolean) => Promise<void> | void;
  onReact?: (messageId: string, type: string) => Promise<void> | void;
  onReply: (messageId: string, body: string) => void;
  openActionsFor: (messageId: string) => void;
  onWatchToggle?: () => Promise<void> | void;
};


