import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../../', '');
  const port = Number(process.env.WEBMCP_MCP_DEMO_UI_PORT || env.WEBMCP_MCP_DEMO_UI_PORT || 4250);
  const base = process.env.WEBMCP_MCP_DEMO_BASE_PATH || env.WEBMCP_MCP_DEMO_BASE_PATH || './';

  return {
    envDir: '../../../',
    base,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port,
      allowedHosts: ['ocp.deeplumen.io'],
    },
  };
});
