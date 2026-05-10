import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../../', '');
  const port = Number(env.WEBMCP_MCP_DEMO_UI_PORT || 4250);
  const mcpGatewayUrl = new URL(env.VITE_OCP_MCP_GATEWAY_URL || 'http://localhost:4300/mcp');

  return {
    envDir: '../../../',
    base: './',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port,
      proxy: {
        '/api/ocp-mcp': {
          target: mcpGatewayUrl.origin,
          changeOrigin: true,
          rewrite: () => mcpGatewayUrl.pathname,
        },
      },
    },
  };
});
