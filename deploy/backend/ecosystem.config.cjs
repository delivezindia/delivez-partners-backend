// PM2 process file for the API. Settings come from the repo-root .env (read by the API itself).
// One instance: the order timers and reminders run inside the API process.
const { resolve } = require('node:path');

module.exports = {
  apps: [
    {
      name: 'delivez-api',
      cwd: resolve(__dirname, '../../apps/core-api'),
      script: 'dist/main.js',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      time: true,
    },
  ],
};
