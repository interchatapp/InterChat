module.exports = {
  apps: [
    {
      name: 'interchat',
      script: '.',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
    },
  ],
};
