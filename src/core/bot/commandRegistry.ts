export const commandList = [
  {
    name: '/correlation_analysis',
    emoji: '',
    group: 'Analysis',
    description: 'Analyze multiple Solana wallet addresses for correlations. MAX 1500 txs per wallet.',
    usage: '/correlation_analysis &lt;wallet1&gt; [wallet2] [tx_count]',
    example: '/correlation_analysis ABC123 DEF456 500'
  },
  {
    name: '/analyze_behavior',
    emoji: '',
    group: 'Analysis',
    description: 'Analyze trading behavior patterns of a wallet. MAX 5000 txs per wallet.',
    usage: '/analyze_behavior &lt;wallet&gt; [tx_count]',
    example: '/analyze_behavior ABC123 500'
  },
  {
    name: '/analyze_advanced',
    emoji: '',
    group: 'Analysis',
    description: 'Advanced trading statistics of a wallet. MAX 5000 txs per wallet.',
    usage: '/analyze_advanced &lt;wallet&gt; [tx_count]',
    example: '/analyze_advanced ABC123 1000'
  },
  {
    name: '/pnl_overview',
    emoji: '',
    group: 'Reporting',
    description: 'Show a PNL overview for the wallet.',
    usage: '/pnl_overview &lt;wallet&gt;',
    example: '/pnl_overview ABC123'
  },
  {
    name: '/behavior_summary',
    emoji: '',
    group: 'Reporting',
    description: 'Show a behavior summary for the wallet.',
    usage: '/behavior_summary &lt;wallet&gt;',
    example: '/behavior_summary ABC123'
  },
  {
    name: '/help',
    emoji: '❓',
    group: 'General',
    description: 'Show this help message.',
    usage: '/help',
  },
  {
    name: '/start',
    emoji: '🚀',
    group: 'General',
    description: 'Show the welcome message.',
    usage: '/start',
  }
]; 