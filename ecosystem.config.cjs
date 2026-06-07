module.exports = {
  apps: [
    {
      name: 'ocp-registration-api',
      cwd: '.',
      script: 'bun',
      args: 'run registration:api',
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
      name: 'commerce-catalog-worker',
      cwd: '.',
      script: 'bun',
      args: 'run commerce:catalog:worker',
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
      name: 'alimama-catalog-api',
      cwd: '.',
      script: 'bun',
      args: 'run --cwd apps/examples/alimama-catalog-api start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        ALIMAMA_CATALOG_PORT: '4310',
      },
    },
    {
      name: 'shopify-catalog-api',
      cwd: '.',
      script: 'bun',
      args: 'run --cwd apps/examples/shopify-catalog-api start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        SHOPIFY_CATALOG_PORT: '4320',
      },
    },
    {
      name: 'ocp-site-web',
      cwd: '.',
      script: 'bun',
      args: 'run site:start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ocp-activity-api',
      cwd: '.',
      script: 'bun',
      args: 'run activity:api',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ocp-webmcp-mcp-demo-web',
      cwd: '.',
      script: 'bun',
      args: 'run --cwd apps/examples/ocp-webmcp-mcp-demo-web start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        WEBMCP_MCP_DEMO_UI_PORT: '4250',
        WEBMCP_MCP_DEMO_BASE_PATH: '/webmcp/',
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
        OCP_MCP_HTTP_PORT: '4300',
        OCP_MCP_HTTP_PATH: '/mcp',
      },
    },
  ],
};
