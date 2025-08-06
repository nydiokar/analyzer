module.exports = {
  apps: [
    // === App 1: The Original Wallet Analysis Bot ===
    {
      name: 'wallet-analyzer_0.0.14',
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
        "prisma/dev.db-journal",
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
    
    // === App 2: The NestJS Backend API ===
    {
      name: "analyzer-backend-api",
      script: "dist/main.js",     // Correct entry point for the NestJS application
      watch: false,              // Watching is not recommended for production
      max_memory_restart : '2G',  // Optional: restart if it exceeds memory
      env_production: {
         NODE_ENV: "production",
      }
    }
  ],
}; 