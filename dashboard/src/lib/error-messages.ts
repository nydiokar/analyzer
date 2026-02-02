type ErrorContext =
  | "discover-wallets"
  | "discover-add-favorite"
  | "discover-remove-favorite"
  | "trackers-load"
  | "trackers-add"
  | "trackers-update"
  | "trackers-remove"
  | "trackers-clear"
  | "trackers-import"
  | "trackers-export"
  | "batch-analyze";

export type ErrorMessage = {
  title: string;
  description: string;
};

const baseMessages: Record<ErrorContext, ErrorMessage> = {
  "discover-wallets": {
    title: "Unable to load wallets",
    description: "We couldn't fetch Discover results. Please try again.",
  },
  "discover-add-favorite": {
    title: "Unable to add to favorites",
    description: "We couldn't add this wallet to your tracked list. Please try again.",
  },
  "discover-remove-favorite": {
    title: "Unable to remove from favorites",
    description: "We couldn't remove this wallet from your tracked list. Please try again.",
  },
  "trackers-load": {
    title: "Unable to load tracked wallets",
    description: "We couldn't fetch your tracked wallets. Please try again.",
  },
  "trackers-add": {
    title: "Unable to add wallet",
    description: "We couldn't add this wallet to your tracked list. Please try again.",
  },
  "trackers-update": {
    title: "Unable to update wallet",
    description: "We couldn't update this wallet. Please try again.",
  },
  "trackers-remove": {
    title: "Unable to remove wallet",
    description: "We couldn't remove this wallet from your tracked list. Please try again.",
  },
  "trackers-clear": {
    title: "Unable to clear tracked wallets",
    description: "We couldn't remove your tracked wallets. Please try again.",
  },
  "trackers-import": {
    title: "Unable to import wallets",
    description: "We couldn't import your list.",
  },
  "trackers-export": {
    title: "Unable to export wallets",
    description: "We couldn't export your tracked wallets. Please try again.",
  },
  "batch-analyze": {
    title: "Unable to queue analysis",
    description: "We couldn't queue the batch analysis. Please try again.",
  },
};

const extractErrorDetail = (error?: unknown): string | undefined => {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  const payloadMessage = (error as { payload?: { message?: string } })?.payload?.message;
  if (payloadMessage) return payloadMessage;
  if (error instanceof Error && error.message) return error.message;
  return undefined;
};

const joinDescription = (base: string, detail?: string): string => {
  if (!detail) return base;
  const trimmed = detail.trim();
  if (!trimmed) return base;
  const separator = base.endsWith(".") ? " " : ". ";
  return `${base}${separator}${trimmed}`;
};

export const getErrorMessage = (context: ErrorContext, error?: unknown): ErrorMessage => {
  const base = baseMessages[context];
  const detail = extractErrorDetail(error);
  return {
    title: base.title,
    description: joinDescription(base.description, detail),
  };
};
