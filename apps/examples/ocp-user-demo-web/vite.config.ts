import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../../', '');
  const userDemoPort = Number(env.USER_DEMO_UI_PORT || 4220);
  const userDemoAgentApiBaseUrl = env.VITE_USER_DEMO_AGENT_API_BASE_URL || 'http://localhost:4230';

  return {
    envDir: '../../../',
    plugins: [react()],
    build: {
      outDir: '../ocp-user-demo-api/public/dist',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',
      port: userDemoPort,
      proxy: {
        '/api/user-demo': {
          target: userDemoAgentApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
