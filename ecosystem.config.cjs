module.exports = {
  apps: [
    {
      name: 'ocp-center-api',
      cwd: '.',
      script: 'bun',
      args: 'run center:api',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'commerce-catalog-api',
      cwd: '.',
      script: 'bun',
      args: 'run commerce:catalog:api',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'commerce-provider-api',
      cwd: '.',
      script: 'bun',
      args: 'run commerce:provider:api',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ocp-user-demo-api',
      cwd: '.',
      script: 'bun',
      args: 'run user:demo:api',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ocp-protocol-docs-web',
      cwd: '.',
      script: 'bun',
      args: 'run protocol:docs:host',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
