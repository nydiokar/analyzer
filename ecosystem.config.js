module.exports = {
  apps: [
    {
      name: 'wallet-analysis-bot',
      script: 'dist/wallet_analysis/index.js',
      cwd: '.',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: '60s',
      max_restarts: 5,
      node_args: "-r tsconfig-paths/register",
      env: {
        NODE_ENV: 'production',
        TS_NODE_BASEURL: './dist'
      },
      out_file: './logs/wallet-analysis-bot-out.log',
      error_file: './logs/wallet-analysis-bot-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}; 