module.exports = {
  apps: [
    {
      name: 'wallet-analyzer_0.0.12',
      script: 'dist/core/index.js',
      cwd: '.',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      ignore_watch: [
        "node_modules",
        "logs",
        "analysis_reports",
        "prisma/dev.db",
        "prisma/dev.db-journal", // Also ignore the journal file
        ".git"
      ],
      min_uptime: '60s',
      max_restarts: 5,
      node_args: "-r tsconfig-paths/register",
      env: {
        NODE_ENV: 'development',
        TS_NODE_BASEURL: './dist'
      },
      out_file: './logs/wallet-analysis-bot-out.log',
      error_file: './logs/wallet-analysis-bot-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}; 