module.exports = {
  apps: [
    {
      name: 'sova-intel',
      script: './dist/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      wait_ready: true,
      listen_timeout: 10000,
      min_uptime: '60s',
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      out_file: './logs/sova-intel-out.log',
      error_file: './logs/sova-intel-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
