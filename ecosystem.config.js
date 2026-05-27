/** PM2 — รันจากโฟลเดอร์นี้เสมอ (โหลด .env ถูกต้อง) */
module.exports = {
  apps: [
    {
      name: 'ea-platform',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
