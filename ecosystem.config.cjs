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
    {
      name: 'ocp-mcp-server',
      cwd: '.',
      script: 'bun',
      args: 'run mcp:gateway',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        OCP_MCP_TRANSPORT: 'http',
        OCP_MCP_HTTP_PORT: '4300',
        OCP_MCP_HTTP_PATH: '/mcp',
      },
    },
  ],
};
