module.exports = {
  apps: [
    {
      name: 'wallet-analysis-bot',
      script: 'dist/src/wallet_analysis/index.js',
      cwd: '.',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: '60s',
      max_restarts: 5,
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/wallet-analysis-bot-out.log',
      error_file: './logs/wallet-analysis-bot-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}; 