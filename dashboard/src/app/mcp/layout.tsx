import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sova Intel MCP — On-Chain Wallet Intelligence for AI Agents',
  description:
    'Ask natural-language questions about Solana wallets and token holders from Codex, Cline, Claude Desktop, Claude Code, or Cursor. Behavioral profiles, holder maps, coordination detection.',
  openGraph: {
    title: 'Sova Intel MCP — On-Chain Wallet Intelligence for AI Agents',
    description:
      'Add one config block to any MCP client. Ask questions about wallets and token holders in plain language.',
    url: 'https://sova-intel.com/mcp',
    siteName: 'Sova Intel',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sova Intel MCP',
    description: 'On-chain wallet intelligence for any MCP-compatible AI client.',
  },
};

export default function McpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
