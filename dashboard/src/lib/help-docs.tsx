import type { LucideIcon } from "lucide-react";
import {
  Compass,
  Crosshair,
  FlaskConical,
  Users,
  Wallet,
} from "lucide-react";

export type HelpDocFaq = {
  question: string;
  answer: string;
};

export type HelpDoc = {
  slug: string;
  title: string;
  shortTitle: string;
  icon: LucideIcon;
  summary: string;
  value: string;
  bestFor: string[];
  workflow: string[];
  dataInside: string[];
  expect: string[];
  limits: string[];
  faq: HelpDocFaq[];
};

export const helpDocs: HelpDoc[] = [
  {
    slug: "discovery",
    title: "Discovery",
    shortTitle: "Discovery",
    icon: Compass,
    summary: "Find wallets that already stand out in the system by behavior, PnL, and activity.",
    value: "This is the fastest way to go from no idea to a shortlist worth opening.",
    bestFor: [
      "Finding new wallets to study.",
      "Filtering by style such as speed, flow, and hold bias.",
      "Scanning for strong activity without starting from an address.",
    ],
    workflow: [
      "Pick a sort mode based on what you care about most.",
      "Use one or two filters to narrow the field.",
      "Open the wallets that match the behavior profile you want.",
    ],
    dataInside: [
      "Cached analytics snapshots for wallets that already have PnL data.",
      "Behavior classifications such as speed category, flow pattern, and token breadth.",
      "Reason text explaining why a wallet was surfaced.",
      "Aggregated speed and flow distributions for the filtered set.",
    ],
    expect: [
      "This is curated discovery, not a full historical search across every wallet.",
      "Very recent activity can lag because the page relies on existing analysis snapshots.",
      "Some surfaced wallets may show stale warnings if their analysis is old.",
    ],
    limits: [
      "24 wallets per page in the UI.",
      "Server page size is capped at 40.",
      "API responses are cached for 120 seconds and the page also keeps a short local cache.",
    ],
    faq: [
      {
        question: "Why is a wallet missing from Discovery?",
        answer: "Discovery only shows wallets that already have analysis data and meet the current filters.",
      },
      {
        question: "Is Discovery real time?",
        answer: "No. It is snapshot-driven so it is optimized for fast browsing, not instant chain freshness.",
      },
    ],
  },
  {
    slug: "tracked-wallets",
    title: "Tracked Wallets",
    shortTitle: "Tracked",
    icon: Wallet,
    summary: "Save wallets into a working list so you can organize them, refresh them, and compare groups over time.",
    value: "This is the operating layer for your own wallet watchlists.",
    bestFor: [
      "Building named cohorts around themes or strategies.",
      "Keeping your highest-signal wallets in one place.",
      "Refreshing analysis across a selected list instead of one wallet at a time.",
    ],
    workflow: [
      "Add a wallet manually or import a list.",
      "Assign nicknames and collections so the list stays usable.",
      "Run batch analysis when you want a fresh pass on selected wallets.",
    ],
    dataInside: [
      "Saved wallets, nicknames, collections, and HUD-based quick context.",
      "Portfolio totals such as total wallets, total PnL, and total SOL balance.",
      "Collection-level summary cards so you can inspect groups, not just individual entries.",
    ],
    expect: [
      "Adding a wallet automatically queues a flash analysis.",
      "Imported wallets are analyzed in waves rather than all at once.",
      "Recently analyzed wallets can be skipped by refresh flows to avoid unnecessary work.",
    ],
    limits: [
      "Maximum 300 tracked wallets.",
      "Import supports up to 300 wallets per request.",
      "First 50 imported wallets get immediate flash analysis; the rest queue in background.",
      "Batch analyze is limited to 20 wallets per request.",
    ],
    faq: [
      {
        question: "What exactly is a tracked wallet?",
        answer: "It is a favorite wallet saved to your account with optional nickname and collection metadata.",
      },
      {
        question: "Does tracking a wallet mean live monitoring?",
        answer: "Not by itself. Tracking saves and organizes the wallet, then analysis is refreshed through the existing dashboard jobs.",
      },
    ],
  },
  {
    slug: "similarity-lab",
    title: "Similarity Lab",
    shortTitle: "Similarity",
    icon: FlaskConical,
    summary: "Compare wallets by overlap and capital allocation to uncover clusters, mirrors, or coordinated behavior.",
    value: "This turns a wallet list into relationship intelligence instead of isolated profiles.",
    bestFor: [
      "Testing whether a wallet cluster really trades alike.",
      "Checking overlap between top holders or tracked cohorts.",
      "Spotting copy-trading, shared themes, or portfolio convergence.",
    ],
    workflow: [
      "Paste at least two wallets, or start from a token and select holders.",
      "Queue the async job and wait for the comparison result.",
      "Use the strongest pairs, clusters, and common tokens to decide what matters next.",
    ],
    dataInside: [
      "Pairwise similarity scores and shared-token overlap.",
      "Wallet-level balance context and common-token views.",
      "Cluster-style grouping signals and global metrics for the full set.",
    ],
    expect: [
      "This is an async job and larger wallet sets take longer.",
      "Known system or non-trader wallets lower the usefulness of the comparison and can be skipped.",
      "Metadata and pricing enrichment can continue after the main similarity result loads.",
    ],
    limits: [
      "Minimum 2 wallets, maximum 30 wallets per run.",
      "Credit cost is dynamic: 10 if wallets are already synced, 20 if sync is needed.",
      "Heavy result payloads are job-backed rather than fully inline.",
    ],
    faq: [
      {
        question: "Should I compare as many wallets as possible?",
        answer: "No. Smaller, hypothesis-driven sets are usually easier to interpret than a noisy 30-wallet mix.",
      },
      {
        question: "What kind of similarity is measured?",
        answer: "The lab compares token overlap and capital allocation patterns, not just whether two wallets touched the same assets.",
      },
    ],
  },
  {
    slug: "holder-profiles",
    title: "Holder Profiles",
    shortTitle: "Profiles",
    icon: Users,
    summary: "Turn a token holder list into behavior profiles so you can understand who the holders are, not just how many there are.",
    value: "This is the quickest route from holder count to holder quality.",
    bestFor: [
      "Inspecting the top holder base of a token.",
      "Separating traders from passive or non-trader addresses.",
      "Reading conviction, hold-time, and quality signals before you trust a holder set.",
    ],
    workflow: [
      "Token mode: paste a mint and choose Top 10, 25, or 50.",
      "Wallet mode: paste wallet addresses directly when you already know the wallets you want.",
      "Read the confidence and data-quality fields before over-interpreting any profile.",
    ],
    dataInside: [
      "Holder rank, supply share, hold-time metrics, behavior labels, and confidence.",
      "Current holdings context, PnL fields, SOL balance, and activity window when available.",
      "Known-wallet skips for burn, LP, or other non-trader addresses.",
    ],
    expect: [
      "Token mode is async and can stream partial progress while holders are being processed.",
      "The page can chain into similarity after holder profiles complete.",
      "Some holders are intentionally skipped because they are known non-trader wallets.",
    ],
    limits: [
      "Token mode supports topN from 1 to 50; the UI offers 10, 25, and 50.",
      "Token-mode analysis costs 20 credits.",
      "Wallet-mode analysis costs 5 credits per wallet job.",
    ],
    faq: [
      {
        question: "Why are some holders skipped?",
        answer: "Known burn, LP, and other system-style wallets are intentionally filtered because they are not meaningful trader profiles.",
      },
      {
        question: "Does a low-confidence profile mean bad data?",
        answer: "It usually means limited tradable history or too little signal to make a strong behavioral read.",
      },
    ],
  },
  {
    slug: "wallet-hunt",
    title: "Wallet Hunt",
    shortTitle: "Hunt",
    icon: Crosshair,
    summary: "Capture multiple token holder snapshots and surface wallets that keep recurring across them.",
    value: "This is built for finding repeated actors across launches, metas, or related token sets.",
    bestFor: [
      "Tracking recurring wallets across launches.",
      "Checking whether the same top holders keep reappearing.",
      "Saving overlap candidates directly into Tracked Wallets.",
    ],
    workflow: [
      "Create a hunt.",
      "Add token snapshots for the launches or tokens you want to compare.",
      "Review overlap candidates and track the ones worth following.",
    ],
    dataInside: [
      "Saved hunts, token snapshots, and overlap candidates.",
      "Candidate confidence based on how many unique token snapshots a wallet appears in.",
      "Token-level appearance context so you can see where the overlap came from.",
    ],
    expect: [
      "With only one snapshot, candidates are just that token's holder list.",
      "Real overlap only appears after multiple snapshots.",
      "Inactive hunts warn first, then auto-delete later.",
    ],
    limits: [
      "Maximum 5 hunts per user.",
      "Maximum 10 snapshots per hunt.",
      "The same token and source pair cannot be added twice to one hunt.",
      "Inactive hunts warn after 14 days and auto-delete after 21 days.",
    ],
    faq: [
      {
        question: "Why do I see no candidates after two snapshots?",
        answer: "That means no holder address appeared in at least two unique token snapshots.",
      },
      {
        question: "What does confidence mean here?",
        answer: "Confidence is the share of captured token snapshots in which that wallet appears.",
      },
    ],
  },
];

export const helpDocMap: Record<string, HelpDoc> = Object.fromEntries(
  helpDocs.map((doc) => [doc.slug, doc]),
);

export function getHelpDoc(slug: string): HelpDoc | undefined {
  return helpDocMap[slug];
}

export function getAdjacentHelpDocs(slug: string): {
  previous?: HelpDoc;
  next?: HelpDoc;
} {
  const index = helpDocs.findIndex((doc) => doc.slug === slug);
  if (index === -1) {
    return {};
  }

  return {
    previous: index > 0 ? helpDocs[index - 1] : undefined,
    next: index < helpDocs.length - 1 ? helpDocs[index + 1] : undefined,
  };
}
