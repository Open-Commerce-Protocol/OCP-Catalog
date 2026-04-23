import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const centerApiBaseUrl = env.VITE_CENTER_API_BASE_URL || 'http://localhost:4100';
  const centerAdminPort = Number(env.CENTER_ADMIN_UI_PORT || 4250);

  return {
    envDir: '../../',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: '../ocp-center-api/public/dist',
      emptyOutDir: true,
    },
    server: {
      host: '0.0.0.0',
      port: centerAdminPort,
      proxy: {
        '/api/center-admin': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
        '/ocp': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
        '/.well-known': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
        '/health': {
          target: centerApiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
