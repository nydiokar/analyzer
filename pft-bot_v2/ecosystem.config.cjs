module.exports = {
  apps: [
    {
      name: 'sova-intel',
      script: './dist/index.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      wait_ready: true,
      listen_timeout: 10000,
      max_restarts: 3,
      min_uptime: '30s',
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
